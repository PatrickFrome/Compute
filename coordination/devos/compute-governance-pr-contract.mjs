const REGISTERED_WORKSTREAMS = Object.freeze([
  [/^work\/w1-linux-worker-safety$/, 'C1'],
  [/^work\/t0-hermetic-toolchain$/, 'C2'],
  [/^work\/f1-live-federation$/, 'F1+'],
  [/^work\/r1-continuity-plane$/, 'R1'],
  [/^work\/a1-agent-workspace$/, 'C2'],
  [/^work\/aop1-autonomous-orchestration$/, 'CROSS-CUTTING'],
  [/^work\/same-point-duel-v4-.+$/, 'CROSS-CUTTING'],
  [/^work\/chat-control-plane-browser-bridge$/, 'CROSS-CUTTING'],
  [/^work\/browser-final-2026-convergence-.+$/, 'CROSS-CUTTING'],
  [/^analysis\/integration$/, 'CROSS-CUTTING'],
]);

const CORE_FIELDS = Object.freeze([
  'Canonical Level-1 milestone',
  'Level-2 milestone',
  'Supervisor baseline checkpoint',
  'Assigned branch',
  'Base semantic checkpoint',
]);

const READY_FIELDS = Object.freeze([
  'Canonical acceptance criterion advanced',
  'Why this moves the project toward real compute rather than control-plane-only complexity',
  'Risks / unresolved questions',
  'Rollback or fail-closed behavior',
]);

const REQUIRED_EVIDENCE = Object.freeze([
  'Positive tests pass',
  'Fail-closed/adversarial negative canaries pass',
  'LIVE / SYNTHETIC / CONTROL_PLANE_ONLY / SCHEMA_ONLY / HISTORICAL evidence is clearly labeled',
  'Deep amplifier research completed for the semantic step',
  'Amplifier candidates are classified ADOPT_NOW / EXPERIMENT / DEFER / REJECT',
  'Supabase security advisor reviewed after DDL changes',
  'Supabase performance advisor reviewed after DDL changes',
  'No unapproved mutation-domain overlap',
  'Dependency gates satisfied',
  'Level-2 work remains subordinate to `docs/CANONICAL_ROADMAP.md`',
]);

function escapeRegex(value) {
  return String(value).replace(/[.*+?^{}$()|[\]\\]/g, '\\$&');
}

function stripHtmlComments(body) {
  const source=String(body ?? '').replace(/\r\n/g,'\n');
  const stripped=source.replace(/<!--[\s\S]*?-->/gu,'');
  if (stripped.includes('<!--') || stripped.includes('-->')) {
    throw new Error('MALFORMED_HTML_COMMENT');
  }
  return stripped;
}

function scalarField(body, label) {
  const re = new RegExp('^(?:-\\s*)?' + escapeRegex(label) + ':\\s*(.*?)\\s*$', 'mi');
  const match = body.match(re);
  return match ? match[1].trim() : null;
}

function meaningful(value) {
  if (!value) return false;
  return !/^(?:n\/?a|none|todo|tbd|placeholder)$/iu.test(value.trim());
}

function checkedEvidence(body, label) {
  const re = new RegExp('^-\\s*\\[[xX]\\]\\s+' + escapeRegex(label) + '\\s*$', 'mi');
  return re.test(body);
}

export function expectedLevel1ForBranch(headRef) {
  for (const [pattern, level] of REGISTERED_WORKSTREAMS) {
    if (pattern.test(String(headRef ?? ''))) return level;
  }
  return null;
}

export function evaluateComputeGovernancePr({
  baseRef = '',
  headRef = '',
  body = '',
  draft = true,
} = {}) {
  const blockers = [];
  const advisories = [];
  let cleanBody='';
  try {
    cleanBody=stripHtmlComments(body);
  } catch (error) {
    blockers.push(error.message === 'MALFORMED_HTML_COMMENT' ? error.message : 'HTML_COMMENT_PARSE_ERROR');
    cleanBody=String(body ?? '').replace(/\r\n/g,'\n');
  }

  const fields = Object.fromEntries(
    [...CORE_FIELDS, ...READY_FIELDS].map((label) => [label, scalarField(cleanBody, label)]),
  );
  const expectedLevel1 = expectedLevel1ForBranch(headRef);

  if (baseRef !== 'main') blockers.push('BASE_MUST_BE_MAIN');
  if (!expectedLevel1) blockers.push('UNREGISTERED_WORKSTREAM');

  for (const label of CORE_FIELDS) {
    if (!meaningful(fields[label])) blockers.push('MISSING_CORE_FIELD:' + label);
  }

  if (
    expectedLevel1
    && meaningful(fields['Canonical Level-1 milestone'])
    && fields['Canonical Level-1 milestone'] !== expectedLevel1
  ) {
    blockers.push('LEVEL1_MISMATCH:expected=' + expectedLevel1);
  }

  if (
    meaningful(fields['Assigned branch'])
    && fields['Assigned branch'] !== headRef
  ) {
    blockers.push('ASSIGNED_BRANCH_MISMATCH');
  }

  const missingReadyFields = READY_FIELDS.filter((label) => !meaningful(fields[label]));
  const missingEvidence = REQUIRED_EVIDENCE.filter((label) => !checkedEvidence(cleanBody, label));

  if (draft) {
    advisories.push(...missingReadyFields.map((label) => 'READY_FIELD_PENDING:' + label));
    advisories.push(...missingEvidence.map((label) => 'EVIDENCE_PENDING:' + label));
  } else {
    blockers.push(...missingReadyFields.map((label) => 'MISSING_READY_FIELD:' + label));
    blockers.push(...missingEvidence.map((label) => 'UNCHECKED_EVIDENCE:' + label));
  }

  return Object.freeze({
    schema: 'metaengine.compute-governance-pr-contract.v1',
    base_ref: baseRef,
    head_ref: headRef,
    draft: Boolean(draft),
    expected_level1: expectedLevel1,
    valid_for_current_state: blockers.length === 0,
    eligible_for_merge: !draft && blockers.length === 0,
    blockers: Object.freeze(blockers),
    advisories: Object.freeze(advisories),
    authority_effect: false,
    scheduler_authority: false,
    execution_authority: false,
    promotion_authority: false,
  });
}

function cli() {
  const result = evaluateComputeGovernancePr({
    baseRef: process.env.BASE_REF ?? '',
    headRef: process.env.HEAD_REF ?? '',
    body: process.env.PR_BODY ?? '',
    draft: String(process.env.PR_DRAFT ?? 'true').toLowerCase() === 'true',
  });
  process.stdout.write(JSON.stringify(result) + '\n');
  if (!result.valid_for_current_state) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  cli();
}
