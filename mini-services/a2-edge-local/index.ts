// a2-edge-local — локальный запуск edge-функции METAENGINE
// (apps/metaengine-browser/supabase/a2-browser-native-supervisor-v1)
// под Bun без Deno/Supabase-рантайма.
//
// Механика: при каждом старте синхронизируем канонический код edge из репо
// (source of truth) в ./edge-runtime и переписываем единственный Deno-специфик
// импорта ('npm:postgres@3.4.7' -> 'postgres'). Репозиторий не модифицируется.
//
// Запуск: cd mini-services/a2-edge-local && bun run dev
// Порт: 3031 (через gateway: /?XTransformPort=3031)

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const REPO_BROWSER = '/home/z/my-project/rsi-work/Compute-r/apps/metaengine-browser';
const REPO_EDGE = REPO_BROWSER + '/supabase/a2-browser-native-supervisor-v1';
// Сохраняем относительную глубину: edge импортирует '../../src/*.mjs', поэтому
// рантайм-копия повторяет структуру apps/metaengine-browser целиком.
const RUNTIME_ROOT = new URL('./edge-runtime/', import.meta.url).pathname;
const RUNTIME_EDGE = RUNTIME_ROOT + 'apps/metaengine-browser/supabase/a2-browser-native-supervisor-v1/';
const PORT = Number(process.env.A2_EDGE_PORT || 3031);

// --- 1. Синк кода edge + зависимого src из репо ---
rmSync(RUNTIME_ROOT, { recursive: true, force: true });
mkdirSync(RUNTIME_EDGE, { recursive: true });
cpSync(REPO_EDGE, RUNTIME_EDGE, { recursive: true });
const RUNTIME_SRC = RUNTIME_ROOT + 'apps/metaengine-browser/src/';
cpSync(REPO_BROWSER + '/src', RUNTIME_SRC, { recursive: true });

// --- 2. Переписывание Deno-специфик импорта ---
const indexTs = RUNTIME_EDGE + 'index.ts';
if (!existsSync(indexTs)) throw new Error(`edge index not found after sync: ${indexTs}`);
let src = readFileSync(indexTs, 'utf8');
const npmImport = /import postgres from ['"]npm:postgres@[^'"]+['"]\s*;/;
if (!npmImport.test(src)) throw new Error('expected npm:postgres import not found in edge index.ts');
src = src.replace(npmImport, "import postgres from 'postgres';");
// bun не поддерживает npm:-спесификаторы Deno; postgres ставится в node_modules сервиса.
// node_modules должен резолвиться ИЗ рантайм-копии — симлинк на модуль сервиса:
const nm = RUNTIME_ROOT + 'node_modules';
if (!existsSync(nm)) {
  mkdirSync(nm, { recursive: true });
  try { await (await import('node:fs/promises')).symlink(new URL('./node_modules', import.meta.url).pathname, nm, 'dir'); } catch {}
}
writeFileSync(indexTs, src);

// Отладочный дамп материала подписи (A2_EDGE_DEBUG=1) — только в рантайм-копии.
if (process.env.A2_EDGE_DEBUG === '1') {
  src = readFileSync(indexTs, 'utf8');
  src = src.replace(
    "return{ok:false,reason:'INVALID_SIGNATURE'};const grant=",
    "{console.error('[dbg-material]',JSON.stringify(material),JSON.stringify(jwk));return{ok:false,reason:'INVALID_SIGNATURE'}};const grant=",
  );
  writeFileSync(indexTs, src);
  console.log('[a2-edge-local] A2_EDGE_DEBUG material dump enabled');
}

// --- 3. Deno polyfill (до импорта edge) ---
const g = globalThis as any;
if (!g.Deno) {
  g.Deno = {
    env: { get: (k: string) => process.env[k] },
    serve: (handler: (req: Request) => Response | Promise<Response>) => {
      Bun.serve({
        port: PORT,
        idleTimeout: 120,
        async fetch(req: Request) {
          try {
            return await handler(req);
          } catch (err: any) {
            console.error('[a2-edge-local] handler error:', err?.message || err);
            return new Response(
              JSON.stringify({ error: 'edge_internal_error', detail: String(err?.message || err) }),
              { status: 500, headers: { 'content-type': 'application/json' } },
            );
          }
        },
      });
      console.log(`[a2-edge-local] edge listening on http://127.0.0.1:${PORT}`);
    },
  };
}

// --- 4. env для edge ---
process.env.SUPABASE_DB_URL ??= 'postgres://postgres:postgres@127.0.0.1:55432/postgres';
// JWT-форменный ключ НЕ задаём намеренно: приватные Realtime-каналы остаются
// выключенными, wake работает через POSTGRES_NOTIFY (канонический локальный путь).
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'sb_secret_local-reconstructed-service-role';
process.env.SUPABASE_URL ??= '';

// --- 5. Запуск ---
console.log('[a2-edge-local] importing edge (synced from repo) ...');
await import(RUNTIME_EDGE + 'index.ts');
console.log('[a2-edge-local] edge module loaded');
void spawnSync; // (зарезервировано)
