import crypto from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
// Observation projection only. Local RESUMING remains non-dispatchable. SQL
// preserves all existing ACTIVE admission checks AND reserves this identity
// exclusively for its durable suspended task; the general allocator skips it.
export function reservedBrowserParentTelemetry(row) {
  if(row?.lifecycle_state!=='RESUMING') return null;
  const reservation=row.browser_parent_restoration,r=row.parent_restoration,p=row.transport_proof;
  if(reservation?.schema!=='metaengine.browser.parent-restoration-reservation.v1'
    ||reservation.authority_effect!==false||reservation.automatic_retry_allowed!==false
    ||!UUID.test(reservation.suspension_id||'')||!UUID.test(reservation.task_id||'')||!SHA.test(reservation.checkpoint_sha256||'')
    ||r?.schema!=='metaengine.devos.browser-parent-restoration.v1'||r.checkpoint_sha256!==reservation.checkpoint_sha256
    ||p?.schema!=='metaengine.browser.fleet-transport-proof.v1'||p.authority_effect!==false||p.transport_stage!=='CONVERSATION'
    ||r.agent_id!==row.agent_id||r.tab_id!==row.tab_id||r.target_id!==row.target_id||r.agent_generation_epoch!==row.generation_epoch
    ||p.tab_id!==row.tab_id||p.target_id!==row.target_id||p.generation_epoch!==row.generation_epoch
    ||!SHA.test(r.agent_surface_sha256||'')||p.agent_surface_sha256!==r.agent_surface_sha256
    ||p.conversation_url!==r.conversation_url||p.conversation_url_sha256!==r.conversation_url_sha256
    ||!SHA.test(r.conversation_url_sha256||'')||crypto.createHash('sha256').update(r.conversation_url||'').digest('hex')!==r.conversation_url_sha256
    ||!SHA.test(r.transcript_sha256||'')||!Number.isSafeInteger(r.transcript_floor)||r.transcript_floor<0
    ||!Number.isSafeInteger(r.transcript_total_chars)||r.transcript_total_chars<r.transcript_floor) return null;
  return {...row,lifecycle_state:'ACTIVE',browser_parent_restoration:structuredClone(reservation)};
}
export function browserParentTelemetryFleet(fleet) {
  if(!fleet||!Array.isArray(fleet.agents))return fleet;
  return {...fleet,agents:fleet.agents.filter(row=>!['SUSPENDED','RETIRED'].includes(row.lifecycle_state)).map(row=>reservedBrowserParentTelemetry(row)||row)};
}
