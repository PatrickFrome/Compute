import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const edgePath = path.resolve(here, '../../../supabase/functions/a2-browser-native-supervisor-v1/index.ts');
async function source() { return fs.readFile(edgePath, 'utf8'); }

test('mesh sync remains behind existing signed native device authentication', async () => {
  const raw = await source();
  assert.match(raw, /const MESH_SYNC_RPC='h205f22_a2_supervisor_mesh_sync_v1'/);
  assert.match(raw, /const LEASE_RPC='h205f22_a2_browser_supervisor_lease_v3'/);
  assert.match(raw, /const COMPLETE_RPC='h205f22_a2_browser_supervisor_complete_v5'/);
  const auth = raw.lastIndexOf('const identity=await authenticateDevice(req,canonicalPath,bodyText)');
  const stateRoute = raw.lastIndexOf("if(req.method==='POST'&&path==='/v1/state')");
  const commandRoute = raw.lastIndexOf("if(req.method==='POST'&&path==='/v1/commands/next')");
  assert.ok(auth >= 0 && stateRoute > auth && commandRoute > auth);
  assert.match(raw, /if\(identity\.ok!==true\)return json\(401,\{error:'device_auth_required'/);
});

test('edge persists only a bounded privacy-safe mesh projection', async () => {
  const raw = await source();
  assert.match(raw, /mesh\.supervisors\.length>16/);
  assert.match(raw, /supervisor_id!==`sup_\$\{conversation_url_sha256\.slice\(0,24\)\}`/);
  assert.match(raw, /conversation_url_sha256/);
  assert.doesNotMatch(raw, /conversation_url:\s*String/);
  assert.match(raw, /authority_effect:false/);
  assert.match(raw, /await rpc\(MESH_SYNC_RPC,\{p_client_id:id,p_mesh:s\.supervisor_mesh\}\)/);
});

test('mesh telemetry does not replace typed command lease or completion authority', async () => {
  const raw = await source();
  assert.match(raw, /async function lease\(req:Request,body:any\)\{return rpc\(LEASE_RPC/);
  assert.match(raw, /async function complete\(req:Request,commandId:string,body:any\)/);
  assert.doesNotMatch(raw, /MESH_SYNC_RPC[^\n]*COMMAND_TABLE/);
  assert.doesNotMatch(raw, /supervisor_mesh[^\n]*arbitrary_eval:true/);
});
