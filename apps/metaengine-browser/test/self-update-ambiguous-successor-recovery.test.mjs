import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  recoverAmbiguousInstalledSuccessor,
  recoverQuarantinedInstalledSuccessor,
} from '../src/self-update-ambiguous-successor-recovery.mjs';
import { inspectSelfUpdateStartup } from '../src/self-update-handoff.mjs';
import {
  beginSelfUpdateTransaction,
  readSelfUpdateTransaction,
  transitionSelfUpdateTransaction,
} from '../src/self-update-transaction-journal.mjs';

const OLD = '0.7.0-dev.2.1';
const TARGET = '0.7.0-dev.3.1';
const NEWER = '0.7.0-dev.4.1';
const INSTALLED_SHA = 'a'.repeat(64);
const INSTALLER_SHA = 'b'.repeat(64);
const MANIFEST_SHA = 'c'.repeat(64);
const GIT_SHA = 'd'.repeat(40);

function receipt(version = TARGET) {
  return {
    version,
    available_version: version,
    resolved_git_sha: GIT_SHA,
    metadata_verified: true,
    restart_gate_safe: true,
    authority_effect: false,
  };
}

function trustedRelease(version, overrides = {}) {
  return {
    schema: 'metaengine.trusted-dev-release.v1',
    version,
    tag: `v${version}`,
    git_sha: GIT_SHA,
    installer_sha256: INSTALLER_SHA,
    manifest_sha256: MANIFEST_SHA,
    installed_executable_sha256: INSTALLED_SHA,
    target_present_proof_supported: true,
    authority_effect: false,
    ...overrides,
  };
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-ambiguous-successor-'));
  let currentVersion = OLD;
  const app = {
    getPath(name) {
      if (name !== 'userData') throw new Error(`unexpected_path:${name}`);
      return root;
    },
    getVersion() { return currentVersion; },
  };
  await beginSelfUpdateTransaction(app, receipt());
  await transitionSelfUpdateTransaction(app, 'AMBIGUOUS_INSTALL', {
    evidence: { reason: 'installer_outcome_unknown' },
  });
  return {
    root,
    app,
    setVersion(value) { currentVersion = value; },
  };
}

async function cleanup(root) { await fs.rm(root, { recursive: true, force: true }); }

test('exact trusted manual successor supersedes ambiguity with zero installer effect', async () => {
  const f = await fixture();
  let resolverCalls = 0;
  let hashCalls = 0;
  try {
    f.setVersion(TARGET);
    const out = await recoverAmbiguousInstalledSuccessor({
      app: f.app,
      executablePath: 'C:\\Program Files\\METAENGINE Browser\\METAENGINE Browser.exe',
      resolveTrustedInstalledRelease: async ({ currentVersion, targetVersion, relationship }) => {
        resolverCalls += 1;
        assert.equal(currentVersion, TARGET);
        assert.equal(targetVersion, TARGET);
        assert.equal(relationship, 'EXACT');
        return trustedRelease(TARGET);
      },
      hashExecutable: async () => { hashCalls += 1; return INSTALLED_SHA; },
    });
    assert.equal(out.state, 'SUPERSEDED');
    assert.equal(out.relationship, 'EXACT');
    assert.equal(out.physical_installer_launch_count, 0);
    assert.equal(resolverCalls, 1);
    assert.equal(hashCalls, 1);
    const journal = await readSelfUpdateTransaction(f.app);
    assert.equal(journal.state, 'SUPERSEDED');
    assert.equal(journal.evidence.recovery_without_installer_effect, true);
    assert.equal(journal.evidence.installed_executable_sha256, INSTALLED_SHA);
  } finally { await cleanup(f.root); }
});

test('newer trusted manual successor also supersedes old ambiguous target without installer replay', async () => {
  const f = await fixture();
  let resolverCalls = 0;
  try {
    f.setVersion(NEWER);
    const out = await recoverAmbiguousInstalledSuccessor({
      app: f.app,
      resolveTrustedInstalledRelease: async ({ currentVersion, relationship }) => {
        resolverCalls += 1;
        assert.equal(currentVersion, NEWER);
        assert.equal(relationship, 'NEWER');
        return trustedRelease(NEWER);
      },
      hashExecutable: async () => INSTALLED_SHA,
    });
    assert.equal(out.state, 'SUPERSEDED');
    assert.equal(out.relationship, 'NEWER');
    assert.equal(out.current_version, NEWER);
    assert.equal(out.target_version, TARGET);
    assert.equal(out.physical_installer_launch_count, 0);
    assert.equal(resolverCalls, 1);
    assert.equal((await readSelfUpdateTransaction(f.app)).state, 'SUPERSEDED');
  } finally { await cleanup(f.root); }
});

test('older installed binary remains held and never asks release resolver to bless it', async () => {
  const f = await fixture();
  let resolverCalls = 0;
  let hashCalls = 0;
  try {
    f.setVersion(OLD);
    const out = await recoverAmbiguousInstalledSuccessor({
      app: f.app,
      resolveTrustedInstalledRelease: async () => { resolverCalls += 1; return trustedRelease(OLD); },
      hashExecutable: async () => { hashCalls += 1; return INSTALLED_SHA; },
    });
    assert.equal(out.state, 'HELD');
    assert.equal(out.reason, 'INSTALLED_VERSION_OLDER_THAN_TARGET');
    assert.equal(out.physical_installer_launch_count, 0);
    assert.equal(resolverCalls, 0);
    assert.equal(hashCalls, 0);
    assert.equal((await readSelfUpdateTransaction(f.app)).state, 'AMBIGUOUS_INSTALL');
  } finally { await cleanup(f.root); }
});

test('matching version alone cannot clear ambiguity when installed executable digest differs', async () => {
  const f = await fixture();
  try {
    f.setVersion(TARGET);
    const out = await recoverAmbiguousInstalledSuccessor({
      app: f.app,
      resolveTrustedInstalledRelease: async () => trustedRelease(TARGET),
      hashExecutable: async () => 'f'.repeat(64),
    });
    assert.equal(out.state, 'HELD');
    assert.equal(out.reason, 'INSTALLED_EXECUTABLE_DIGEST_MISMATCH');
    assert.equal(out.physical_installer_launch_count, 0);
    assert.equal((await readSelfUpdateTransaction(f.app)).state, 'AMBIGUOUS_INSTALL');
  } finally { await cleanup(f.root); }
});

test('release without manifest-bound installed executable proof cannot clear ambiguity', async () => {
  const f = await fixture();
  let hashCalls = 0;
  try {
    f.setVersion(TARGET);
    const out = await recoverAmbiguousInstalledSuccessor({
      app: f.app,
      resolveTrustedInstalledRelease: async () => trustedRelease(TARGET, {
        installed_executable_sha256: null,
        target_present_proof_supported: false,
      }),
      hashExecutable: async () => { hashCalls += 1; return INSTALLED_SHA; },
    });
    assert.equal(out.state, 'HELD');
    assert.equal(out.reason, 'TRUSTED_INSTALLED_RELEASE_REQUIRED');
    assert.equal(hashCalls, 0);
    assert.equal((await readSelfUpdateTransaction(f.app)).state, 'AMBIGUOUS_INSTALL');
  } finally { await cleanup(f.root); }
});

test('repeated boot after supersession is terminal and cannot repeat recovery effect', async () => {
  const f = await fixture();
  let resolverCalls = 0;
  try {
    f.setVersion(TARGET);
    const args = {
      app: f.app,
      resolveTrustedInstalledRelease: async () => { resolverCalls += 1; return trustedRelease(TARGET); },
      hashExecutable: async () => INSTALLED_SHA,
    };
    const first = await recoverAmbiguousInstalledSuccessor(args);
    assert.equal(first.state, 'SUPERSEDED');
    const second = await recoverAmbiguousInstalledSuccessor(args);
    assert.equal(second.state, 'HELD');
    assert.equal(second.reason, 'NO_AMBIGUOUS_INSTALL');
    assert.equal(second.transaction_state, 'SUPERSEDED');
    assert.equal(second.physical_installer_launch_count, 0);
    assert.equal(resolverCalls, 1);
  } finally { await cleanup(f.root); }
});


async function quarantinedFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-quarantined-successor-'));
  let currentVersion = TARGET;
  const app = {
    getPath(name) {
      if (name !== 'userData') throw new Error(`unexpected_path:${name}`);
      return root;
    },
    getVersion() { return currentVersion; },
  };
  await beginSelfUpdateTransaction(app, receipt());
  await transitionSelfUpdateTransaction(app, 'INSTALLING');
  await transitionSelfUpdateTransaction(app, 'SUCCESSOR_BOOTED');
  await transitionSelfUpdateTransaction(app, 'QUARANTINED', {
    evidence: { quarantine_reason: 'session_continuity_auth_required' },
  });
  return {
    root,
    app,
    setVersion(value) { currentVersion = value; },
  };
}

test('same-version process can never erase its own quarantine', async () => {
  const f = await quarantinedFixture();
  let resolverCalls = 0;
  let hashCalls = 0;
  try {
    const out = await recoverQuarantinedInstalledSuccessor({
      app: f.app,
      resolveTrustedInstalledRelease: async () => { resolverCalls += 1; return trustedRelease(TARGET); },
      hashExecutable: async () => { hashCalls += 1; return INSTALLED_SHA; },
    });
    assert.equal(out.state, 'HELD');
    assert.equal(out.reason, 'QUARANTINED_REQUIRES_STRICTLY_NEWER_SUCCESSOR');
    assert.equal(resolverCalls, 0);
    assert.equal(hashCalls, 0);
    assert.equal((await readSelfUpdateTransaction(f.app)).state, 'QUARANTINED');
  } finally { await cleanup(f.root); }
});

test('strictly newer trusted installed successor supersedes old quarantine without installer replay', async () => {
  const f = await quarantinedFixture();
  try {
    f.setVersion(NEWER);
    const out = await recoverQuarantinedInstalledSuccessor({
      app: f.app,
      resolveTrustedInstalledRelease: async ({ currentVersion, targetVersion, relationship }) => {
        assert.equal(currentVersion, NEWER);
        assert.equal(targetVersion, TARGET);
        assert.equal(relationship, 'NEWER');
        return trustedRelease(NEWER);
      },
      hashExecutable: async () => INSTALLED_SHA,
    });
    assert.equal(out.state, 'SUPERSEDED');
    assert.equal(out.relationship, 'NEWER');
    assert.equal(out.prior_transaction_state, 'QUARANTINED');
    assert.equal(out.prior_quarantine_reason, 'session_continuity_auth_required');
    assert.equal(out.physical_installer_launch_count, 0);
    const journal = await readSelfUpdateTransaction(f.app);
    assert.equal(journal.state, 'SUPERSEDED');
    assert.equal(journal.evidence.prior_transaction_state, 'QUARANTINED');
    assert.equal(journal.evidence.prior_quarantine_reason, 'session_continuity_auth_required');
    assert.equal(journal.evidence.recovery_without_installer_effect, true);
  } finally { await cleanup(f.root); }
});

test('newer version string alone cannot supersede quarantine without trusted executable proof', async () => {
  const f = await quarantinedFixture();
  try {
    f.setVersion(NEWER);
    const out = await recoverQuarantinedInstalledSuccessor({
      app: f.app,
      resolveTrustedInstalledRelease: async () => trustedRelease(NEWER),
      hashExecutable: async () => 'f'.repeat(64),
    });
    assert.equal(out.state, 'HELD');
    assert.equal(out.reason, 'INSTALLED_EXECUTABLE_DIGEST_MISMATCH');
    assert.equal((await readSelfUpdateTransaction(f.app)).state, 'QUARANTINED');
  } finally { await cleanup(f.root); }
});

test('startup inspection heals a stale quarantine only after a newer trusted binary is physically proven', async () => {
  const f = await quarantinedFixture();
  try {
    f.setVersion(NEWER);
    const inspected = await inspectSelfUpdateStartup(f.app, {
      resolveTrustedInstalledRelease: async ({ currentVersion }) => trustedRelease(currentVersion),
      hashExecutable: async () => INSTALLED_SHA,
      executablePath: 'C:\\Program Files\\METAENGINE Browser\\METAENGINE Browser.exe',
    });
    assert.equal(inspected.state, 'SUPERSEDED');
    assert.equal(inspected.transaction_state, 'SUPERSEDED');
    assert.equal(inspected.current_version, NEWER);
    assert.equal(inspected.target_version, TARGET);
    assert.equal(inspected.successor_relationship, 'NEWER');
    assert.equal(inspected.prior_quarantine_reason, 'session_continuity_auth_required');
    assert.equal(inspected.physical_installer_launch_count, 0);
    assert.equal(inspected.automatic_retry_allowed, false);
    assert.equal(inspected.authority_effect, false);
    assert.equal((await readSelfUpdateTransaction(f.app)).state, 'SUPERSEDED');
  } finally { await cleanup(f.root); }
});
