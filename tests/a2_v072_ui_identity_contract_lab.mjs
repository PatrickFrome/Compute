import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('coordination/chat-control-plane/extension');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const ids = (html) => [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1]);

const manifest = JSON.parse(read('manifest.json'));
const pkg = JSON.parse(read('runtime-package-manifest.json'));
const runtime = read('runtime-marker.js');
const bootstrap = read('bootstrap-config.js');
const sidepanel = read('sidepanel.html');
const options = read('options.html');

assert(manifest.manifest_version === 3, 'manifest must remain MV3');
assert(manifest.version === '0.7.2', `manifest version drift: ${manifest.version}`);
assert(manifest.minimum_chrome_version === '125', 'minimum Chrome contract drift');
assert(String(manifest.description || '').length <= 132, 'manifest description exceeds 132 characters');
assert(pkg.package_version === '0.7.2' && pkg.operator_runtime === '0.7.2', 'runtime package identity drift');
assert(pkg.credential_architecture === 'DURABLE_DEVICE_BOUND_V1', 'durable credential architecture marker missing');
assert(pkg.policy?.privileged_master_secret_in_bundle_allowed === false, 'master-secret bundle policy must fail closed');
assert(pkg.policy?.personalized_scoped_seed_allowed === true, 'scoped personalized seed policy missing');
assert(Array.isArray(pkg.files) && pkg.files.length === 47, `canonical package closure must remain 47 files; got ${pkg.files?.length}`);
assert(new Set(pkg.files).size === pkg.files.length, 'canonical package file list has duplicates');
assert(runtime.includes('const RUNTIME = "0.7.2"'), 'runtime marker version drift');
assert(runtime.includes('EXTENSION_DURABLE_IDENTITY_UI_V1'), 'runtime milestone missing');
assert(runtime.includes('DURABLE_DEVICE_BOUND_V1'), 'runtime credential architecture missing');
assert(/bridgeSecret:\s*""/.test(bootstrap), 'generic bridge bootstrap must remain empty');
assert(/supervisorBootstrapSecret:\s*""/.test(bootstrap), 'generic supervisor bootstrap must remain empty');
assert(bootstrap.includes('provisioningMode: "DURABLE_DEVICE_BOUND_V1"'), 'bootstrap provisioning mode missing');
assert(!bootstrap.includes('SUPABASE_SERVICE_ROLE_KEY='), 'service-role credential assignment forbidden in extension bootstrap');

const sideIds = ids(sidepanel);
const optionIds = ids(options);
assert(new Set(sideIds).size === sideIds.length, 'sidepanel contains duplicate element ids');
assert(new Set(optionIds).size === optionIds.length, 'options page contains duplicate element ids');

const requiredSidepanelIds = [
  'runtime','armedBadge','bridgeDot','bridgePulse','supervisorDot','supervisorPulse','gatePulse',
  'toggleArmed','pollNow','openOptions','modeObserve','modeGate','ordering','predecessor','pendingCommand',
  'glmState','gptState','supervisorBadge','supervisorOff','supervisorMonitor','supervisorControl','supervisorLink',
  'supervisorCommand','supervisorReceipt','supervisorPoll','clearTimeline','supervisorTimeline','intentCard','intentMeta',
  'draftOriginal','draftRewrite','cancelIntent','allowOriginal','rewriteAllow','captureGlm','captureGpt','clearPerception',
  'perceptionTarget','perceptionCaptured','perceptionFrame','perceptionTextMeta','perceptionStructure','perceptionHashes',
  'perceptionScreenshot','perceptionBody','perceptionStructureDump','semanticTarget','semanticText','semanticFocus',
  'semanticClick','semanticType','semanticState','actionTarget','stopGeneration','scrollUp','scrollDown','lastAction',
  'daemon','updateState','compatState','capabilityState','debuggerState','sensorError','lastError','status'
];
for (const id of requiredSidepanelIds) assert(sideIds.includes(id), `sidepanel compatibility id missing: ${id}`);

const requiredOptionIds = [
  'pairingState','daemonUrl','bridgeSecret','chatgptUrl','detectChatgpt','zaiUrl','restoreZai',
  'pollMs','autoOpenTabs','armed','status','pollNow','save'
];
for (const id of requiredOptionIds) assert(optionIds.includes(id), `options compatibility id missing: ${id}`);

assert(sidepanel.includes('Command center'), 'new command-center information architecture missing');
assert(sidepanel.includes('Strict GLM-first'), 'causal lane missing');
assert(sidepanel.includes('Runtime health'), 'runtime health surface missing');
assert(options.includes('Connection & identity'), 'identity-oriented setup surface missing');
assert(options.includes('Credential maintenance'), 'credential rotation surface missing');

for (const rel of pkg.files) {
  const file = path.join(root, rel);
  assert(fs.existsSync(file) || rel === 'semantic-perception-compiler.js', `canonical source file missing: ${rel}`);
}

console.log('A2 Browser Operator v0.7.2 durable identity + UI contract: PASS', JSON.stringify({
  version: manifest.version,
  canonical_files: pkg.files.length,
  sidepanel_ids: sideIds.length,
  options_ids: optionIds.length,
  credential_architecture: pkg.credential_architecture
}));
