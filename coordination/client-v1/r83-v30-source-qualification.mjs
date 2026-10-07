import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA40 = /^[0-9a-f]{40}$/;
const EDGE_ROOT = 'apps/metaengine-browser/supabase/a2-browser-native-supervisor-v1';
const REQUIRED_GATES = [
  'signed_health_required', 'installed_electron_signed_e2e_required',
  'bounded_durable_lease_readback_required', 'result_receipt_readback_required',
  'rollback_drill_required',
];
const REQUIRED_CAPABILITIES = [
  'createDbInspectRoutes', 'createEmergencyCommandRoutes', 'createPostgresCommandWakeHub',
  'createRsiResultReceiptReadback', 'createCognitiveDeltaRoutes',
  'h205f22_a2_browser_supervisor_issue_native_v1', '/v1/commands/issue-tool',
];

function requireValue(condition, reason) {
  if (!condition) throw new Error(`r83_v30_${reason}`);
}

// This is a source qualification of one externally observed backend/client pair.
// A green result never records a live test or grants promotion/actuation authority.
export function validateR83V30Manifest(m) {
  requireValue(m?.schema === 'metaengine.r83.edge-canary-v30-source-qualification.v1', 'schema');
  requireValue(m.qualification_id === 'R83_V30_20261007', 'lineage');
  requireValue(m.project_ref === 'jhriwwsryeqsvvvufkok', 'project');
  requireValue(m.candidate?.slug === 'a2-browser-native-supervisor-v14-canary', 'candidate_slug');
  requireValue(m.candidate?.deployed_version === 30, 'candidate_version');
  requireValue(m.candidate?.source_pin === '6aeea9f68fa91ef38f4d0aea4eddaf1e4d29c0f9', 'candidate_source');
  requireValue(m.candidate?.ezbr_sha256 === '2197ca6ef50ae9a00f59a05edecf094b383824ebfddd19d917b73610feb831e6', 'candidate_digest');
  requireValue(SHA40.test(m.candidate?.index_git_blob_sha1), 'candidate_index');
  requireValue(m.candidate.source_binding_complete === true, 'candidate_binding');
  requireValue(Array.isArray(m.candidate.observed_import_pins)
    && m.candidate.observed_import_pins.length === 1
    && m.candidate.observed_import_pins[0] === m.candidate.source_pin, 'candidate_import_pins');
  requireValue(m.installed_client?.source_head === 'be5e84a0524aece3f5ba1a5d84c09f38b05e4d8c'
    && m.installed_client.package_version === '0.7.0-dev.37493000001.1'
    && m.installed_client.installer_sha256 === '81504d8e433704629d350eecadd29ffb30883f0250310bc8d69399840b09884a',
  'installed_client_subject');
  requireValue(m.stable?.slug === 'a2-browser-native-supervisor-v1'
    && m.stable.deployed_version === 14
    && m.stable.ezbr_sha256 === '5adc4cf2b05246c76a909697b4e613260296c93dc3d73ee9ed5f7bdec653731a', 'stable_subject');
  requireValue(m.rollback?.slug === 'a2-browser-native-supervisor-v12-rollback-snapshot'
    && m.rollback.deployed_version === 1
    && m.rollback.ezbr_sha256 === m.stable.ezbr_sha256, 'rollback_subject');
  requireValue(m.rollback.source_binding_mode === 'PINNED_MIXED_IMPORT_CLOSURE_EXACT_ARTIFACT_CLONE'
    && m.rollback.exact_stable_artifact_digest_match === true
    && m.rollback.rollback_snapshot_deployed === true, 'rollback_clone');
  requireValue(Array.isArray(m.rollback.observed_import_pins)
    && m.rollback.observed_import_pins.length > 0
    && m.rollback.observed_import_pins.every(pin => SHA40.test(pin))
    && new Set(m.rollback.observed_import_pins).size === m.rollback.observed_import_pins.length,
  'rollback_import_pins');
  requireValue(m.live_qualification?.completed === false, 'live_completion');
  for (const key of REQUIRED_GATES) requireValue(m.live_qualification[key] === true, `gate_${key}`);
  requireValue(m.live_qualification.postgres_notify_accelerator_required === false, 'notify_optional');
  requireValue(m.evidence_policy?.mode === 'EXTERNAL_SHA_BOUND'
    && m.evidence_policy.build_once_test_exact_artifact === true
    && m.evidence_policy.live_evidence_must_bind_exact_backend_and_client_subjects === true
    && m.evidence_policy.source_manifest_mutation_after_live_evidence === false
    && m.evidence_policy.authority_effect === false, 'external_evidence_policy');
  requireValue(m.live_evidence?.completed === false
    && m.live_evidence.recorded_in_source_manifest === false
    && m.live_evidence.rollback_drill_completed === false
    && m.live_evidence.authority_effect === false, 'live_evidence');
  requireValue(m.promotion_authorized === false && m.automatic_promotion_allowed === false
    && m.authority_effect === false, 'authority');
  requireValue(Array.isArray(m.required_capabilities)
    && REQUIRED_CAPABILITIES.every(value => m.required_capabilities.includes(value)), 'capabilities');
  requireValue(Array.isArray(m.candidate.imports) && m.candidate.imports.length > 0, 'import_closure');
  const paths = new Set();
  for (const row of m.candidate.imports) {
    requireValue(typeof row.path === 'string' && row.path.startsWith(`${EDGE_ROOT}/`)
      && !row.path.includes('..') && !row.path.includes('\\')
      && row.path.endsWith('.mjs') && !paths.has(row.path)
      && SHA40.test(row.git_blob_sha1), 'import_identity');
    paths.add(row.path);
  }
  return Object.freeze({
    schema: 'metaengine.r83.edge-canary-v30-static-result.v1',
    state: 'STATIC_QUALIFIED_LIVE_GATES_OPEN',
    backend_source: m.candidate.source_pin,
    installed_client_source: m.installed_client.source_head,
    live_qualification_completed: false,
    promotion_authorized: false,
    automatic_promotion_allowed: false,
    authority_effect: false,
  });
}

export function qualifyR83V30Source({ repoRoot, manifest }) {
  const result = validateR83V30Manifest(manifest);
  const git = (...args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
  const pin = manifest.candidate.source_pin;
  git('cat-file', '-e', `${pin}^{commit}`);
  git('merge-base', '--is-ancestor', pin, 'HEAD');
  git('diff', '--exit-code', pin, 'HEAD', '--', EDGE_ROOT, 'supabase/migrations');
  git('diff', '--exit-code', 'HEAD', '--', EDGE_ROOT, 'supabase/migrations');
  requireValue(git('ls-files', '--others', '--exclude-standard', '--', EDGE_ROOT, 'supabase/migrations') === '',
    'untracked_deployment_inputs');
  requireValue(git('rev-parse', `${pin}:${EDGE_ROOT}/index.ts`)
    === manifest.candidate.index_git_blob_sha1, 'root_blob_mismatch');
  const source = git('show', `${pin}:${EDGE_ROOT}/index.ts`);
  const imports = [...source.matchAll(/from ['"]\.\/([^'"]+)['"]/g)]
    .map(match => `${EDGE_ROOT}/${match[1]}`).sort();
  requireValue(JSON.stringify(imports) === JSON.stringify(manifest.candidate.imports.map(row => row.path).sort()),
    'source_import_closure_mismatch');
  for (const row of manifest.candidate.imports) {
    requireValue(git('rev-parse', `${pin}:${row.path}`) === row.git_blob_sha1, 'import_blob_mismatch');
  }
  for (const capability of REQUIRED_CAPABILITIES) requireValue(source.includes(capability), 'source_capability');
  requireValue(source.includes('h205f22_a2_browser_device_consume_nonce_v3'), 'nonce_v3');
  return Object.freeze({ ...result, qualified_head: git('rev-parse', 'HEAD') });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot,
    'coordination/convergence/R83_EDGE_CANARY_V30_SOURCE_QUALIFICATION_V1.json'), 'utf8'));
  process.stdout.write(`${JSON.stringify(qualifyR83V30Source({ repoRoot, manifest }), null, 2)}\n`);
}
