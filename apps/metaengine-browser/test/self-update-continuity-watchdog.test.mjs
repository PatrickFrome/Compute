import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildSelfUpdateSessionContinuity,
  loadSelfUpdateSessionContinuity,
  persistSelfUpdateSessionContinuity,
} from '../src/self-update-session-continuity.mjs';
import { recoverStuckSelfUpdateContinuity } from '../src/self-update-continuity-watchdog.mjs';

function row(targetVersion = '0.6.3-dev.2.1') {
  return buildSelfUpdateSessionContinuity({
    currentVersion: '0.6.3-dev.1.1',
    targetVersion,
    tabsSnapshot: {
      selected_tab_id: 'tab_12345678',
      tabs: [{
        tab_id: 'tab_12345678',
        url: 'https://chatgpt.com/c/test',
        kind: 'CHATGPT',
        generation_state: 'GENERATING',
      }],
    },
    createdAt: '2026-08-31T00:00:00.000Z',
  });
}

test('stuck matching continuity is quarantined before one process relaunch and never replays browser actuation', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-continuity-watchdog-'));
  await persistSelfUpdateSessionContinuity(dir, row());
  let relaunches = 0;
  let exitCode = null;

  const result = await recoverStuckSelfUpdateContinuity({
    userDataPath: dir,
    currentVersion: '0.6.3-dev.2.1',
    quarantinedAt: '2026-08-31T00:01:00.000Z',
    relaunch: () => { relaunches += 1; },
    exit: (code) => { exitCode = code; },
  });

  assert.equal(result.state, 'QUARANTINED_RELAUNCH');
  assert.equal(result.recovered, true);
  assert.equal(result.blind_retry, false);
  assert.equal(result.page_authority, false);
  assert.equal(result.authority_effect, false);
  assert.equal(relaunches, 1);
  assert.equal(exitCode, 18);
  assert.equal(await loadSelfUpdateSessionContinuity(dir), null);
  const names = await fs.readdir(dir);
  assert.equal(names.filter((name) => name.includes('continuity-quarantine-')).length, 1);
  const quarantined = JSON.parse(await fs.readFile(path.join(dir, names.find((name) => name.includes('continuity-quarantine-'))), 'utf8'));
  assert.equal(quarantined.schema, 'metaengine.self-update-session-continuity.v1');
  assert.equal(quarantined.target_version, '0.6.3-dev.2.1');
  await fs.rm(dir, { recursive: true, force: true });
});

test('watchdog never quarantines or relaunches a capsule for another target version', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-continuity-watchdog-mismatch-'));
  await persistSelfUpdateSessionContinuity(dir, row('0.6.3-dev.3.1'));
  let relaunches = 0;
  let exits = 0;
  const result = await recoverStuckSelfUpdateContinuity({
    userDataPath: dir,
    currentVersion: '0.6.3-dev.2.1',
    relaunch: () => { relaunches += 1; },
    exit: () => { exits += 1; },
  });
  assert.equal(result.state, 'TARGET_VERSION_MISMATCH');
  assert.equal(result.recovered, false);
  assert.equal(relaunches, 0);
  assert.equal(exits, 0);
  assert.equal((await loadSelfUpdateSessionContinuity(dir))?.target_version, '0.6.3-dev.3.1');
  await fs.rm(dir, { recursive: true, force: true });
});

test('watchdog is a no-op once normal continuity restoration has already cleared the capsule', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-continuity-watchdog-clear-'));
  let relaunches = 0;
  const result = await recoverStuckSelfUpdateContinuity({
    userDataPath: dir,
    currentVersion: '0.6.3-dev.2.1',
    relaunch: () => { relaunches += 1; },
    exit: () => { throw new Error('exit must not run'); },
  });
  assert.equal(result.state, 'CLEARED');
  assert.equal(result.recovered, false);
  assert.equal(relaunches, 0);
  await fs.rm(dir, { recursive: true, force: true });
});
