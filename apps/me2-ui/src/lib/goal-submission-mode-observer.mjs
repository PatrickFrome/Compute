const SCHEMA = 'metaengine.client.goal-submission-mode.v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

function unavailable(previous) {
  return Object.freeze({
    schema: SCHEMA,
    kind: previous?.kind === 'NATIVE_CODING' ? 'NATIVE_CODING' : 'UNAVAILABLE',
    state: 'HOLD',
    reason: 'GOAL_SUBMISSION_MODE_UNAVAILABLE',
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function normalize(value) {
  if (value?.schema !== SCHEMA
    || !['NATIVE_CODING', 'BROWSER', 'UNAVAILABLE'].includes(value.kind)
    || !['HOST_VERIFICATION_REQUIRED', 'HOLD'].includes(value.state)
    || value.automatic_retry_allowed !== false || value.authority_effect !== false
    || (value.state === 'HOST_VERIFICATION_REQUIRED'
      ? value.kind === 'UNAVAILABLE' || value.reason !== null
      : typeof value.reason !== 'string' || !/^[A-Z0-9_]{1,80}$/.test(value.reason))
    || (value.coordination_mode !== undefined && (!['CHAT_LED','CLI_LED'].includes(value.coordination_mode) || value.kind !== 'NATIVE_CODING'))
    || (value.project_id != null && !UUID.test(value.project_id))) {
    throw new Error('goal_submission_mode_readback_invalid');
  }
  return Object.freeze({
    schema: SCHEMA, kind: value.kind, state: value.state, reason: value.reason,
    ...(value.coordination_mode !== undefined ? {coordination_mode:value.coordination_mode} : {}),
    ...(value.project_id !== undefined ? { project_id: value.project_id } : {}),
    automatic_retry_allowed: false, authority_effect: false,
  });
}

// One readonly observation can span several runtime ticks. A tick joins that
// read instead of cancelling its result. Explicit reads start after the user
// action; an older response can never replace their result or survive unmount.
// This helper has no submit/recovery callback and performs no goal effects.
export function createGoalSubmissionModeObserver({ read, publish }) {
  let active = false;
  let epoch = 0;
  let sequence = 0;
  let pending = null;
  let latest = null;

  return Object.freeze({
    start() {
      active = true;
      const started = ++epoch;
      sequence += 1;
      pending = null;
      return () => {
        if (epoch !== started) return;
        active = false;
        epoch += 1;
        sequence += 1;
        pending = null;
      };
    },
    refresh({ fresh = false } = {}) {
      if (!active) return Promise.resolve(unavailable(latest));
      if (pending && !fresh) return pending;
      const requestEpoch = epoch;
      const requestSequence = ++sequence;
      const current = () => active && requestEpoch === epoch && requestSequence === sequence;
      const result = Promise.resolve().then(() => current() ? read() : unavailable(latest))
        .then(normalize).catch(() => unavailable(latest)).then(mode => {
          // A stale result must not become an authorization hint to an awaiting
          // caller either; a fresh submit must see the current observation.
          if (!current()) return unavailable(latest);
          latest = mode;
          publish(mode);
          return mode;
        });
      pending = result;
      const settled = () => { if (pending === result) pending = null; };
      result.then(settled, settled);
      return result;
    },
  });
}

const HOLD_TEXT = Object.freeze({
  OWNED_RUNTIME_HOST_UNAVAILABLE: ['Local runtime unavailable', 'The owned local runtime is not ready. Check its status, then check admission again.'],
  NATIVE_PROFILE_PRESENCE_UNAVAILABLE: ['Native profile unavailable', 'The local runtime profile could not be inspected. Admission remains on hold.'],
  NATIVE_PROFILE_NOT_REGULAR_FILE: ['Native profile needs attention', 'The native profile file did not pass the required file checks. Admission remains on hold.'],
  NATIVE_PROFILE_BUSY: ['Current native project is active', 'Inspect the current project before starting another native goal.'],
  NATIVE_PROFILE_CAPABILITY_UNAVAILABLE: ['Native profile is not loaded', 'The local runtime has not loaded the native goal capability. Check the native runtime setup, then check admission again.'],
  NATIVE_PROFILE_STATUS_TIMEOUT: ['Native admission check timed out', 'The local runtime did not finish the admission check. Check admission again to read its current state.'],
  NATIVE_PROFILE_HOST_UNAVAILABLE: ['Native runtime disconnected', 'The native runtime connection is unavailable. Check runtime status before checking admission again.'],
  NATIVE_PROFILE_VERIFICATION_FAILED: ['Native profile verification failed', 'The local runtime could not verify the native profile and device. Check the native runtime setup.'],
  NATIVE_PROFILE_STATUS_UNAVAILABLE: ['Native admission unavailable', 'The native profile status could not be verified. Check admission again to read its current state.'],
  GOAL_SUBMISSION_MODE_UNAVAILABLE: ['Admission status unavailable', 'A valid admission status could not be read. Check admission again before running the goal.'],
});

// A durable rejection before dispatch has no project or task to poll. The
// backend has already validated this record; this only controls UI observation.
export function shouldPollClientGoal(entry,receipt) {
  if(entry?.kind==='NATIVE_CODING' && entry.state==='FAILED'
    && entry.last_error==='native_goal_rejected_before_dispatch'
    && entry.native_rejection?.schema==='metaengine.native-coding.seed-rejection.v1'
    && entry.native_rejection?.state==='REJECTED_BEFORE_DISPATCH')return false;
  if(entry?.kind==='NATIVE_CODING' && entry.progress?.terminal)return false;
  if(!(receipt?.request_id || entry?.request_id))return false;
  if(entry?.progress?.terminal && (entry.progress.task_state!=='COMPLETED'
    || entry.execution_proof?.user_goal_to_result_readback))return false;
  return true;
}

export function goalSubmissionModeText(mode) {
  if (mode?.state === 'HOLD') {
    const [label, detail] = Object.hasOwn(HOLD_TEXT, mode.reason) ? HOLD_TEXT[mode.reason]
      : ['Admission on hold', 'Admission has not been verified. Check admission again to read its current state.'];
    return { label, detail };
  }
  if(mode.coordination_mode==='CHAT_LED')return {label:'Chat planner → Codex CLI → CRITIC',detail:'The protected profile starts a chat planner. Implementation proposals use native worker permits in the same project. Admission does not prove execution or review.'};
  return { label: 'Codex CLI · Host admission', detail: 'The Host verifies this task for native execution and independent review. Chat sessions have separate status. Admission does not prove execution.' };
}
