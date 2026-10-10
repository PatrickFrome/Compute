#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { verifyOwnerOnlyWindowsStorage } from '../src/private-windows-storage-acl.mjs';
import { managedProjectEffectKey } from '../src/managed-task-project-authority-resolver.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELDS = ['idempotency_key', 'coordination_workspace_id', 'task_id', 'agent_id', 'claim_id', 'lease_generation', 'workspace_id', 'workspace_generation'];
const SCHEMA = 'metaengine.supervisor.loopback-rpc.v1';

export function managedProjectCommand(action, payload) {
  if (!['create', 'open'].includes(action) || !payload || typeof payload !== 'object' || Array.isArray(payload) ||
      Object.keys(payload).length !== FIELDS.length || Object.keys(payload).some(key => !FIELDS.includes(key))) {
    throw new Error('managed_project_cli_request_invalid');
  }
  const request = structuredClone(payload);
  for (const key of ['coordination_workspace_id', 'task_id', 'workspace_id']) {
    if (typeof request[key] !== 'string' || !UUID.test(request[key])) throw new Error('managed_project_cli_identity_invalid');
    request[key] = request[key].toLowerCase();
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{3,127}$/.test(request.idempotency_key || '') ||
      !/^agent_[a-z0-9-]{8,64}$/.test(request.agent_id || '')) throw new Error('managed_project_cli_identity_invalid');
  for (const key of ['claim_id', 'lease_generation', 'workspace_generation']) {
    if (!Number.isSafeInteger(request[key]) || request[key] < 1) throw new Error('managed_project_cli_identity_invalid');
  }
  request.idempotency_key = managedProjectEffectKey(request);
  return { command_id: randomUUID(), action: `PROJECT_${action.toUpperCase()}`, payload: request };
}

async function readPhysicalJson(filePath, maxBytes, privateFile = false) {
  if (!path.isAbsolute(filePath)) throw new Error('managed_project_cli_absolute_path_required');
  const st = await fs.lstat(filePath);
  if (!st.isFile() || st.isSymbolicLink() || st.size > maxBytes || await fs.realpath(filePath) !== path.resolve(filePath)) {
    throw new Error('managed_project_cli_file_invalid');
  }
  if (privateFile) {
    if (process.platform === 'win32') await verifyOwnerOnlyWindowsStorage(filePath);
    else if ((st.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && st.uid !== process.getuid())) {
      throw new Error('managed_project_cli_discovery_not_private');
    }
  }
  const handle = await fs.open(filePath, 'r');
  try {
    const current = await handle.stat();
    if (current.dev !== st.dev || current.ino !== st.ino || current.size !== st.size) throw new Error('managed_project_cli_file_changed');
    const bytes = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > maxBytes) throw new Error('managed_project_cli_file_too_large');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytesRead)));
  } finally { await handle.close(); }
}

export async function callManagedProject(manifest, command, { fetchImpl = fetch } = {}) {
  if (manifest?.schema !== SCHEMA || typeof manifest.url !== 'string' ||
      typeof manifest.token !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(manifest.token)) throw new Error('managed_project_cli_discovery_invalid');
  const url = new URL(manifest.url);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || !url.port ||
      url.pathname !== '/rpc' || url.search || url.hash || url.username || url.password) throw new Error('managed_project_cli_discovery_invalid');
  const response = await fetchImpl(url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(300000),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${manifest.token}` },
    body: JSON.stringify({ method: 'supervisor.command', params: { command } }),
  });
  if (!response.ok) throw new Error('managed_project_cli_transport_failed');
  const reader = response.body.getReader(); const parts = []; let bytes = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.length;
      if (bytes > 65536) throw new Error('managed_project_cli_response_too_large');
      parts.push(part.value);
    }
  } finally { await reader.cancel(); }
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)));
  const result = value?.result;
  if (value.schema !== SCHEMA || value.ok !== true || value.authority_effect !== false ||
      result?.schema !== 'metaengine.devos.managed-task-project-runtime.v1' || result.state !== 'PROVEN' ||
      result.action !== command.action || result.authority_effect !== false || result.automatic_retry_allowed !== false ||
      result.idempotency_key !== managedProjectEffectKey(command.payload) ||
      FIELDS.filter(key => key !== 'idempotency_key').some(key => result.reservation?.[key] !== command.payload[key]) ||
      result.reservation?.state !== 'READY' || result.reservation?.authority_effect !== false ||
      result.proof?.schema !== 'metaengine.devos.workspace-git-inventory-proof.v1' || result.proof.locked !== true || result.proof.prunable !== false ||
      result.proof.authority_effect !== false || result.proof.automatic_retry_allowed !== false ||
      ['workspace_id', 'workspace_generation', 'task_id', 'lease_generation'].some(key => result.proof[key] !== command.payload[key]) ||
      !/^[0-9a-f]{40}$/.test(result.proof.head_sha || '') || result.proof.head_sha !== result.reservation.base_sha ||
      typeof result.reservation.worktree_path !== 'string' || !result.reservation.worktree_path || result.proof.worktree_path !== result.reservation.worktree_path ||
      (command.action === 'PROJECT_OPEN' && result.opened !== true)) {
    throw new Error('managed_project_cli_effect_not_proven');
  }
  return { ok: true, state: result.state, action: result.action, workspace_id: command.payload.workspace_id,
    task_id: command.payload.task_id, head_sha: result.proof.head_sha, replayed: result.replayed === true,
    opened: result.opened === true, authority_effect: false };
}

export async function runManagedProjectCli(argv) {
  if (argv.length === 1 && argv[0] === '--help') {
    process.stdout.write('node scripts/run-managed-project.mjs create|open --discovery-file <private supervisor-rpc.json> --request-file <identity JSON>\n');
    return;
  }
  if (argv.length !== 5 || argv[1] !== '--discovery-file' || argv[3] !== '--request-file') throw new Error('managed_project_cli_arguments_invalid');
  const command = managedProjectCommand(argv[0], await readPhysicalJson(argv[4], 4096));
  const manifest = await readPhysicalJson(argv[2], 4096, true);
  const result = await callManagedProject(manifest, command);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runManagedProjectCli(process.argv.slice(2)).catch(() => {
    process.stderr.write('managed_project_command_failed\n');
    process.exitCode = 1;
  });
}
