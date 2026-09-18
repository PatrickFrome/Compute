import { METAENGINE_DEVOS_SOURCE_SNAPSHOT_SCHEMA } from './metaengine-devos-source-surfaces.mjs';

const MAX_TERMINAL = 48;
const MAX_TESTS = 32;
const MAX_LOGS = 64;

function zeroAuthorityContract() {
  return Object.freeze({
    projection_is_authority: false,
    scheduler_authority: false,
    execution_authority: false,
    command_leasing: false,
    automatic_effect_retry_allowed: false,
    page_model_authority: false,
    authority_effect: false,
  });
}

function text(value, max = 240) {
  const out = String(value ?? '').trim();
  return out ? out.slice(0, max) : null;
}

function safeArray(value) { return Array.isArray(value) ? value : []; }

function verificationReceipt(capability, result) {
  if (!result || typeof result !== 'object') return null;
  return Object.freeze({
    capability,
    state: 'VERIFIED',
    receipt_schema: text(result.schema, 160),
    valid: result.valid === true || result.ok === true,
    ok: result.ok === true,
    ref: text(result.candidate_id ?? result.evidence_id ?? result.digest ?? result.source_head, 240),
    ...zeroAuthorityContract(),
  });
}

export function projectDevOSDevelopmentSources({ development_plane = null, startup_logs = [] } = {}) {
  const plane = development_plane;
  const validPlane = plane
    && plane.schema === 'metaengine.development-plane.snapshot.v1'
    && plane.authority_effect === false
    && plane.browser_actuation_authority === false
    && plane.page_command_authority === false;
  if (!validPlane) return null;

  const readModel = plane.devos_repo_read_model;
  const codeFiles = readModel?.schema === 'metaengine.development-plane.repo-read-model.v1'
    && readModel.authority_effect === false
    && Array.isArray(readModel.code_files)
    ? readModel.code_files.slice(0, 2).map((file) => Object.freeze({
      relative_path: text(file?.relative_path, 400),
      sha256: text(file?.sha256, 80),
      bytes: Math.max(0, Number(file?.bytes || 0)),
      truncated: file?.truncated === true,
      language: text(file?.language, 48),
      text: typeof file?.text === 'string' ? file.text.slice(0, 24 * 1024) : '',
      ...zeroAuthorityContract(),
    })).filter((file) => file.relative_path && file.sha256 && file.text)
    : [];

  const transcript = safeArray(plane.transcript).slice(-MAX_TERMINAL).map((row) => Object.freeze({
    seq: Math.max(0, Number(row?.seq || 0)),
    at: text(row?.at, 80),
    capability: text(row?.capability, 96),
    state: text(row?.state, 48) || 'UNKNOWN',
    summary: text(row?.summary, 800),
    ...zeroAuthorityContract(),
  }));

  const candidate = plane.last_results?.CANDIDATE_CAPSULE_CREATE;
  const components = candidate?.schema === 'metaengine.development-plane.candidate-capsule.v1'
    && Array.isArray(candidate.components)
    ? candidate.components.slice(0, 64).map((row) => Object.freeze({
      path: text(row?.path, 400), change: text(row?.change, 24), digest: text(row?.digest, 80), ...zeroAuthorityContract(),
    })).filter((row) => row.path && row.change && row.digest)
    : [];

  const receipts = [];
  for (const capability of ['CANDIDATE_CAPSULE_VERIFY', 'VERIFICATION_SANDBOX_PLAN_VERIFY', 'ADVISORY_EVIDENCE_VERIFY']) {
    const receipt = verificationReceipt(capability, plane.last_results?.[capability]);
    if (receipt) receipts.push(receipt);
  }

  const logs = [];
  let seq = 0;
  for (const row of safeArray(startup_logs).slice(-MAX_LOGS)) {
    const message = text(row?.reason ?? row?.message, 1200);
    if (!message) continue;
    logs.push(Object.freeze({ seq: ++seq, at: text(row?.observed_at, 80), level: 'ERROR', source: text(row?.subsystem, 96) || 'STARTUP', message, ...zeroAuthorityContract() }));
  }
  for (const row of transcript.slice(-Math.max(0, MAX_LOGS - logs.length))) {
    if (!['ERROR', 'FAILED', 'LOST'].includes(String(row.state || '').toUpperCase())) continue;
    logs.push(Object.freeze({ seq: ++seq, at: row.at, level: 'ERROR', source: row.capability || 'DEVELOPMENT_PLANE', message: row.summary || row.state, ...zeroAuthorityContract() }));
  }
  if (!logs.length && plane.state) logs.push(Object.freeze({ seq: ++seq, at: null, level: 'INFO', source: 'DEVELOPMENT_PLANE', message: `state=${text(plane.state, 48)}`, ...zeroAuthorityContract() }));

  return Object.freeze({
    schema: METAENGINE_DEVOS_SOURCE_SNAPSHOT_SCHEMA,
    repository: text(readModel?.repository, 200),
    source_head: text(readModel?.head, 80),
    source_ref: text(readModel?.ref, 400),
    code_files: Object.freeze(codeFiles),
    terminal_entries: Object.freeze(transcript),
    terminal_entry_count: Math.max(transcript.length, Number(plane.transcript_total_count || transcript.length)),
    candidate_id: text(candidate?.candidate_id, 180),
    diff_components: Object.freeze(components),
    diff_component_count: components.length,
    test_receipts: Object.freeze(receipts.slice(-MAX_TESTS)),
    test_receipt_count: receipts.length,
    log_entries: Object.freeze(logs.slice(-MAX_LOGS)),
    log_entry_count: logs.length,
    bounded: true,
    source_backed: true,
    renderer_authority: false,
    direct_process_authority: false,
    arbitrary_path_authority: false,
    ...zeroAuthorityContract(),
  });
}
