#!/usr/bin/env node

import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const {
  MATERIAL_SCHEMA,
  createPackageLockMaterial,
  validatePackageLockMaterial,
  loadPackageLockMaterialProof,
} = require('./package-lock-material.cjs');

function fail(code) {
  throw new Error(code);
}

export function npmVersionInvocation({
  platform = process.platform,
  env = process.env,
} = {}) {
  if (platform === 'win32') {
    const comspec = String(
      env.ComSpec
      || env.COMSPEC
      || (env.SystemRoot ? `${env.SystemRoot}\\System32\\cmd.exe` : 'cmd.exe'),
    ).trim();
    if (!comspec) fail('package_lock_comspec_unavailable');
    return Object.freeze({
      command: comspec,
      args: Object.freeze(['/d', '/s', '/c', 'npm.cmd', '--version']),
    });
  }
  return Object.freeze({
    command: 'npm',
    args: Object.freeze(['--version']),
  });
}

async function npmVersion() {
  const { spawnSync } = await import('node:child_process');
  const invocation = npmVersionInvocation();
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error || result.status !== 0) fail('package_lock_npm_version_unavailable');
  const version = String(result.stdout || '').trim();
  if (!version) fail('package_lock_npm_version_unavailable');
  return version;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(String(args.root || process.cwd()));
  const packageJsonPath = path.resolve(String(args['package-json'] || path.join(root, 'package.json')));
  const packageLockPath = path.resolve(String(args['package-lock'] || path.join(root, 'package-lock.json')));
  const material = createPackageLockMaterial({
    packageJsonPath,
    packageLockPath,
    nodeVersion: process.version,
    npmVersion: await npmVersion(),
  });
  const json = JSON.stringify(material, null, 2) + '\n';
  if (args.out && args.out !== true) fs.writeFileSync(path.resolve(String(args.out)), json, 'utf8');
  process.stdout.write(JSON.stringify(material) + '\n');
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(JSON.stringify({
      schema: 'metaengine.browser.package-lock-material-error.v1',
      code: String(error?.message || error).split(':')[0],
      message: String(error?.message || error).slice(0, 1000),
      authority_effect: false,
    }) + '\n');
    process.exitCode = 1;
  });
}

export {
  MATERIAL_SCHEMA,
  createPackageLockMaterial,
  validatePackageLockMaterial,
  loadPackageLockMaterialProof,
};
