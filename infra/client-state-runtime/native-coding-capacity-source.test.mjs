import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const source=await fs.readFile(new URL('./native-coding-capacity-v2.sql',import.meta.url),'utf8');
const expected=JSON.parse(/expected jsonb:='(\[.*\])'::jsonb;spec/.exec(source)[1]);
test('the additive SQL replay attestation pins every new body/signature/privilege boundary',()=>{
 const found=[...source.matchAll(/create or replace function (destruktion_meta\.\w+)\((.*?)\)\nreturns (.*?) language plpgsql security (invoker|definer) set search_path=pg_catalog,public,destruktion_meta as \$\$(.*?)\$\$;/gs)];
 assert.equal(found.length,11);assert.equal(expected.length,found.length);
 for(const [,name,args,returns,security,body] of found){
  const parts=args.trim()?args.replaceAll('\n',' ').split(',').map(x=>x.trim().split(/\s+/)):[];
  const signature=name+'('+parts.map(x=>x[1]).join(',')+')',entry=expected.find(x=>x.signature===signature);
  assert.ok(entry,signature);assert.deepEqual(entry.args,parts.map(x=>x[0]));
  assert.equal(entry.return_type,returns.replace('setof ',''));assert.equal(entry.setof,returns.startsWith('setof '));
  assert.equal(entry.definer,security==='definer');assert.equal(entry.sha256,createHash('sha256').update(body).digest('hex'));
  assert.ok(source.includes('revoke all on function '+signature+' from public,anon,authenticated,service_role;'));
 }
 assert.equal(expected.filter(x=>x.definer).length,1);assert.equal(expected.find(x=>x.definer).signature,'destruktion_meta.native_coding_capacity_claim_gate_v2()');
});
test('reviewed additive capacity migration is explicitly registered, not a replacement v1 migration',async()=>{
 const migrations=await fs.readFile(new URL('./local-runtime-migrations.mjs',import.meta.url),'utf8');
 assert.ok(migrations.includes("path:'native-coding-capacity-v2.sql'"));
 assert.match(migrations,/reviewed_native_capacity_upgrade:true/);
 for(const entry of expected)assert.ok(migrations.includes(entry.signature));
 assert.doesNotMatch(source,/create (?:or replace )?function destruktion_meta\.native_coding_(?:service_heartbeat_v1|service_admissible_v1|setup_operation_v1)\(/);
 assert.doesNotMatch(source,/create table/i);
 assert.match(source,/add column if not exists capacity_evidence jsonb/);
 assert.match(source,/octet_length\(capacity_evidence::text\)<=262144/);
});
test('read census has no MVCC write and the effect fence cannot renew evidence or introduce rows',()=>{
 const functionBody=name=>source.match(new RegExp('create or replace function destruktion_meta\\.'+name+'\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;'))[1];
 const lock=functionBody('native_coding_capacity_lock_v1');assert.match(lock,/hashtextextended\('native-capacity:'\|\|p_device::text,303001\)/);
 assert.doesNotMatch(functionBody('native_coding_capacity_rows_v1'),/where p.device_id=p_device and p.client_id=p_client/);
 const census=functionBody('native_coding_capacity_census_v1');assert.doesNotMatch(census,/effect_fence|\bupdate\b|\binsert\b|\bdelete\b/i);
 const fence=functionBody('native_coding_capacity_effect_fence_v1');
 assert.doesNotMatch(fence,/where device_id=p_device and client_id=p_client/);
 assert.match(fence,/set capacity_evidence=capacity_evidence/);assert.doesNotMatch(fence,/\binsert\b|\bdelete\b|set registered_at|set expires_at|set proven_at|set body\s*=/i);
 assert.ok(fence.indexOf('native_coding_capacity_lock_v1')<fence.indexOf("'native-service:'"));
 assert.ok(fence.indexOf("'native-service:'")<fence.indexOf('update destruktion_meta.native_coding_service_heartbeat_h205f22'));
});
