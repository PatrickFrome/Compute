import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostgresContinuityInspector} from './postgres-continuity-inspector.mjs';
const identity={data_directory:'C:/managed/pg',version:170006,address:'127.0.0.1',port:55432,
  started_at:'2026-10-23T04:05:21.747339+03:00',system_identifier:'7694034680113450848'};

test('continuity reuses one bounded connection and preserves the exact startup JSON timestamp',async()=>{
  const configs=[],queries=[],ends=[];
  const inspector=await createPostgresContinuityInspector({inspectDatabaseUrl:'postgres://fixture',expectedClusterSystemIdentifier:identity.system_identifier},
    {connect:(url,options)=>{configs.push({url,options});return{unsafe:async query=>{queries.push(query);return[{identity}];},end:async options=>{ends.push(options);}};}});
  assert.deepEqual(await inspector.inspect(),identity);assert.deepEqual(await inspector.inspect(),identity);
  assert.equal(configs.length,1);assert.equal(configs[0].options.max,1);assert.equal(configs[0].options.connection.statement_timeout,4000);
  assert.match(queries[0],/pg_control_system/);assert.match(queries[0],/json_build_object/);
  await inspector.close();await inspector.close();assert.equal(ends.length,1);
  await assert.rejects(inspector.inspect(),{code:'postgres_inspection_failed'});
});

test('overlapping health reads join one query rather than opening more probes',async()=>{
  let complete,calls=0;const gate=new Promise(resolve=>{complete=resolve;});
  const inspector=await createPostgresContinuityInspector({inspectDatabaseUrl:'postgres://fixture'},
    {connect:()=>({unsafe:async()=>{calls++;await gate;return[{identity}];},end:async()=>{}})});
  const first=inspector.inspect(),second=inspector.inspect();assert.equal(first,second);complete();
  await Promise.all([first,second]);assert.equal(calls,1);await inspector.close();
});

test('SQL, auth and network failures remain finite and never expose private error text',async()=>{
  for(const [code,expected] of [['42501','permission_denied'],['28P01','auth_failed'],['53300','server_unavailable'],['57014','query_timeout'],['ECONNREFUSED','connection_refused'],['CONNECT_TIMEOUT','connection_timeout'],['ETIMEDOUT','network_timeout'],['PRIVATE_SECRET','query_failed']]) {
    const inspector=await createPostgresContinuityInspector({inspectDatabaseUrl:'postgres://fixture'},
      {connect:()=>({unsafe:async()=>{throw Object.assign(Error('PRIVATE_SECRET postgresql://credentials'),{code});},end:async()=>{}})});
    await assert.rejects(inspector.inspect(),error=>error.code===`postgres_inspection_${expected}`&&!JSON.stringify(error).includes('PRIVATE_SECRET')&&!error.message.includes('credentials'));
    await inspector.close();
  }
});
