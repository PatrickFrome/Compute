import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AGENT_ACCESS_CAPSULE_SCHEMA,
  defaultAgentAccessCapsule,
  ensureAgentAccessCapsuleFile,
  loadAgentAccessCapsule,
  normalizeAgentAccessCapsule,
  renderAgentAccessCapsuleBlock,
} from '../src/agent-access-capsule.mjs';
import { renderDevosTaskPrompt } from '../src/devos-native-task-cycle-core.mjs';

const LEASE = {
  task_id: '11111111-2222-4333-8444-555555555555',
  agent_id: 'agent_aaaabbbb-cccc-4ddd-8eee-ffffffffffff',
  tab_id: 'tab_12345678-1234-4567-8899-aabbccddeeff',
  target_id: 'webcontents:5',
  base_sha: 'a'.repeat(40),
  role: 'IMPLEMENTER',
  lease_generation: 1,
  agent_generation_epoch: 1,
  task_spec: { objective: 'Do the thing', constraints: [], deliverable: 'The thing, done.' },
};

function lease() { return structuredClone(LEASE); }

test('normalize drops junk, clips fields and freezes the capsule', () => {
  const capsule = normalizeAgentAccessCapsule({
    infrastructure: [{ name: 'edge', location: 'remote', url: 'https://x'.repeat(80), note: 'n' }, null, 'junk'],
    databases: [{ name: 'fleet', scope: 'destruktion_meta', tables: ['t1', 42, ''], note: 'queue' }],
    credentials_policy: '  device   signatures   only  ',
    context_sources: [{ name: 'worklog', pointer: 'a2-capsule/00' }],
    rules: ['zero authority', '   ', 7],
    unexpected_top_level: 'dropped',
  });
  assert.equal(capsule.schema, AGENT_ACCESS_CAPSULE_SCHEMA);
  assert.equal(capsule.infrastructure.length, 1);
  assert.ok(capsule.infrastructure[0].url.length <= 240);
  assert.deepEqual(capsule.databases[0].tables, ['t1']);
  assert.equal(capsule.credentials_policy, 'device signatures only');
  assert.deepEqual(capsule.rules, ['zero authority']);
  assert.equal(Object.isFrozen(capsule), true);
  assert.equal(normalizeAgentAccessCapsule(null), null);
  assert.equal(normalizeAgentAccessCapsule({}), null); // nothing usable
  assert.equal(normalizeAgentAccessCapsule('nope'), null);
});

test('default capsule maps the fabric without any raw secrets', () => {
  const capsule = defaultAgentAccessCapsule();
  assert.ok(capsule);
  assert.equal(capsule.infrastructure[0].url, '');
  assert.match(capsule.infrastructure[0].name, /OWNER_UNKNOWN/);
  assert.ok(!capsule.infrastructure.some(r => /supabase\.co|postgresql:|3031/.test(r.url)));
  assert.ok(!capsule.infrastructure.some(r => /reserve|cloud/i.test(r.name)));
  assert.ok(capsule.databases.some((r) => r.tables.includes('devos_fleet_task_h205f22')));
  const rendered = renderAgentAccessCapsuleBlock(capsule);
  assert.match(rendered, /AGENT ACCESS CAPSULE v1/);
  assert.match(rendered, /credentials: Local Owner/);
  assert.doesNotMatch(rendered, /supabase\.co|postgresql:|127\.0\.0\.1:3031/);
  assert.match(rendered, /TOOL_REQUEST_V1/);
  // zero-authority guarantee: no JWT-looking blobs, no private key material
  assert.ok(!/[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(rendered), 'no JWT literals');
  assert.ok(!/BEGIN (EC|RSA|OPENSSH) PRIVATE KEY/.test(rendered));
});

test('render is deterministic and bounded (prompt-hash stability)', () => {
  const a = renderAgentAccessCapsuleBlock(defaultAgentAccessCapsule());
  const b = renderAgentAccessCapsuleBlock(defaultAgentAccessCapsule());
  assert.equal(a, b);
  assert.ok(a.length > 0 && a.length <= 2000);
  assert.equal(renderAgentAccessCapsuleBlock(null), '');
  assert.equal(renderAgentAccessCapsuleBlock('junk'), '');
});

test('unattested local environment cannot turn the capsule into a live supervisor URL', () => {
  const base = 'http://127.0.0.1:15433/a2-browser-native-supervisor-v1';
  const env = { METAENGINE_STATE_PROVIDER: 'LOCAL_POSTGRES',
    METAENGINE_LOCAL_STATE_INSTANCE_ID: '11111111-2222-4333-8444-555555555555',
    METAENGINE_SUPERVISOR_BASE_URL: base, SUPABASE_SERVICE_ROLE_KEY: 'private-test-key' };
  const capsule = defaultAgentAccessCapsule({ env, activeBase: base });
  assert.equal(capsule.infrastructure[0].url, '');
  assert.match(capsule.infrastructure[0].name, /OWNER_UNKNOWN/);
  assert.equal(capsule.infrastructure.some(row => /reserve|cloud/i.test(row.name)), false);
  assert.match(capsule.databases[0].scope, /own PostgreSQL via attested local Owner/);
  assert.equal(capsule.context_sources.some(row => /infra\/pigsty/.test(row.pointer)), false);
  const rendered = renderAgentAccessCapsuleBlock(capsule);
  assert.doesNotMatch(rendered, /supabase\\.co|private-test-key|postgresql:\/\//);
  assert.match(rendered, /no Supervisor endpoint or command authority/);
});

test('historical operator capsule is neither read nor rewritten, including an untrusted local claim', () => {
  const unexpected = () => { throw new Error('historical capsule must remain untouched'); };
  const capsule = loadAgentAccessCapsule({ storage_dir:'/unused', read_file:unexpected, exists:unexpected });
  assert.equal(capsule.infrastructure[0].url, '');
  assert.equal(ensureAgentAccessCapsuleFile('/unused',
    { exists:unexpected, mkdir:unexpected, write_file:unexpected }), null);
});

test('hosted endpoint parameter cannot become a default local Supervisor authority', () => {
  for (const base of ['https://selected.example/functions/v1/a2-browser-native-supervisor-v1',
    'http://127.0.0.1:3031/a2-browser-native-supervisor-v1']) {
    const capsule = defaultAgentAccessCapsule({ env:{}, activeBase:base });
    assert.equal(capsule.infrastructure[0].url, '');
    assert.doesNotMatch(renderAgentAccessCapsuleBlock(capsule), /selected\\.example|127\\.0\\.0\\.1:3031/);
  }
});

test('historical operator override files cannot smuggle cloud endpoints into prompts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2-capsule-'));
  try {
    const file = path.join(dir, 'agent-access-capsule.json');
    fs.writeFileSync(file, JSON.stringify({
      infrastructure:[{name:'operator cloud',location:'remote',url:'https://hosted.invalid/command'}],
    }));
    const loaded = loadAgentAccessCapsule({storage_dir:dir});
    assert.equal(loaded.infrastructure[0].url, '');
    assert.doesNotMatch(renderAgentAccessCapsuleBlock(loaded), /hosted\\.invalid/);
    assert.equal(ensureAgentAccessCapsuleFile(dir), null);
    assert.match(fs.readFileSync(file,'utf8'), /hosted\\.invalid/);
    fs.writeFileSync(file, '{not json');
    assert.equal(loadAgentAccessCapsule({storage_dir:dir}).infrastructure[0].url,'');
    assert.equal(fs.readFileSync(file,'utf8'), '{not json');
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('no local Owner never causes new capsule file to be created', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'a2-capsule-ensure-'));
  try {
    assert.equal(ensureAgentAccessCapsuleFile(dir), null);
    assert.equal(fs.existsSync(path.join(dir, 'agent-access-capsule.json')), false);
    assert.equal(ensureAgentAccessCapsuleFile(null), null);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('task prompt carries the capsule between team memory and briefing; absent capsule keeps prompts byte-identical', () => {
  const base = renderDevosTaskPrompt(lease(), {
    context_briefing: 'AGENT CONTEXT brief',
    team_memory: 'TEAM MEMORY block',
  });
  const withCapsule = renderDevosTaskPrompt(lease(), {
    context_briefing: 'AGENT CONTEXT brief',
    team_memory: 'TEAM MEMORY block',
    access_capsule: renderAgentAccessCapsuleBlock(defaultAgentAccessCapsule()),
  });
  assert.ok(!base.includes('AGENT ACCESS CAPSULE v1'));
  assert.ok(withCapsule.includes('TEAM MEMORY block\n\nAGENT ACCESS CAPSULE v1'));
  assert.ok(withCapsule.indexOf('AGENT ACCESS CAPSULE v1') < withCapsule.indexOf('AGENT CONTEXT brief'));
  assert.ok(withCapsule.startsWith(base.split('\n\nAGENT CONTEXT')[0]));
  const none = renderDevosTaskPrompt(lease(), {
    context_briefing: 'AGENT CONTEXT brief',
    team_memory: 'TEAM MEMORY block',
    access_capsule: null,
  });
  assert.equal(none, base); // regression guard: pre-capsule prompts unchanged
});
