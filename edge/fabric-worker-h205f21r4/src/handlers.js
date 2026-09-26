
import { normalizeWake, slotAllowed, workflowId } from './core.mjs';
import { bearerAuthorized } from './auth.js';

export async function handleFetch(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/health') {
    return Response.json({ schema: 'metaengine.compute.fabric.cloudflare.health.v1', ok: true, authority: 'SUPABASE' });
  }
  if (url.pathname !== '/wake' || request.method !== 'POST') return new Response('Not found', { status: 404 });
  if (!(await bearerAuthorized(request, env.WAKE_TOKEN))) return new Response('Unauthorized', { status: 401 });
  const body = normalizeWake(await request.json());
  if (!slotAllowed(body.slot_id, env.ALLOWED_SLOTS)) {
    return Response.json({ accepted: false, reason: 'SLOT_NOT_ENABLED', slot_id: body.slot_id }, { status: 202 });
  }
  await env.DISPATCH_QUEUE.send(body);
  return Response.json({ accepted: true, workflow_id: workflowId(body) }, { status: 202 });
}

export async function handleQueue(batch, env) {
  const creates = [];
  for (const message of batch.messages) {
    const wake = normalizeWake(message.body);
    creates.push({ id: workflowId(wake), params: wake });
  }
  await env.FABRIC_WORKFLOW.createBatch(creates);
  batch.ackAll();
}
