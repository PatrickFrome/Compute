'use strict';

const fs = require('node:fs');

const SCHEMA = 'metaengine.browser.release-publisher-preflight.v1';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '');
    if (!token.startsWith('--')) throw new Error('release_preflight_argument_invalid');
    const key = token.slice(2).replace(/-/g, '_');
    const value = argv[i + 1];
    if (value == null || String(value).startsWith('--')) throw new Error('release_preflight_argument_value_missing');
    out[key] = String(value);
    i += 1;
  }
  return out;
}

function readJson(path) {
  const value = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (!Array.isArray(value)) throw new Error('release_preflight_manifest_not_array');
  return value;
}

function manifest(rows) {
  const out = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('release_preflight_manifest_row_invalid');
    const path = String(row.path || '').trim();
    const sha = String(row.sha || '').trim().toLowerCase();
    const type = String(row.type || '').trim().toLowerCase();
    if (!path.startsWith('.github/workflows/') || !/^[0-9a-f]{40}$/.test(sha) || !type) {
      throw new Error('release_preflight_manifest_row_incomplete');
    }
    out.set(path, Object.freeze({ sha, type }));
  }
  return out;
}

function compareWorkflowManifests({ defaultRows, targetRows, defaultBranch, targetSha }) {
  const base = manifest(defaultRows);
  const target = manifest(targetRows);
  const changed = [...new Set([...base.keys(), ...target.keys()])]
    .filter((key) => JSON.stringify(base.get(key) || null) !== JSON.stringify(target.get(key) || null))
    .sort();
  const blocked = changed.length > 0;
  return Object.freeze({
    schema: SCHEMA,
    state: blocked ? 'BLOCKED_WORKFLOWS_WRITE_REQUIRED' : 'GITHUB_TOKEN_ELIGIBLE',
    default_branch: String(defaultBranch || ''),
    target_sha: String(targetSha || '').toLowerCase(),
    workflow_drift_count: changed.length,
    workflow_drift_sample: Object.freeze(changed.slice(0, 32)),
    github_token_supported: !blocked,
    external_workflows_write_actor_required: blocked,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.default_manifest || !args.target_manifest || !args.default_branch || !args.target_sha) {
    throw new Error('release_preflight_required_argument_missing');
  }
  if (!/^[0-9a-f]{40}$/i.test(args.target_sha)) throw new Error('release_preflight_target_sha_invalid');
  const receipt = compareWorkflowManifests({
    defaultRows: readJson(args.default_manifest),
    targetRows: readJson(args.target_manifest),
    defaultBranch: args.default_branch,
    targetSha: args.target_sha,
  });
  process.stdout.write(JSON.stringify(receipt) + '\n');
  if (receipt.state === 'BLOCKED_WORKFLOWS_WRITE_REQUIRED') process.exitCode = 42;
  return receipt;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(String(error?.stack || error) + '\n');
    process.exitCode = 2;
  }
}

module.exports = Object.freeze({
  SCHEMA,
  compareWorkflowManifests,
  main,
});
