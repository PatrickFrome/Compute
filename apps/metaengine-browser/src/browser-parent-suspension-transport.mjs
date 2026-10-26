import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { resolveAgentPlatformComposer, normalizeAgentPlatformConversationUrl } from './browser-agent-platform.mjs';
import { chatGptControlCount } from './chatgpt-ui-controls.mjs';
import { assertBrowserParentSuspensionReceipt } from './browser-parent-suspension.mjs';
const sha = text => createHash('sha256').update(text).digest('hex');
const fail = code => { throw Error(`browser_parent_transport_${code}`); };

// Private main-process capability. Neither callbacks nor raw checkpoints are
// exposed to page tools. The caller authenticates SQL receipts before return.
export function createBrowserParentSuspensionTransport({ gate, getFleet, capture, transcript,
  freeze, thaw, closeTab, tabExists, readControl, clock = () => new Date() }) {
  const agent = id => getFleet().snapshot().agents.find(row => row.agent_id === id) || fail('agent_missing');
  function control(generation) {
    const c = readControl();
    if (c?.authoritative !== true || c.state !== 'OPEN' || c.continuous_service_allowed !== true
      || c.owner_stop === true || c.generation_floor !== generation) fail('owner_control_changed');
  }
  async function observe(row, floor) {
    const frame = await capture(row.tab_id);
    const composer = resolveAgentPlatformComposer(frame);
    if (frame.target_id !== row.target_id || !composer || composer.value_length !== 0
      || ['STOP', 'CONTINUE', 'RETRY'].some(kind => chatGptControlCount(frame, kind))) fail('not_quiescent');
    const url = normalizeAgentPlatformConversationUrl(frame.url);
    let text = '', total = null;
    do {
      const page = await transcript(row.tab_id, text.length);
      if (page.target_id !== row.target_id || normalizeAgentPlatformConversationUrl(page.url) !== url
        || page.census_truncated !== false || page.offset !== text.length || typeof page.text !== 'string'
        || !Number.isSafeInteger(page.total_chars) || page.total_chars < 0
        || (total !== null && page.total_chars !== total)) fail('transcript_changed');
      total = page.total_chars;
      if (page.text.length === 0 && text.length < total) fail('transcript_incomplete');
      text += page.text;
      if (text.length > total || page.has_more !== (text.length < total)) fail('transcript_incomplete');
    } while (text.length < total);
    if (!Number.isSafeInteger(floor) || floor < 0 || floor > total) fail('transcript_floor_invalid');
    return { conversation_url: url, conversation_url_sha256: sha(url), transcript_floor: floor,
      transcript_total_chars: total, transcript_sha256: sha(text) };
  }
  async function hibernate(receipt) {
    assertBrowserParentSuspensionReceipt(receipt);
    if (receipt.status !== 'SUSPENDED') fail('hibernate_state_invalid');
    if (['BLOCKED_CHILDREN', 'OWNER_STOPPED'].includes(receipt.state)) return receipt;
    if (!['WAITING_CHILDREN', 'READY_TO_RESUME'].includes(receipt.state)) fail('hibernate_state_invalid');
    const current = agent(receipt.checkpoint.agent_id);
    if (current.lifecycle_state === 'RESUMING') {
      if (current.parent_suspension?.suspension_id !== receipt.suspension_id
        || current.parent_suspension?.checkpoint_sha256 !== receipt.checkpoint_sha256
        || !isDeepStrictEqual(current.parent_suspension?.checkpoint, receipt.checkpoint)) fail('resume_reservation_changed');
      return receipt; // Never close the replacement view on old-claim readback.
    }
    const row = await getFleet().suspendParent(receipt);
    if (row.tab_id && tabExists(row.tab_id)) {
      // A receipt cannot authorize closing a replaced or unrelated view.
      if ((await capture(row.tab_id)).target_id !== receipt.checkpoint.target_id) fail('old_target_changed');
      const current = await observe(row, receipt.checkpoint.transcript_floor);
      for (const key of Object.keys(current)) if (current[key] !== receipt.checkpoint[key]) fail('old_conversation_changed');
      await freeze(row.tab_id, row.target_id);
      if (!isDeepStrictEqual(current, await observe(row, receipt.checkpoint.transcript_floor))) fail('old_freeze_changed');
    }
    if (row.tab_id) {
      await closeTab(row.tab_id);
      if (tabExists(row.tab_id)) fail('close_unconfirmed');
    }
    return receipt;
  }
  const api = Object.freeze({
    reconcileCompletedBrowserChildren: async () => {
      const pending = getFleet().snapshot().agents.filter(row => row.lifecycle_state === 'COMPLETED_RELEASING');
      for (const row of pending) {
        if (!row.parent_completed_release?.lease || !row.parent_completed_release?.receipt) fail('completion_release_checkpoint_missing');
        await api.releaseCompletedBrowserChild(row.parent_completed_release);
      }
      return { reconciled: pending.length, authority_effect: false };
    },
    releaseCompletedBrowserChild: ({ lease, receipt }) => gate.exclusive(async () => {
      // Called only by private project completion after durable exact ACK. No
      // generic idle-agent eviction; keep ordinary completed chats intact.
      const row = agent(lease.agent_id);
      if(row.lifecycle_state==='RETIRED') {
        if(!isDeepStrictEqual(row.parent_completed_release,{lease,receipt}) || row.tab_id || row.target_id
          || row.generation_epoch!==lease.agent_generation_epoch+1 || tabExists(lease.tab_id)) fail('retirement_readback_changed');
        return true; // Already destroyed and durably retired, no physical replay.
      }
      if (row.lifecycle_state !== 'COMPLETED_RELEASING'
        && !getFleet().snapshot().agents.some(candidate => ['SUSPENDED', 'RESUMING'].includes(candidate.lifecycle_state))) return false;
      const generation=readControl()?.generation_floor;
      control(generation);
      if (!['ACTIVE', 'COMPLETED_RELEASING'].includes(row.lifecycle_state)
        || (row.tab_id && row.tab_id !== lease.tab_id) || (row.target_id && row.target_id !== lease.target_id)
        || row.generation_epoch !== lease.agent_generation_epoch) fail('completion_binding_changed');
      if (receipt?.schema !== 'metaengine.devos.browser-child-retirement.v1' || receipt.retired !== true
        || !/^[0-9a-f-]{36}$/.test(receipt.retirement_id || '') || receipt.claim_class !== 'READ_ONLY'
        || !['RESULT_READY', 'COMPLETED'].includes(receipt?.state) || receipt.task_id !== lease.task_id
        || receipt.lease_generation !== lease.lease_generation || receipt.authority_effect !== false
        || receipt.automatic_retry_allowed !== false
        || ['agent_id','tab_id','target_id','agent_generation_epoch'].some(key=>receipt[key]!==lease[key])) fail('completion_unconfirmed');
      if (row.tab_id && tabExists(row.tab_id)) {
        await observe(row, 0);
        await freeze(row.tab_id, row.target_id);
      }
      control(generation);
      await getFleet().prepareCompletedBrowserRelease(lease, receipt);
      control(generation);
      if (row.tab_id) {
        await closeTab(row.tab_id);
        if (tabExists(row.tab_id)) fail('completed_close_unconfirmed');
      }
      await getFleet().retire(row.agent_id);
      return true;
    }),
    withQuiescentParent: ({ lease, checkpointContext }, callback) => gate.exclusive(async () => {
      control(checkpointContext.control_generation);
      const row = agent(lease.agent_id);
      if (row.lifecycle_state !== 'ACTIVE' || row.tab_id !== lease.tab_id || row.target_id !== lease.target_id
        || row.generation_epoch !== lease.agent_generation_epoch) fail('lease_binding_changed');
      const before = await observe(row, checkpointContext.transcript_floor);
      await freeze(row.tab_id, row.target_id); // Proven local renderer freeze; never a model Send.
      const after = await observe(row, checkpointContext.transcript_floor);
      if (!isDeepStrictEqual(before, after)) fail('freeze_transcript_changed');
      control(checkpointContext.control_generation);
      const checkpoint = { schema: 'metaengine.browser.parent-checkpoint.v1', ...checkpointContext, ...after,
        agent_id: row.agent_id, tab_id: row.tab_id, target_id: row.target_id,
        agent_generation_epoch: row.generation_epoch, agent_surface_sha256: row.transport_proof.agent_surface_sha256,
        observed_at: clock().toISOString() };
      // Durable parked state precedes SQL. An uncertain callback never restores
      // ACTIVE and never frees this slot; only exact signed readback may close.
      await getFleet().prepareParentSuspension(checkpoint);
      const receipt = assertBrowserParentSuspensionReceipt(await callback(checkpoint), {
        task_id: lease.task_id, old_lease_generation: lease.lease_generation, checkpoint });
      return hibernate(receipt);
    }),
    hibernateStored: receipt => gate.exclusive(() => hibernate(receipt)),
    resumeStored: ({ receipt, control_generation }, callback) => gate.exclusive(async () => {
      assertBrowserParentSuspensionReceipt(receipt); control(control_generation);
      const active = agent(receipt.checkpoint.agent_id);
      if (active.lifecycle_state === 'ACTIVE' && receipt.status === 'RESUMED') {
        const prior = active.parent_resumed_receipt, lease = receipt.lease;
        if (prior?.status !== 'RESUMED' || prior.suspension_id !== receipt.suspension_id
          || prior.checkpoint_sha256 !== receipt.checkpoint_sha256
          || !isDeepStrictEqual(prior.checkpoint, receipt.checkpoint)
          || ['task_id', 'lease_generation', 'claim_id', 'agent_id', 'tab_id', 'target_id', 'agent_generation_epoch']
            .some(key => prior.lease?.[key] !== lease?.[key])
          || active.agent_id !== lease.agent_id || active.tab_id !== lease.tab_id
          || active.target_id !== lease.target_id || active.generation_epoch !== lease.agent_generation_epoch)
          fail('active_resume_binding_changed');
        // Acknowledged conversation is allowed to grow and generate. Repeated
        // heartbeat readback is not another restoration or model continuation.
        const current = await capture(active.tab_id);
        if (current.target_id !== active.target_id
          || sha(normalizeAgentPlatformConversationUrl(current.url)) !== receipt.checkpoint.conversation_url_sha256)
          fail('active_resume_conversation_changed');
        control(control_generation);
        return receipt;
      }
      const row = await getFleet().beginParentResume(receipt);
      if (row.parent_resume_state === 'CAPACITY_WAIT') return receipt;
      const observed = await observe(row, receipt.checkpoint.transcript_floor);
      for (const key of Object.keys(observed)) if (observed[key] !== receipt.checkpoint[key]) fail('restoration_changed');
      await freeze(row.tab_id, row.target_id);
      if (!isDeepStrictEqual(observed, await observe(row, receipt.checkpoint.transcript_floor))) fail('restore_freeze_changed');
      control(control_generation);
      const restoration = { schema: 'metaengine.devos.browser-parent-restoration.v1', ...observed,
        checkpoint_sha256: receipt.checkpoint_sha256, agent_id: row.agent_id,
        agent_surface_sha256: receipt.checkpoint.agent_surface_sha256,
        tab_id: row.tab_id, target_id: row.target_id, agent_generation_epoch: row.generation_epoch,
        observed_at: row.parent_restoration?.observed_at || clock().toISOString(), control_generation };
      if (row.parent_restoration && !isDeepStrictEqual(row.parent_restoration, restoration)) fail('restoration_epoch_changed');
      if (row.lifecycle_state !== 'ACTIVE') await getFleet().reserveParentRestoration(restoration);
      const resumed = assertBrowserParentSuspensionReceipt(await callback(restoration), {
        suspension_id: receipt.suspension_id, checkpoint: receipt.checkpoint });
      if (resumed.status === 'SUSPENDED') return resumed;
      control(control_generation);
      await thaw(row.tab_id, row.target_id);
      control(control_generation);
      await getFleet().completeParentResume(resumed, restoration);
      return resumed;
    }),
  });
  return api;
}


// Isolated from Electron imports so the destruction/registry ordering can be
// tested with an event source. A removed view is not a destroyed renderer.
export async function closeExactBrowserParentView({ view, tabId, closeTab, timeoutMs = 5000 }) {
  if (view && !view.webContents.isDestroyed()) {
    await new Promise((resolve, reject) => {
      const done = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => {
        view.webContents.removeListener('destroyed', done);
        reject(Error('browser_parent_close_destroy_readback_required'));
      }, timeoutMs);
      view.webContents.once('destroyed', done);
      try { view.webContents.close(); }
      catch (error) { clearTimeout(timer); view.webContents.removeListener('destroyed', done); reject(error); }
    });
    if (!view.webContents.isDestroyed()) throw Error('browser_parent_close_not_destroyed');
  }
  await closeTab(tabId);
}
