import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {LOCAL_RUNTIME_MIGRATIONS} from './local-runtime-migrations.mjs';
import {requireNativeRunCallbackPublication} from '../../apps/metaengine-browser/src/native-coding-run-callback-journal.mjs';
const source=await fs.readFile(new URL('./native-coding-callback-publication-v1.sql',import.meta.url),'utf8');
const specs=JSON.parse(/expected jsonb:='([^']+)'::jsonb/.exec(source)[1]);
const bodies=text=>new Map([...text.matchAll(/create(?: or replace)? function ((?:destruktion_meta|public)\.\w+)\((.*?)\)\s*returns (\w+) language (\w+)(.*?)as \$\$(.*?)\$\$;/gs)].map(m=>[m[1],m[6]]));
const actual=bodies(source);
test('every replay-attested function body is pinned to its exact source bytes',()=>{
 assert.equal(specs.length,8);for(const spec of specs){const body=actual.get(spec.signature.split('(')[0]);assert.ok(body);
  assert.equal(createHash('sha256').update(body).digest('hex'),spec.sha256,spec.signature);
 }
});
for(const file of ['20261022070000_native_coding_execution_ledger_v1.sql','20261023082533_native_coding_operator_qa_admission_v1.sql'])test('v1 algorithms remain byte-identical except excluding new private column: '+file,async()=>{
 const original=await fs.readFile(new URL('../../supabase/migrations/'+file,import.meta.url),'utf8');
 for(const [name,body] of bodies(original)){if(!actual.has(name))continue;
  assert.equal(actual.get(name).replaceAll("(to_jsonb(v_row)-'callback_publication')",'to_jsonb(v_row)').replaceAll("(to_jsonb(e)-'callback_publication')",'to_jsonb(e)'),body);
  const spec=specs.find(s=>s.signature.startsWith(name+'('));assert.equal(spec.old_sha256,createHash('sha256').update(body).digest('hex'));
 }
});
test('SQL remains unregistered and default gate refuses every caller override',()=>{
 assert.equal(LOCAL_RUNTIME_MIGRATIONS.some(m=>String(m.source_url).includes('callback-publication')),false);
 for(const value of [undefined,{},true,{directory_durable:true,pg_committed:true,send_capability:true}])assert.throws(()=>requireNativeRunCallbackPublication(value),/directory_durability_unqualified/);
});
test('default composition names the genuine missing Owner reader; no new IPC publication action',async()=>{
 const host=await fs.readFile(new URL('./runtime-host.mjs',import.meta.url),'utf8');assert.match(host,/callbackPublicationIdentity:\{hostInstanceId:descriptor.instance_id,hostPid:process.pid,postgresIdentity:runtime.postgresIdentity\}/);
 assert.match(host,/readOwnerControl:null/);
 const ipc=await fs.readFile(new URL('./native-coding-host-ipc.mjs',import.meta.url),'utf8');assert.ok(!ipc.includes('callback_publication'));assert.ok(!ipc.includes('CALLBACK_PUBLICATION'));
});
