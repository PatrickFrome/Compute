#!/usr/bin/env node
// Minimal local operator CLI for an already-running METAENGINE Browser Test.
// Reads the owner-private manifest and never prints its bearer token.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const allowed = new Set(['create', 'read', 'assign']);
const [action, ...args] = process.argv.slice(2);
if (!allowed.has(action)) throw new Error('usage: chat-fleet-client.mjs create|read|assign --tab <tab_id> --file <prompt> [--request <id>] [--count N]');
if (args.length % 2) throw new Error('chat_fleet_cli_option_invalid');
const flags = {};
for (let i = 0; i < args.length; i += 2) {
  const flag = args[i], value = args[i + 1];
  if (!['--tab','--file','--request','--count','--offset','--max-chars'].includes(flag) || Object.hasOwn(flags,flag)) throw new Error('chat_fleet_cli_option_invalid');
  flags[flag] = value;
}
const manifest = path.join(process.env.APPDATA || '', '@metaengine', 'browser-shell', 'managed-task-projects-v1', 'supervisor-rpc.json');
const cfg = JSON.parse(await fs.readFile(manifest, 'utf8'));
const url = new URL(String(cfg.url));
if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/rpc' || url.username || url.password || url.search || url.hash) {
  throw new Error('chat_fleet_cli_unsafe_endpoint');
}
if (cfg.schema !== 'metaengine.supervisor.loopback-rpc.v1' || typeof cfg.token !== 'string' || cfg.token.length < 32) throw new Error('chat_fleet_cli_manifest_untrusted');
const params = {};
if (action !== 'read') params.request_id = flags['--request'] || crypto.randomUUID();
if (action === 'create') params.count = Number(flags['--count'] || 1);
if (action !== 'create') {
  if (!flags['--tab']) throw new Error('chat_fleet_cli_tab_required');
  params.tab_id = flags['--tab'];
}
if (action === 'read') {
  if (flags['--offset']) params.offset = Number(flags['--offset']);
  if (flags['--max-chars']) params.max_chars = Number(flags['--max-chars']);
}
if (action === 'assign') {
  if (!flags['--file']) throw new Error('chat_fleet_cli_prompt_file_required');
  const stat = await fs.stat(flags['--file']);
  if (!stat.isFile() || stat.size > 48 * 1024) throw new Error('chat_fleet_cli_prompt_file_invalid');
  params.text = await fs.readFile(flags['--file'], 'utf8');
}
const response = await fetch(url, {
  method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60_000),
  headers: { 'Authorization': 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
  body: JSON.stringify({ method: 'chat.' + action, params }),
});
const result = await response.json();
if (!response.ok || result?.ok !== true) {
  console.error(JSON.stringify({ ok: false, status: response.status, code: result?.error || 'RPC_FAILED',
    message: String(result?.message || '').slice(0, 180), automatic_retry_allowed: false }));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, ...result.result, request_id: params.request_id || null }, null, 2));
}
