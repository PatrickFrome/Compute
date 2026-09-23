/**
 * ME2 Brain Adapter (R42 smart merge) — двусторонний адаптер памяти brain ⇄ mem-economy.
 *
 * Наследие browser-brain-* (durable persistence / observation cursors): у браузера есть свой
 * мозг (checkpoints наблюдений в userData), у ME2 daemon'а — своя память с token-economy (E5:
 * sticky/fresh/familiar, memBlockEconomy). Адаптер СВЯЗЫВАЕТ их, не переписывая ни одну:
 *
 *   brain → mem-economy: раз в тик читает durable-checkpoint мозга (≤32MB, как читает сам мозг),
 *     считает честный дельта-хеш; изменился — ограниченная проекция уезжает в daemon как
 *     эпизодическая память (POST /memory op:write, key=brain:browser:<hash8>, дедуп по ключу).
 *   mem-economy → brain: спрашивает у daemon'а экономный блок (POST /memory op:economy,
 *     consumer='browser-brain' — sticky-уроки + fresh, бюджет символов) и атомарно кладёт его
 *     в sidecar в userData; потребители мозга получают память ME2, не зная о daemon'е.
 *
 * Fail-open: файла мозга нет / daemon недоступен → честные строки, состояние DEGRADED, мозг
 * браузера живёт как раньше. Zero-authority: адаптер НИКОГДА не пишет в checkpoint мозга
 * (только читает) и не влияет на память daemon'а сверх штатного REST-контракта.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ME2_REST_BASE } from './me2-daemon-host.mjs';

export const ME2_BRAIN_ADAPTER_SCHEMA = 'metaengine.browser.me2.brain-adapter.v1';

const BRAIN_FILE = process.env.ME2_BRAIN_CHECKPOINT_FILE || 'metaengine-browser-brain-collaboration-v1.json';
const SIDECAR_FILE = process.env.ME2_MEMORY_SIDECAR_FILE || 'metaengine-me2-memory-block-latest-v1.json';
const MAX_BRAIN_BYTES = 32 * 1024 * 1024; // тот же предел, что у BrowserBrainDurablePersistence
const SYNC_MS = Number(process.env.ME2_BRAIN_SYNC_MS || 60000);
const FIRST_DELAY_MS = Number(process.env.ME2_BRAIN_FIRST_DELAY_MS || 12000);
const PROJECTION_CHARS = 3500; // бюджет проекции мозга в память daemon'а
const CLIP_ITEMS = 12;

let syncTimer = null;
let firstTimer = null;
let stopped = false;
let lastBrainHash = null;
let lastBlockKey = null;
let stats = { brain_deltas_synced: 0, blocks_delivered: 0, ticks: 0, errors: 0 };
let lastError = null;
let startedAt = null;

function emitRow(row_, { error = false } = {}) {
  const text = JSON.stringify(row_);
  if (error || process.argv.some((a) => String(a || '').startsWith('--metaengine-'))) console.error(text);
  else console.log(text);
}

function row_(event, patch = {}) {
  return { schema: ME2_BRAIN_ADAPTER_SCHEMA, event, ...patch };
}

async function me2Fetch(path_, init) {
  const r = await fetch(`${ME2_REST_BASE}${path_}`, { signal: AbortSignal.timeout(8000), ...init });
  if (!r.ok) throw new Error(`me2_http_${r.status}`);
  return r.json();
}

/** Канонический стабильный JSON (сортировка ключей) — честный дельта-хеш. */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/** Ограниченная проекция checkpoint'а мозга (без PII-раздувания: только структура + хвосты массивов). */
function projectCheckpoint(cp) {
  const clip = (arr) => (Array.isArray(arr) ? arr.slice(-CLIP_ITEMS) : undefined);
  const out = {};
  for (const [k, v] of Object.entries(cp ?? {})) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      const c = clip(v);
      if (c !== undefined && c.length) out[k] = c;
    } else if (typeof v === 'object') {
      const s = stableStringify(v);
      if (s && s.length <= 400) out[k] = v; // маленькие объекты целиком
      else out[k] = { _omitted_bytes: s ? s.length : 0 }; // большие — честно помечаем
    } else {
      out[k] = v;
    }
  }
  const text = stableStringify(out) ?? '{}';
  return text.length > PROJECTION_CHARS ? text.slice(0, PROJECTION_CHARS) : text;
}

/** brain → mem-economy: дельта checkpoint'а мозга в память daemon'а. */
async function syncBrainToEconomy(userData) {
  const file = path.join(userData, BRAIN_FILE);
  let stat;
  try { stat = fs.statSync(file); } catch { return false; } // мозг ещё не писал checkpoint — честно ничего не делаем
  if (!stat.isFile() || stat.size < 2 || stat.size > MAX_BRAIN_BYTES) {
    lastError = 'brain_checkpoint_size_invalid';
    emitRow(row_('BRAIN_CHECKPOINT_INVALID', { size: stat?.size ?? null }), { error: true });
    return false;
  }
  let cp;
  try { cp = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    lastError = `brain_checkpoint_json_invalid: ${String(e?.message || e).slice(0, 80)}`;
    emitRow(row_('BRAIN_CHECKPOINT_INVALID', { error: lastError }), { error: true });
    return false;
  }
  const hash = crypto.createHash('sha256').update(stableStringify(cp) ?? '').digest('hex');
  if (hash === lastBrainHash) return false; // без изменений — дешёвый no-op
  const content = projectCheckpoint(cp);
  const key = `brain:browser:${hash.slice(0, 8)}`;
  const j = await me2Fetch('/memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'write', kind: 'episodic', key, content, tags: ['brain', 'browser', 'r42'], importance: 0.5 }),
  });
  if (!j?.ok) throw new Error(`memory_write_rejected: ${String(j?.error || '?').slice(0, 80)}`);
  const created = j.row?.created === true;
  lastBrainHash = hash;
  stats.brain_deltas_synced += 1;
  emitRow(row_('BRAIN_DELTA_SYNCED', { key, created, chars: content.length, hash: hash.slice(0, 12) }));
  return true;
}

/** mem-economy → brain: экономный блок памяти ME2 в sidecar для потребителей мозга. */
async function deliverEconomyToBrain(userData) {
  const j = await me2Fetch('/memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'economy', consumer: 'browser-brain', n: 5, budget: 1400 }),
  });
  if (!j?.ok) throw new Error(`memory_economy_rejected: ${String(j?.error || '?').slice(0, 80)}`);
  const block = String(j.block ?? '');
  const ids = (j.used ?? []).map((u) => u.id).filter((x) => Number.isSafeInteger(x));
  const blockKey = `${ids.join(',')}|${block.length}`;
  if (blockKey === lastBlockKey) return false; // блок не изменился — не шумим
  const sidecar = {
    schema: ME2_BRAIN_ADAPTER_SCHEMA,
    kind: 'me2_memory_block',
    block,
    used_ids: ids,
    saved_pct: typeof j.saved_pct === 'number' ? j.saved_pct : null,
    consumer: 'browser-brain',
    delivered_at: new Date().toISOString(),
    note: 'экономный блок памяти ME2 (sticky+fresh+familiar, E5) — прочитайте memory_search в daemon\'е для деталей',
  };
  const file = path.join(userData, SIDECAR_FILE);
  const body = `${JSON.stringify(sidecar)}\n`;
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(temp, body, { mode: 0o600 });
  await fsp.rename(temp, file); // атомарно — ровно как пишет сам мозг
  lastBlockKey = blockKey;
  stats.blocks_delivered += 1;
  emitRow(row_('MEMORY_BLOCK_DELIVERED', { file: path.basename(file), ids: ids.length, chars: block.length, saved_pct: sidecar.saved_pct }));
  return true;
}

async function tick(userData) {
  stats.ticks += 1;
  try {
    await syncBrainToEconomy(userData);
  } catch (e) {
    stats.errors += 1;
    lastError = `brain→economy: ${String(e?.message || e).slice(0, 120)}`;
    emitRow(row_('SYNC_FAILED', { direction: 'brain_to_economy', error: lastError }), { error: true });
  }
  try {
    await deliverEconomyToBrain(userData);
  } catch (e) {
    stats.errors += 1;
    lastError = `economy→brain: ${String(e?.message || e).slice(0, 120)}`;
    emitRow(row_('SYNC_FAILED', { direction: 'economy_to_brain', error: lastError }), { error: true });
  }
}

export function startMe2BrainAdapter({ userData } = {}) {
  if (stopped || syncTimer) return me2BrainAdapterStatus();
  if (!userData || typeof userData !== 'string') {
    emitRow(row_('BRAIN_ADAPTER_DEGRADED', { reason: 'user_data_unavailable' }), { error: true });
    return me2BrainAdapterStatus();
  }
  startedAt = new Date().toISOString();
  emitRow(row_('BRAIN_ADAPTER_START', { brain_file: BRAIN_FILE, sidecar_file: SIDECAR_FILE, sync_ms: SYNC_MS }));
  const t = () => { tick(userData).catch(() => { /* ошибки уже в строках шины */ }); };
  firstTimer = setTimeout(t, FIRST_DELAY_MS);
  syncTimer = setInterval(t, SYNC_MS);
  return me2BrainAdapterStatus();
}

export function stopMe2BrainAdapter() {
  stopped = true;
  if (firstTimer) clearTimeout(firstTimer); // первый отложенный тик тоже отменяем
  firstTimer = null;
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = null;
  return me2BrainAdapterStatus();
}

export function me2BrainAdapterStatus() {
  return {
    schema: ME2_BRAIN_ADAPTER_SCHEMA,
    started_at: startedAt,
    stopped,
    brain_file: BRAIN_FILE,
    sidecar_file: SIDECAR_FILE,
    last_brain_hash: lastBrainHash ? lastBrainHash.slice(0, 12) : null,
    last_block_delivered: lastBlockKey,
    stats: { ...stats },
    last_error: lastError,
    rest_base: ME2_REST_BASE,
    authority_effect: false,
  };
}
