'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const PROTOCOL = 'metaengine.development-plane.v1';
const VERSION = '0.1.3';
const CAPABILITIES = Object.freeze(['HEALTH', 'CAPABILITIES', 'PROCESS_METRICS', 'REPO_HEAD_READ']);
const repoRoot = path.resolve(process.env.METAENGINE_REPO_ROOT || process.cwd());

function send(message) {
  if (!process.parentPort) throw new Error('development_plane_parent_port_missing');
  process.parentPort.postMessage({ protocol: PROTOCOL, ...message, authority_effect: false });
}

async function readRepoHead() {
  const gitPath = path.join(repoRoot, '.git');
  let gitDir = gitPath;
  try {
    const stat = await fs.stat(gitPath);
    if (stat.isFile()) {
      const marker = (await fs.readFile(gitPath, 'utf8')).trim();
      if (!marker.startsWith('gitdir: ')) throw new Error('repo_git_pointer_invalid');
      gitDir = path.resolve(repoRoot, marker.slice('gitdir: '.length).trim());
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return { repository_present: false, head: null, ref: null };
    throw error;
  }
  const head = (await fs.readFile(path.join(gitDir, 'HEAD'), 'utf8')).trim();
  if (head.startsWith('ref: ')) {
    const ref = head.slice(5).trim();
    let sha = null;
    try { sha = (await fs.readFile(path.join(gitDir, ref), 'utf8')).trim(); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    return { repository_present: true, head: sha, ref };
  }
  return { repository_present: true, head, ref: null };
}

async function execute(capability) {
  if (!CAPABILITIES.includes(capability)) throw new Error('capability_denied');
  if (capability === 'HEALTH') return { ok: true, pid: process.pid, uptime_seconds: process.uptime(), process_type: process.type || 'utility' };
  if (capability === 'CAPABILITIES') return { version: VERSION, capabilities: [...CAPABILITIES], direct_promote_current: false, arbitrary_eval: false };
  if (capability === 'PROCESS_METRICS') return { memory: process.memoryUsage(), cpu: process.cpuUsage(), pid: process.pid };
  if (capability === 'REPO_HEAD_READ') return readRepoHead();
  throw new Error('capability_denied');
}

if (!process.parentPort) throw new Error('development_plane_parent_port_missing');

process.parentPort.on('message', async (event) => {
  const message = event?.data;
  if (!message || message.protocol !== PROTOCOL) return;
  if (message.type === 'CONTROL' && message.control === 'SHUTDOWN') {
    send({ type: 'SHUTDOWN_ACK', version: VERSION });
    setTimeout(() => process.exit(0), 25);
    return;
  }
  if (message.type !== 'REQUEST' || typeof message.request_id !== 'string') return;
  const capability = String(message.capability || '').toUpperCase();
  try {
    const result = await execute(capability);
    send({ type: 'RESPONSE', request_id: message.request_id, ok: true, result });
  } catch (error) {
    send({ type: 'RESPONSE', request_id: message.request_id, ok: false, error: String(error?.message || error).slice(0, 160) });
  }
});

send({ type: 'READY', version: VERSION, capabilities: [...CAPABILITIES] });
