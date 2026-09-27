#!/usr/bin/env node
// installer-provenance.mjs — build-once installer provenance contract (R85).
//
// Schema: metaengine.installer.provenance.v1
//
// Purpose: downstream gates must test the same installer bytes instead of
// independently rebuilding NSIS. This tool stamps an installer with a
// verifiable provenance record (sha256 + size + source head + run identity)
// and lets any consumer prove byte identity before use.
//
// Usage:
//   node installer-provenance.mjs write --installer <path> --out <path>
//        [--source-head <sha>] [--builder-pin <id>] [--run-id <id>]
//        [--run-attempt <n>] [--workflow <name>]
//   node installer-provenance.mjs verify --installer <path> --provenance <path>
//        [--expect-sha256 <hex>]
//
// Exit codes:
//   0  ok
//   2  usage error (unknown flag, missing value, unknown mode)
//   3  installer or provenance file missing/unreadable
//   4  digest or size mismatch (installer bytes do not match provenance)
//   5  provenance record invalid (unparseable or wrong schema)
//
// Zero dependencies: node:crypto + node:fs + node:path only.

import { createReadStream, constants as fsConstants } from 'node:fs';
import { createHash } from 'node:crypto';
import { access, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SCHEMA = 'metaengine.installer.provenance.v1';
const SHA256_RE = /^[a-f0-9]{64}$/;

function fail(exitCode, code, message) {
  console.error(JSON.stringify({ ok: false, code, message }));
  process.exit(exitCode);
}

const WRITE_FLAGS = new Set([
  'installer', 'out', 'source-head', 'builder-pin', 'run-id', 'run-attempt', 'workflow',
]);
const VERIFY_FLAGS = new Set(['installer', 'provenance', 'expect-sha256']);

function parseArgs(argv, allowed) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      fail(2, 'usage_unexpected_token', `unexpected token: ${arg}`);
    }
    const key = arg.slice(2);
    if (!allowed.has(key)) {
      fail(2, 'usage_unknown_flag', `unknown flag: --${key}`);
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      fail(2, 'usage_missing_value', `flag --${key} requires a value`);
    }
    out[key] = value;
    i += 1;
  }
  return out;
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(file);
    const onError = (error) => {
      stream.destroy();
      reject(error);
    };
    stream.on('error', onError);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function ensureReadable(file, label) {
  try {
    await access(file, fsConstants.R_OK);
  } catch {
    fail(3, 'file_missing', `${label} is not readable: ${file}`);
  }
}

async function cmdWrite(argv) {
  const args = parseArgs(argv, WRITE_FLAGS);
  if (!args.installer || !args.out) {
    fail(2, 'usage_write_requires_installer_and_out', 'write needs --installer <path> --out <path>');
  }
  await ensureReadable(args.installer, 'installer');
  const [digest, stats] = await Promise.all([sha256File(args.installer), stat(args.installer)]);
  const record = {
    schema: SCHEMA,
    installer_name: path.basename(args.installer),
    installer_sha256: digest,
    installer_bytes: stats.size,
    source_head: args['source-head'] || null,
    builder_pin: args['builder-pin'] || null,
    run_id: args['run-id'] || null,
    run_attempt: args['run-attempt'] || null,
    workflow: args.workflow || null,
    created_at: new Date().toISOString(),
  };
  await writeFile(args.out, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    ok: true,
    mode: 'write',
    installer_name: record.installer_name,
    installer_sha256: digest,
    installer_bytes: stats.size,
    out: path.basename(args.out),
  }));
}

async function cmdVerify(argv) {
  const args = parseArgs(argv, VERIFY_FLAGS);
  if (!args.installer || !args.provenance) {
    fail(2, 'usage_verify_requires_installer_and_provenance', 'verify needs --installer <path> --provenance <path>');
  }
  await ensureReadable(args.installer, 'installer');
  let record;
  try {
    record = JSON.parse(await readFile(args.provenance, 'utf8'));
  } catch {
    fail(5, 'provenance_unparseable', `provenance is not valid JSON: ${args.provenance}`);
  }
  if (!record || record.schema !== SCHEMA) {
    fail(5, 'provenance_schema_invalid', `expected schema ${SCHEMA}`);
  }
  if (typeof record.installer_sha256 !== 'string' || !SHA256_RE.test(record.installer_sha256)) {
    fail(5, 'provenance_digest_field_invalid', 'installer_sha256 must be lowercase 64-hex');
  }
  const [digest, stats] = await Promise.all([sha256File(args.installer), stat(args.installer)]);
  if (digest !== record.installer_sha256) {
    fail(4, 'provenance_sha_mismatch', `installer ${digest} != provenance ${record.installer_sha256}`);
  }
  if (Number.isFinite(record.installer_bytes) && stats.size !== record.installer_bytes) {
    fail(4, 'provenance_bytes_mismatch', `installer ${stats.size} bytes != provenance ${record.installer_bytes}`);
  }
  if (args['expect-sha256'] !== undefined) {
    const expected = String(args['expect-sha256']).toLowerCase();
    if (!SHA256_RE.test(expected)) {
      fail(2, 'usage_expect_sha256_invalid', '--expect-sha256 must be lowercase 64-hex');
    }
    if (digest !== expected) {
      fail(4, 'expected_sha_mismatch', `installer ${digest} != expected ${expected}`);
    }
  }
  console.log(JSON.stringify({
    ok: true,
    mode: 'verify',
    installer_name: record.installer_name,
    installer_sha256: digest,
    installer_bytes: stats.size,
  }));
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === 'write') {
  await cmdWrite(rest);
} else if (mode === 'verify') {
  await cmdVerify(rest);
} else {
  fail(2, 'usage_mode', 'usage: installer-provenance.mjs <write|verify> [flags]');
}
