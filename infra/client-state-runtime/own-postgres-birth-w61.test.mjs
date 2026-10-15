import test from 'node:test';
import assert from 'node:assert/strict';
import {bindOwnPostgresBirthProviderW61,OWN_PG_BIRTH_SQL_W61} from './own-postgres-birth-w61.mjs';
const NOW = Date.parse('2026-10-15T02:00:00.000Z');
const owner = () => ({
  schema:'metaengine.host.owner-incarnation.v1',source:'LOCAL_HOST_OWNER',
  authority_effect:false,owner_id:'owner-w61',device_id:'device-w61',
  project_id:'project-w61',pid:12345,generation:7,epoch:9,
  process_incarnation_id:'incarnation-w61',
  source_sha:'a'.repeat(40),
  created_at:'2026-10-15T01:45:00.000Z',observed_at:new Date(NOW).toISOString(),
});
const row = () => ({
  observed_at:new Date(NOW).toISOString(),
  postgres_started_at:'2026-10-15T01:40:00.000Z',
  database_name:'metaengine_own',server_version_num:170006,
  schema_present:true,project_table_present:true,
});
function rig({owners=[owner(),owner(),owner()],rows=[[row()],[row()]],failSql=false}={}) {
  let oi=0,qi=0;
  const queries=[];
  const provider=bindOwnPostgresBirthProviderW61({
    now:()=>NOW,
    trustedOwnerReadback:()=>owners[Math.min(oi++,owners.length-1)],
    transaction:async (run, opts)=>{
      assert.equal(opts.readOnly,true,'private service must force read-only');
      return run({unsafe:async(sql,args)=>{
        queries.push({sql,args});
        assert.equal(sql,OWN_PG_BIRTH_SQL_W61,'literal fixed SELECT only');
        assert.equal(args,undefined,'no caller SQL or data');
        if(failSql)throw Error('DB_DOWN');
        return rows[Math.min(qi++,rows.length-1)];
      }});
    },
  });
  return {provider,queries};
}
test('birth is a private fixed catalog SELECT, two distinct read-only transactions, Host triple fence',async()=>{
  const r=rig(),v=await r.provider('owner-w61',9);
  assert.equal(v?.source,'OWN_PG_POSTMASTER_READBACK');
  assert.equal(v?.postgres_started_at,'2026-10-15T01:40:00.000Z');
  assert.equal(v.owner_epoch,9);
  assert.equal(v.source_sha,'a'.repeat(40));
  assert.equal(v.installed_owner_proven,false);
  assert.equal(v.authority_effect,false);
  assert.equal(v.upgrade_authorized,false);
  assert.equal(r.queries.length,2);
});
test('no Host producer and invalid selector cannot generate proof',async()=>{
  assert.equal(bindOwnPostgresBirthProviderW61({transaction:async()=>[]}),null);
  const r=rig();
  assert.equal(await r.provider('../untrusted',9),null);
  assert.equal(await r.provider('owner-w61',0),null);
  assert.equal(r.queries.length,0);
});
test('stale, fixture, wrong epoch, absent SHA, forged source shape fail closed',async()=>{
  for(const change of [
    {observed_at:'2026-10-15T01:00:00Z'}, {fixture_classification:'SYNTHETIC_STAGING'},
    {epoch:8},{source_sha:null},{source:'BROWSER_PAGE'}, {authority_effect:true},
    {generation:0},{created_at:null},
  ])assert.equal(await rig({owners:[{...owner(),...change}]}).provider('owner-w61',9),null);
});
test('Owner process/generation/epoch/source changes before or after SQL => null',async()=>{
  for(const change of [
    {pid:12346},{created_at:'2026-10-15T01:44:00Z'},
    {generation:8},{epoch:10},{process_incarnation_id:'incarnation-new'},
    {source_sha:'b'.repeat(40)},{device_id:'device-other'},
  ])for(const index of [1,2]){
    const owners=[owner(),owner(),owner()];
    owners[index]={...owner(),...change};
    assert.equal(await rig({owners}).provider('owner-w61',9),null,JSON.stringify(change));
  }
});
test('PG17 missing schema, invalid clock, wrong DB, broken catalog, PG15, restart drift fail closed',async()=>{
  const bad=[
    {schema_present:false},{project_table_present:false},
    {server_version_num:160009},{database_name:'../../../private'},
    {postgres_started_at:'2026-10-15T03:00:00Z'},
    {observed_at:'2026-10-15T01:00:00Z'},
  ];
  for(const delta of bad) assert.equal(await rig({rows:[[{...row(),...delta}]]}).provider('owner-w61',9),null);
  assert.equal(await rig({rows:[[row()],[{...row(),postgres_started_at:'2026-10-15T01:59:00Z'}]]}).provider('owner-w61',9),null);
  assert.equal(await rig({rows:[[],[row()]]}).provider('owner-w61',9),null);
  assert.equal(await rig({failSql:true}).provider('owner-w61',9),null);
});
test('birth SQL is unparameterized allowlisted PG catalog only, no network/secret effect',()=>{
  assert.match(OWN_PG_BIRTH_SQL_W61,/pg_catalog\.pg_postmaster_start_time\(\)/);
  assert.match(OWN_PG_BIRTH_SQL_W61,/to_regclass\('destruktion_meta\.project_run_h205f22'\)/);
  assert.doesNotMatch(OWN_PG_BIRTH_SQL_W61,/\b(?:INSERT|UPDATE|DELETE|CALL|COPY|DO|EXECUTE|dblink|http|shell)\b/i);
});
