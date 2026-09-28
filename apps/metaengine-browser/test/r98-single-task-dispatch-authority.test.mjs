import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BROWSER = path.resolve(HERE, '..');

test('R98 has one production z.ai task dispatch authority', () => {
  const duplicateDispatcher = path.join(BROWSER, 'src', 'fleet-task-dispatcher.mjs');
  assert.equal(
    fs.existsSync(duplicateDispatcher),
    false,
    'legacy standalone fleet task dispatcher must not reappear beside DevOsNativeTaskCycle',
  );

  const wrapper = fs.readFileSync(path.join(BROWSER, 'src', 'devos-native-task-cycle.mjs'), 'utf8');
  const core = fs.readFileSync(path.join(BROWSER, 'src', 'devos-native-task-cycle-core.mjs'), 'utf8');
  const pkg = fs.readFileSync(path.join(BROWSER, 'package.json'), 'utf8');

  assert.match(wrapper, /\/v1\/devos\/promotion-lease/);
  assert.match(wrapper, /LOCAL_ACTIVE_AGENT_SESSION/);
  assert.match(core, /#assertCanonicalAgentConversation/);
  assert.match(core, /devos_agent_origin_proof_invalid/);
  assert.equal(pkg.includes('fleet-task-dispatcher.mjs'), false);
});
