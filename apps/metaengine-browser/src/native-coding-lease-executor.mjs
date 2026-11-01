import { createHash } from 'node:crypto';
import { nativeCodingEnvelopeSha256 } from './native-coding-transport-proof.mjs';

import {defaultNativePhysicalSlotBudget} from './agent-resource-admission.mjs';

const SHA = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw new Error(`native_coding_executor_${code}`); };
const scopeKeys = ['workspace_id','task_id','lease_generation','agent_id','target_id',
  'agent_generation_epoch','host_incarnation','scope_sha256'];
const sameScope = (a,b) => !!a && !!b && scopeKeys.every(key=>a[key]===b[key]);

// A consumer of an ALREADY ISSUED W30 lease, called by the existing native
// cycle. No timers, task creation, provider enrollment, leasing, or retry here.
// All dependencies are private Host capabilities; there is no public JSON API.
export function createNativeCodingLeaseExecutor({ledger,createRunner,readBoundLease,issuer,onJobAttempted=null,physicalSlotBudget=defaultNativePhysicalSlotBudget()}={}) {
  if (!['reserve','advance','read'].every(key=>typeof ledger?.[key]==='function')
      || typeof createRunner!=='function' || typeof readBoundLease!=='function'
      || typeof issuer?.issueJob!=='function') fail('private_dependencies_required');
  if (onJobAttempted!==null && typeof onJobAttempted!=='function') fail('attempt_hook_invalid');
  if (!Number.isSafeInteger(physicalSlotBudget) || physicalSlotBudget<1) fail('physical_slot_budget_invalid');
  const inflight = new Map();
  return Object.freeze({
    async execute(input,{signal}={}) {
      const request = structuredClone(input);
      const lease = request?.lease;
      if (!UUID.test(lease?.task_id || '') || !Number.isSafeInteger(lease.lease_generation)
          || lease.lease_generation<1 || !['IMPLEMENTER','CRITIC'].includes(request.role)
          || typeof request.prompt!=='string' || !request.prompt.trim()) fail('request_invalid');
      const key = `${lease.task_id}:${lease.lease_generation}`;
      // A duplicate in one heartbeat joins the original result, never a spawn.
      if (inflight.has(key)) return inflight.get(key);
      if (inflight.size>=physicalSlotBudget) return Object.freeze({state:'PHYSICAL_POOL_BUSY',
        physical_effect_replayed:false,automatic_retry_allowed:false,authority_effect:false});
      const operation = (async()=>{
        if (signal?.aborted) fail('cancelled_before_reservation');
        const bound = await readBoundLease({request,phase:'BEFORE_RESERVATION'});
        if (signal?.aborted) fail('cancelled_before_preparation');
        if (!bound || !UUID.test(bound.provider_id || '') || !SHA.test(bound.scope?.scope_sha256 || '')
            || bound.scope.task_id!==lease.task_id || bound.scope.lease_generation!==lease.lease_generation
            || bound.scope.agent_id!==lease.agent_id
            || bound.scope.agent_generation_epoch!==lease.agent_generation_epoch
            || bound.scope.target_id!==`codex-cli:${bound.provider_id}`) fail('lease_binding_denied');
        let reservation = null, runner = null, prepared = null, descriptor = null, fenced = false, fenceFailure = null;
        let attempted = false, jobEnvelope = null, jobDigest = null;
        const initialExpiry = Math.min(Date.parse(bound.permit?.expires_at), Date.parse(bound.lease_expires_at));
        const checkOpen = () => { if (signal?.aborted) fail('cancelled_before_execution'); };
        const fence = () => {
          if (prepared && !fenced) {
            fenced = true;
            try { runner.abandonPrepared(prepared); } catch (error) { fenceFailure = error; throw error; }
          }
        };
        const authorizeLease = async observation=>{
          const current = await readBoundLease({request,...observation});
          checkOpen();
          if (!sameScope(current?.scope,bound.scope) || current.provider_id!==bound.provider_id) fail('native_scope_changed');
          if (observation.phase==='BEFORE_RESUME') {
            if (reservation?.state!=='RESERVED' || !sameScope(reservation.scope,bound.scope)
                || descriptor?.state!=='PREPARED' || observation.run_id!==descriptor.runId) fail('prepared_reservation_binding_denied');
            if (attempted) fail('second_resume_denied');
            // The issuer independently reads the actual suspended worker from
            // its private native registry; it must not trust this observation.
            jobEnvelope = await issuer.issueJob({provider_id:bound.provider_id,agent_id:lease.agent_id,
              task_id:lease.task_id,lease_generation:lease.lease_generation,
              run_id:observation.run_id,prompt_sha256:digest(request.prompt)});
            checkOpen();
            const proof=jobEnvelope?.payload;
            if (!jobEnvelope?.signature || proof?.schema!=='metaengine.codex-cli.job-proof.v1'
                || proof.trust_namespace!=='LOCAL_OPERATOR_QA' || proof.production_qualified!==false
                || proof.task_id!==lease.task_id || proof.lease_generation!==lease.lease_generation
                || proof.run_id!==observation.run_id || proof.run_id!==descriptor.runId || proof.provider_id!==bound.provider_id
                || proof.target_id!==bound.scope.target_id || proof.agent_id!==lease.agent_id
                || proof.agent_generation_epoch!==lease.agent_generation_epoch || proof.role!==request.role
                || proof.workspace_id!==bound.scope.workspace_id || proof.project_id!==current.permit?.project_id
                || proof.permit_id!==current.permit?.permit_id
                || proof.host_process?.process_incarnation_id!==bound.scope.host_incarnation
                || !observation.process?.process_incarnation_id
                || proof.worker_process?.process_incarnation_id!==observation.process.process_incarnation_id
                || proof.job_id!==observation.process.job_id || proof.prompt_sha256!==digest(request.prompt)
                || proof.worktree?.base_sha!==lease.base_sha
                || proof.worktree?.path!==current.permit?.worktree_path
                || !Number.isFinite(Date.parse(proof.expires_at)) || Date.parse(proof.expires_at)<=Date.now()
                || !Number.isFinite(Date.parse(current.lease_expires_at))
                || Date.parse(proof.expires_at)>Date.parse(current.lease_expires_at)
                || !Number.isFinite(initialExpiry) || Date.parse(proof.expires_at)>initialExpiry) fail('job_proof_denied');
            jobDigest = nativeCodingEnvelopeSha256(jobEnvelope);
            // The process is still suspended. No prompt/command execution is
            // permitted until the own-PG synchronous commit is acknowledged.
            await ledger.advance(reservation.scope,{from:'RESERVED',to:'ATTEMPTED',evidence_sha256:jobDigest,job_proof:jobEnvelope});
            attempted = true;
            checkOpen();
            // W30 acknowledges the protected job only after the durable Host
            // transaction and before this callback can permit native resume.
            if(onJobAttempted) await onJobAttempted({request,job_proof:jobEnvelope,
              job_proof_sha256:jobDigest,execution_scope:reservation.scope});
          }
          checkOpen();
          const expiry=Math.min(initialExpiry,Date.parse(current.permit?.expires_at),Date.parse(current.lease_expires_at),
            jobEnvelope ? Date.parse(jobEnvelope.payload.expires_at) : Infinity);
          if(!Number.isFinite(expiry) || expiry<=Date.now()) fail('lease_deadline_expired');
          // This is the native watchdog deadline, not merely an AFTER_EXECUTION
          // check. The runner may narrow it further but must never extend it.
          return {...current.permit,expires_at:new Date(expiry).toISOString()};
        };
        try {
          if (!Number.isFinite(initialExpiry) || initialExpiry<=Date.now()) fail('lease_deadline_expired');
          runner = createRunner({authorizeLease});
          if (!['prepare','describePrepared','runPrepared','abandonPrepared'].every(key=>typeof runner?.[key]==='function')) fail('runner_invalid');
          prepared = await runner.prepare(request,{signal});
          checkOpen();
          descriptor = runner.describePrepared(prepared);
          if (descriptor?.state==='READBACK_ONLY') {
            // Local evidence is only a reconciliation fence, never SQL authority.
            fence();
            const execution = await ledger.read(bound.scope);
            return Object.freeze({state:'READBACK_ONLY',execution,local_preparation_state:'READBACK_ONLY',
              physical_effect_replayed:false,automatic_retry_allowed:false,authority_effect:false});
          }
          if (!descriptor || !Object.isFrozen(descriptor) || descriptor.schema!=='metaengine.codex-cli.prepared-run.v1'
              || descriptor.state!=='PREPARED' || !Object.isFrozen(descriptor.binding) || !UUID.test(descriptor.runId || '')
              || descriptor.sql_reservation!=='NOT_ATTESTED' || descriptor.authority_effect!==false
              || descriptor.automatic_retry_allowed!==false || descriptor.production_qualified!==false
              || ['task_id','agent_id','lease_generation','agent_generation_epoch','base_sha'].some(key=>descriptor.binding?.[key]!==lease[key])
              || descriptor.binding?.role!==request.role
              || !Number.isFinite(Date.parse(descriptor.expiresAt)) || Date.parse(descriptor.expiresAt)<=Date.now()) fail('prepared_descriptor_invalid');
          checkOpen();
          // Original private descriptor/journal identity is passed directly,
          // never serialized into caller JSON or treated as a reservation ACK.
          reservation = await ledger.reserve(bound.scope,{prepared:descriptor});
          checkOpen();
          if (reservation?.state!=='RESERVED') {
            fence();
            return Object.freeze({state:'READBACK_ONLY',execution:reservation?.execution,
              physical_effect_replayed:false,automatic_retry_allowed:false,authority_effect:false});
          }
          if (!sameScope(reservation.scope,bound.scope) || !UUID.test(reservation.scope?.reservation_id || '')) fail('reservation_binding_denied');
          checkOpen();
          const result = await runner.runPrepared(prepared);
          if (!attempted) fail('result_without_durable_attempt');
          const completed = result?.state==='RESULT_READY' && SHA.test(result.result_sha256 || '')
            && result.task_id===lease.task_id && result.lease_generation===lease.lease_generation
            && result.agent_id===lease.agent_id && result.run_id===jobEnvelope.payload.run_id
            && result.role===request.role;
          const resultDigest = completed ? result.result_sha256 : digest(JSON.stringify(result || {}));
          await ledger.advance(reservation.scope,{from:'ATTEMPTED',to:completed?'RESULT_READY':'AMBIGUOUS',evidence_sha256:resultDigest,
            ...(completed?{result_receipt:result}:{})});
          return Object.freeze({state:completed?'RESULT_READY':'AMBIGUOUS',result,job_proof:jobEnvelope,
            job_proof_sha256:jobDigest,execution_scope:reservation.scope,
            // The separate W30 Critic lease and checkpoint owner decide acceptance.
            useful_work_verified:false,production_qualified:false,physical_effect_replayed:false,
            automatic_retry_allowed:false,authority_effect:false});
        } catch (cause) {
          try { fence(); } catch {}
          // A failed or unknown barrier write can itself have committed. Never
          // guess its prior state or issue another transition/re-execution.
          let execution = null;
          try { execution = await ledger.read(bound.scope); } catch {}
          const error = new Error('native_coding_executor_execution_requires_readback',{cause});
          error.execution = execution;
          if (fenceFailure) error.preparation_cleanup_unconfirmed = true;
          error.automatic_retry_allowed = false;
          error.physical_effect_replayed = false;
          throw error;
        }
      })();
      inflight.set(key,operation);
      try { return await operation; } finally { if(inflight.get(key)===operation) inflight.delete(key); }
    },
  });
}
