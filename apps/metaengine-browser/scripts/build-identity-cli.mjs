#!/usr/bin/env node

import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const {
  createBuildIdentity,
  loadDependencyResolutionProof,
  sha256File,
} = require('./build-identity.cjs');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function required(args, key) {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`build_identity_cli_${key.replaceAll('-', '_')}_required`);
  }
  return value.trim();
}

export function createBuildIdentityFromArgs(args) {
  const dependencyPath = resolve(required(args, 'dependency-resolution'));
  const configPath = resolve(required(args, 'config'));
  const dependency = loadDependencyResolutionProof(dependencyPath);
  return createBuildIdentity({
    repository: required(args, 'repository'),
    repository_id: required(args, 'repository-id'),
    source_head: required(args, 'source-head'),
    workflow: required(args, 'workflow'),
    run_id: required(args, 'run-id'),
    run_attempt: required(args, 'run-attempt'),
    package_version: required(args, 'package-version'),
    platform: required(args, 'platform'),
    arch: required(args, 'arch'),
    builder_config_sha256: sha256File(configPath),
    dependency_resolution_sha256: dependency.dependency_resolution_sha256,
    electron_builder_version: required(args, 'electron-builder-version'),
    node_version: process.version,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outPath = resolve(required(args, 'out'));
  const identity = createBuildIdentityFromArgs(args);
  writeFileSync(outPath, `${JSON.stringify(identity, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(identity)}\n`);
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      schema: 'metaengine.browser.build-identity-error.v1',
      code: String(error?.message || error).split(':')[0],
      message: String(error?.message || error).slice(0, 1000),
    })}\n`);
    process.exitCode = 1;
  });
}
