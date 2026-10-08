import { CHAT_COMMAND_SCHEMA, normalizeChatCommand } from '../../src/chat-command-policy.mjs';
export { CHAT_COMMAND_SCHEMA, CHAT_COMMAND_ACTIONS, normalizeChatCommand } from '../../src/chat-command-policy.mjs';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const zero = extra => ({ schema:CHAT_COMMAND_SCHEMA,...extra,command_leasing:false,
  execution_authority:false,automatic_retry_allowed:false,authority_effect:false });

export function createChatCommandRoutes({ local, rpc, lookup, json } = {}) {
  if (![rpc,lookup,json].every(value=>typeof value==='function')) throw new Error('chat_command_dependencies_required');
  return async ({ req,path,body,identity }) => {
    if (req.method !== 'POST' || !['/v1/commands/issue-chat','/v1/commands/chat-lookup'].includes(path)) return null;
    if (local !== true) return json(403,zero({accepted:false,error:'chat_command_local_postgres_required'}));
    if (identity?.ok !== true || !identity.id || identity.admin_ready !== true
        || !Array.isArray(identity.admin_scopes) || !identity.admin_scopes.includes('CONTROL_PLANE')) {
      return json(401,zero({accepted:false,error:'chat_command_device_required'}));
    }
    if (path.endsWith('/chat-lookup')) {
      if (!object(body) || Object.keys(body).length!==2 || !uuid.test(body.request_id||'') || !uuid.test(body.relay_id||'')) {
        return json(400,zero({accepted:false,error:'chat_command_lookup_invalid'}));
      }
      const row=await lookup({clientId:identity.id,idempotencyKey:`chat:${body.relay_id}:${body.request_id}`});
      return json(200,zero({found:!!row,request_id:body.request_id,
        command_id:row?.command_id||null,status:row?.status||'NOT_FOUND'}));
    }
    let command;
    try { command=normalizeChatCommand(body); }
    catch { return json(400,zero({accepted:false,error:'chat_command_invalid'})); }
    try {
      const computer=command.action==='COMPUTER_ACTION';
      const issued=await rpc(computer?'h205f22_a2_browser_supervisor_issue_computer_v1':'h205f22_a2_browser_supervisor_issue_native_v1',{
        p_client_id:identity.id,p_action:command.action,p_payload:command.payload,p_ttl_seconds:120,
        p_issued_by:command.issued_by,p_idempotency_key:command.idempotency_key,
        ...(computer?{}:{p_platform:'CHATGPT'}),
      });
      if (issued?.accepted!==true || !uuid.test(issued.command_id||'')) {
        return json(409,zero({accepted:false,error:'chat_command_not_admitted'}));
      }
      return json(200,zero({accepted:true,request_id:command.request_id,command_id:issued.command_id,
        status:String(issued.status||'PENDING'),replayed:issued.replayed===true,relay_id:command.relay_id}));
    } catch {
      // Do not expose database diagnostics, private payloads or credentials.
      return json(409,zero({accepted:false,error:'chat_command_admission_unconfirmed'}));
    }
  };
}
