#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const {
  DEPENDENCY_RESOLUTION_SCHEMA,
  canonicalize,
  canonicalJson,
  sha256String,
} = require('./build-identity.cjs');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function normalizeNode(node, name = null) {
  const dependencies = {};
  for (const depName of Object.keys(node?.dependencies || {}).sort()) {
    dependencies[depName] = normalizeNode(node.dependencies[depName], depName);
  }
  return {
    name: String(name || node?.name || ''),
    version: String(node?.version || ''),
    dependencies,
  };
}

function countDependencies(tree) {
  let count = 0;
  for (const child of Object.values(tree.dependencies || {})) {
    count += 1 + countDependencies(child);
  }
  return count;
}

export function npmInvocation(args, {
  platform = process.platform,
  env = process.env,
} = {}) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
    throw new Error('dependency_resolution_npm_args_invalid');
  }
  if (platform === 'win32') {
    const comspec = String(
      env.ComSpec
      || env.COMSPEC
      || (env.SystemRoot ? `${env.SystemRoot}\\System32\\cmd.exe` : 'cmd.exe'),
    ).trim();
    if (!comspec) throw new Error('dependency_resolution_comspec_unavailable');
    return Object.freeze({
      command: comspec,
      args: Object.freeze(['/d', '/s', '/c', 'npm.cmd', ...args]),
    });
  }
  return Object.freeze({
    command: 'npm',
    args: Object.freeze([...args]),
  });
}

function runNpm(args, {
  cwd = undefined,
  platform = process.platform,
  env = process.env,
  maxBuffer = 4 * 1024 * 1024,
} = {}) {
  const invocation = npmInvocation(args, { platform, env });
  const result = spawnSync(invocation.command, invocation.args, {
    cwd,
    env,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer,
  });
  if (result.error) {
    throw new Error(
      `dependency_resolution_npm_spawn_failed:${String(result.error.code || 'UNKNOWN')}:${String(result.error.message || result.error).slice(0, 1000)}`,
    );
  }
  return result;
}

function npmVersion() {
  const result = runNpm(['--version']);
  if (result.status !== 0) {
    const message = String(result.stderr || result.stdout || '').slice(0, 1000);
    throw new Error(`dependency_resolution_npm_version_unavailable:${result.status}:${message}`);
  }
  const version = String(result.stdout || '').trim();
  if (!version) throw new Error('dependency_resolution_npm_version_unavailable');
  return version;
}

function readInstalledTree(cwd) {
  const result = runNpm(['ls', '--all', '--json'], {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const message = String(result.stderr || result.stdout || '').slice(0, 2000);
    throw new Error(`dependency_resolution_npm_ls_failed:${result.status}:${message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error('dependency_resolution_npm_ls_json_invalid');
  }
  return parsed;
}

export function createDependencyResolutionProof({ cwd = process.cwd() } = {}) {
  const installed = readInstalledTree(cwd);
  const tree = canonicalize(normalizeNode(installed));
  const payload = {
    schema: DEPENDENCY_RESOLUTION_SCHEMA,
    root_name: String(installed.name || tree.name || ''),
    root_version: String(installed.version || tree.version || ''),
    node_version: process.version,
    npm_version: npmVersion(),
    dependency_count: countDependencies(tree),
    tree,
  };
  if (!payload.root_name || !payload.root_version) {
    throw new Error('dependency_resolution_root_invalid');
  }
  return Object.freeze({
    ...payload,
    dependency_resolution_sha256: sha256String(canonicalJson(payload)),
    authority_effect: false,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = resolve(String(args.cwd || process.cwd()));
  const proof = createDependencyResolutionProof({ cwd });
  const json = JSON.stringify(proof, null, 2) + '\n';
  if (args.out && args.out !== true) writeFileSync(resolve(String(args.out)), json, 'utf8');
  process.stdout.write(JSON.stringify(proof) + '\n');
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(JSON.stringify({
      schema: 'metaengine.browser.dependency-resolution-error.v1',
      code: String(error?.message || error).split(':')[0],
      message: String(error?.message || error).slice(0, 2000),
    }) + '\n');
    process.exitCode = 1;
  });
}
