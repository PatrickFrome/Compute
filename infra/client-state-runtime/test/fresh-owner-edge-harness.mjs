// TEST ONLY. Loads the ACTUAL Edge source with TypeScript stripping only.
// Replaces Deno's listener/transport with in-process Request/Response dispatch.
// No sockets, external URL, real credential, user database or native effect.
import assert from 'node:assert/strict';
import {registerHooks,stripTypeScriptTypes} from 'node:module';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {RPC_ALLOWLIST,RPC_CATALOG_QUERY,compileTableRequest,compileRpcRequest} from '../db-api-core.mjs';

export async function freshOwnerEdgeHarness(sql,{edgeSql=sql}={}) {
  const signatures=await sql.unsafe(RPC_CATALOG_QUERY,[JSON.stringify(RPC_ALLOWLIST)]);
  const key='a'.repeat(64),base='http://127.0.0.1:25433/a2-browser-native-supervisor-v1',api='http://127.0.0.1:25432';
  const env={LOCAL_STATE_RUNTIME:'LOCAL_POSTGRES',LOCAL_STATE_DATABASE_URL:'postgres://synthetic:fixture@127.0.0.1:25431/fixture',
    LOCAL_STATE_API_BASE_URL:api,LOCAL_STATE_API_KEY:key,LOCAL_STATE_INSTANCE_ID:'11111111-1111-4111-8111-111111111111',LOCAL_STATE_EDGE_PORT:'25433'};
  const previous={fetch:globalThis.fetch,Deno:globalThis.Deno};
  const calls=[];let handler;
  globalThis.Deno={env:{get:name=>env[name]},serve:(options,callback)=>{handler=callback;return {};}};
  globalThis.fetch=async(input,init={})=>{
    const url=new URL(input);assert.equal(url.origin,api,'fixture rejects every real network destination');
    assert.equal(init.headers.apikey,key);assert(url.pathname.startsWith('/rest/v1/'));
    const target=decodeURIComponent(url.pathname.slice('/rest/v1/'.length));
    const body=init.body?JSON.parse(init.body):undefined;
    const plan=target.startsWith('rpc/')?compileRpcRequest(target.slice(4),body,signatures)
      :compileTableRequest({table:target,method:init.method||'GET',params:url.searchParams,body,prefer:init.headers.prefer});
    // Supplemental single-backend PG18 uses local role switches to test actual
    // API grants. NOT evidence of separate PG17 network sessions/concurrency.
    if(edgeSql===sql)await sql.unsafe('SET ROLE local_state_api');
    let rows;
    // Mirror production db-api driverValues for postgres.js: passing a JSON
    // string here is serialized again after native PG infers the JSONB OID.
    // PGlite's query adapter instead accepts serialized JSON text directly.
    const values=plan.values.map(({value,json,elementOid})=>{
      if(value===null)return null;
      if(json)return typeof edgeSql.json==='function'?edgeSql.json(value):JSON.stringify(value);
      if(elementOid&&typeof edgeSql.array==='function')return edgeSql.array(value,elementOid);
      return value;
    });
    try {rows=await edgeSql.unsafe(plan.text,values);}
    finally{if(edgeSql===sql)await sql.unsafe('RESET ROLE');}
    return new Response(JSON.stringify(plan.scalar?rows[0]?.value??null:plan.returning===false?null:rows),{status:plan.status});
  };
  const target=new URL('../../../apps/metaengine-browser/supabase/a2-browser-native-supervisor-v1/index.ts?fresh-owner-test='+randomUUID(),import.meta.url);
  const hooks=registerHooks({
    resolve(specifier,context,nextResolve){
      if(specifier==='npm:postgres@3.4.7')return {url:'data:text/javascript,export default function(){return new Proxy({},{get(){throw Error("fixture_direct_sql_forbidden")}})}',shortCircuit:true};
      return nextResolve(specifier,context);
    },
    load(url,context,nextLoad){
      if(url===target.href)return {format:'module',source:stripTypeScriptTypes(readFileSync(target,'utf8')),shortCircuit:true};
      return nextLoad(url,context);
    },
  });
  try {await import(target.href);}catch(error){globalThis.fetch=previous.fetch;globalThis.Deno=previous.Deno;throw error;}
  finally{hooks.deregister();}
  assert.equal(typeof handler,'function');
  return {
    base,calls,
    async fetch(input,init={}){
      assert(String(input).startsWith(base+'/'));assert.equal(init.redirect,'error');
      calls.push({url:String(input),method:init.method,headers:{...init.headers},body:init.body});
      return handler(new Request(input,init));
    },
    close(){globalThis.fetch=previous.fetch;if(previous.Deno===undefined)delete globalThis.Deno;else globalThis.Deno=previous.Deno;},
  };
}
