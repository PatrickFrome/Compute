import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {nativeCodingPgPoolFixtureTarget,nativeCodingPhysicalIdentitySql} from './test/native-coding-pg-pool-target.mjs';

const probe=`select pg_backend_pid() as pid,current_database() as database,
  current_setting('transaction_isolation') as isolation,current_setting('transaction_read_only') as read_only`;

// Scoped qualification: REAL postgres.js max:1, BEGIN and the exact production
// physical-PG identity query. The production Windows/loopback/image/permit
// validator and authority domain SQL are NOT executed here: Docker's PG server
// address can be a bridge IP. The paired generated-reader/authority tests cover
// their transaction forwarding and refusals, not installed native authority.
test('real PG17 max:1 physical identity SQL retains the transaction-owned connection',{
  skip:process.env.METAENGINE_NATIVE_POOL_PG17===undefined?'NOT RUN: explicit PG17 checkpoint CI fixture not enabled':false,
  timeout:30000,
},async t=>{
  const target=nativeCodingPgPoolFixtureTarget();
  const entry=import.meta.resolve('postgres');
  const pkg=JSON.parse(await fs.readFile(new URL('../package.json',entry),'utf8'));
  assert.equal(pkg.version,'3.4.7');
  const {default:postgres}=await import('postgres');
  const driver=postgres(target,{max:1,prepare:false,idle_timeout:0,max_lifetime:0,connect_timeout:3,
    connection:{application_name:'METAENGINE_NATIVE_POOL_'+randomUUID(),statement_timeout:3000,
      lock_timeout:1000,idle_in_transaction_session_timeout:5000}});
  t.after(()=>driver.end({timeout:1}));
  t.signal.addEventListener('abort',()=>{void driver.end({timeout:0}).catch(()=>{});},{once:true});
  // A client-pool queue wait has no server statement_timeout. Fail promptly
  // and close ONLY this test's own driver if a nested acquisition self-waits.
  async function bounded(label,operation){
    let timer;
    try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{
      timer=setTimeout(()=>{void driver.end({timeout:0}).catch(()=>{});
        reject(Error('native_pool_'+label+'_deadline'));},5000);
    })]);}finally{clearTimeout(timer);}
  }
  const [identity]=await bounded('connect',()=>driver.unsafe(`select current_database() as database,
    current_setting('server_version_num')::int as version,current_setting('data_directory') as data_directory,
    host(inet_server_addr()) as address,inet_server_port() as port,
    (select system_identifier::text from pg_catalog.pg_control_system()) as system_identifier,
    floor(extract(epoch from pg_postmaster_start_time()))::text as started_seconds`));
  assert.equal(identity.database,'checkpoint_fixture');assert.equal(identity.version,170011);
  assert.ok(identity.address);assert.equal(identity.port,5432);
  assert.equal(driver.options.max,1);
  const source=await fs.readFile(new URL('./native-coding-host-os-scope.mjs',import.meta.url),'utf8');
  const physicalIdentitySql=nativeCodingPhysicalIdentitySql(source);
  let passed=0;

  await t.test('negative control: root SQL really queues while the sole backend is reserved by BEGIN',async()=>{
    let queued,settled=false,pid;
    await bounded('root_queue_control',()=>driver.begin('isolation level serializable',async tx=>{
      [{pid}]=await tx.unsafe(probe);
      queued=driver.unsafe(probe).execute();queued.then(()=>{settled=true;},()=>{settled=true;});
      await tx.unsafe('select pg_sleep(0.05)');
      assert.equal(settled,false,'the root pool must not borrow the reserved transaction connection');
      assert.equal((await tx.unsafe(probe))[0].pid,pid);
    }));
    const [after]=await bounded('root_queue_release',()=>queued);assert.equal(after.pid,pid);
    assert.equal(settled,true);passed++;
  });

  const observations=[];let held=false,rootReads=0,nestedRootReads=0;
  const root={unsafe:(...args)=>{rootReads++;if(held)nestedRootReads++;return driver.unsafe(...args);}};
  // Test-only reader boundary; SQL text and server rows are not substituted.
  // Default-root behavior mirrors the private physical reader's API contract.
  const readIdentity=async(reader=root)=>(await reader.unsafe(physicalIdentitySql))[0];
  for(const kind of ['serializable','repeatable-read-only'])await t.test(kind+' physical SQL uses its active backend and mode',async()=>{
    const before=rootReads;
    const writable=kind==='serializable';
    const mode=writable?'isolation level serializable':'isolation level repeatable read read only';
    await bounded(kind+'_reader',()=>driver.begin(mode,async tx=>{
      held=true;
      try{
        const [active]=await tx.unsafe(probe);
        const reader={unsafe:async(query,args)=>{
          const rows=await tx.unsafe(query,args);
          assert.match(query,/pg_catalog\.pg_control_system\(\)/);
          const [physical]=await tx.unsafe(probe);observations.push(physical);
          assert.deepEqual(physical,active);return rows;
        }};
        const result=await readIdentity(reader);
        for(const key of ['data_directory','version','address','port','system_identifier'])assert.equal(result[key],identity[key]);
        assert.equal(active.database,'checkpoint_fixture');
        assert.equal(active.isolation,writable?'serializable':'repeatable read');
        assert.equal(active.read_only,writable?'off':'on');
      }finally{held=false;}
    }));
    assert.equal(rootReads,before);assert.equal(nestedRootReads,0);passed++;
  });

  await t.test('outside-transaction callers retain the original root-pool default',async()=>{
    const before=rootReads;
    const result=await bounded('default_reader',()=>readIdentity());
    assert.equal(result.system_identifier,identity.system_identifier);
    assert.equal(rootReads,before+1);assert.equal(nestedRootReads,0);passed++;
  });

  await t.test('the real read-only transaction refuses schema writes and leaves no fixture object',async()=>{
    const name='native_pool_refusal_'+randomUUID().replaceAll('-','');assert.match(name,/^[a-z0-9_]+$/);
    assert.equal((await driver.unsafe('select to_regnamespace($1) is null as absent',[name]))[0].absent,true);
    await assert.rejects(bounded('read_only_refusal',()=>driver.begin('isolation level repeatable read read only',async tx=>{
      // If mode ever regresses, the deliberate throw still rolls this unique
      // schema back. Never CREATE OR REPLACE, drop, or target existing objects.
      await tx.unsafe('create schema '+name);throw Error('native_pool_read_only_write_succeeded');
    })),error=>error.code==='25006');
    assert.equal((await driver.unsafe('select to_regnamespace($1) is null as absent',[name]))[0].absent,true);passed++;
  });
  assert.equal(passed,5);assert.equal(observations.length,2);assert.equal(nestedRootReads,0);
  t.diagnostic(JSON.stringify({classification:'REAL_PG_POOL_AND_EXACT_PHYSICAL_SQL_ONLY',
    postgres_version_num:identity.version,driver_version:pkg.version,max_connections:1,
    same_backend_and_transaction_mode:true,negative_control_root_queue_verified:true,physical_sql_nested_root_acquisitions:0,
    production_os_reader_validator_executed:false,owner_lease_domain_sql_qualified:false,installed_native_qualification:false,
    schema_changes_committed:false,model_calls:0,physical_effect_replayed:false,authority_effect:false}));
});
