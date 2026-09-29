# ME2-DAEMON Subsystem Inventory — §5/§6 increment (Job 419718 @14:15, R28)
*Предыдущий инкремент: api-sdk-scan-1408.md (§3 scan + consumer analysis). Этот файл: жёсткая классификация подсистем daemon по §6 на фактуре тика 1415. Формат живой — дополняется каждый тик до полных 20-полевых записей §5.*

## A. LLM-плоскость (§3 work package — закрыт кварантином этого тика)

| Механизм | Файл | Фактура тика | Verdict §6 | Action |
|---|---|---|---|---|
| Vercel AI Gateway runtime path | `providers.ts` (fetch → ai.gateway.vercel.dev, R47 key, R73 TLS-probe) | Заблокирован на 4 уровнях: `GATEWAY_QUARANTINED` — loadGatewayKey→null (RPC не вызывается), providerChain без gateway (gatewayReady→false), TLS-probe→false (сетевые API-пробы запрещены), chatOnce→throw `gateway_quarantined`. Environ-override запрещён (§3: fallback не возвращается молча) | **QUARANTINE** (применён, commit 35369651) | REMOVE после миграции 5 консьюмеров на Web-UI fleet path (§15: consumer search ✓ → replacement tests → migration → regression → physical proof) |
| zai native provider slot | `providers.ts` chatOnce-zai (z-ai-web-dev-sdk) | Sandbox-native backend; в product-поверхностях браузера отсутствует (scan 1408: src/app/electron чисты). Работает после кварантина — единственный провайдер цепочки | **KEEP** | Остается до доказанной замены всего daemon-LLM-контура; TODO(migrate) маркер на ветке gateway |
| chat() orchestration (governor admission → llmSlot → quota L1/L2 → failover L3 → retry R14) | `providers.ts`, `src/governor.ts`, `src/quota.ts` | `llm.failover_chain` eval PASS при кварантине (инвариант честности: gateway в цепочке ⇔ ключ доступен — теперь никогда) | **KEEP** | Resilience-инфраструктура zai-пути; при миграции консьюмеров переиспользуется как обёртка |
| LLM-консьюмеры daemon | `src/review.ts, agentchat.ts, eval.ts, rsi.ts, reviewer.ts` (import { chat }) | После кварантина работают ТОЛЬКО через zai-ветку; скрытый fallback к API невозможен | **INTEGRATE** | Work package: миграция на Web-UI fleet path (очередь; prerequisites — классификация выживания самого daemon, ниже) |

## B. Vault + Gate (FIX применён этим тиком)

| Механизм | Файл | Фактура тика | Verdict §6 | Action |
|---|---|---|---|---|
| R47 token vault (SQLite, single source, маски, T0-плоскость) | `src/tokens.ts` | Механика set/get/mask/идемпотент/delete/get-after — вся PASS (70-check eval) | **KEEP** | — |
| Bootstrap-миграция known-ядра | `src/tokens.ts` (SEED_FILES → /home/z/.a2) | ДЕФЕКТ НАЙДЕН+ИСПРАВЛЕН: eval `tokens.in_db` был вечно-красный в изолированных контурах (требовал ВСЁ ядро при частичном наборе источников: здесь есть только `.github.env`, нет `supabase-cloud.env` → SUPABASE_URL отсутствует честно). Fix: `bootstrapExpectedCore()` — per-token граница применимости (дефект = источник есть, миграция не прошла). Доказательство: stash-прогон чистого дерева дал идентичный FAIL 69/70 (pre-existing), после fix — **GATE PASS 70/70** | **FIX** (применён) | Закрыт; gate signal integrity восстановлена |
| Eval gate (70 checks) + probe.sh boot-probe | `src/eval.ts`, `scripts/probe.sh` | 3 прогона тика: 69/70 (baseline, pre-existing FAIL) → 69/70 (с кварантином, без регрессии) → **70/70 PASS** | **KEEP** | Контракт-тест каждого тика изменений daemon |

## C. Ядро runtime (subsystem-level; полные §5-записи — очередь следующих тиков)

| Механизм | Файл | Первичная фактура | Verdict §6 |
|---|---|---|---|
| SQLite store (WAL, single-writer) | `store.ts` (508) | Горячий путь; один автор — master loop worker.ts | **KEEP** |
| Command bus (single-writer principle) | `commands.ts` (731) | REST/WS → команды → master loop | **KEEP** — отдельная плоскость от Supabase command table браузера (не duplicate; сверить границы на §5-записи) |
| Master/agent loop (nO+Pi lessons) | `worker.ts` (492) | Один поток владеет состоянием; park-and-resume L4 | **KEEP** |
| WS/REST surface | `index.ts` (1376) | /health /state /providers /llm + WS lanes; после кварантина /llm честно показывает gateway ready=false | **KEEP** |
| MCP stdio adapter | `mcp-stdio.ts` | Транспорт десктопных клиентов (R25) | **KEEP** |
| Evidence Mirror v2 outbox | `evidence.ts` (460) | 3 уровня доставки → Supabase | **KEEP** |
| GLM currency plane | `src/glm.ts` | R29: все агенты на последней модели (canonical upgrade) | **KEEP** |
| Brain (cognitive port) | `src/brain.ts` | ME5-порт; §11-требование (memory → routing) НЕ верифицировано на этом тике | **KEEP-pending-verify** |
| Прочее (agentchat 884, contract 738, core 630, sandbox2 509, mechanics 429, sense 395, sqlmirror 382, memory 380, exec 378, pool 369, obsv 353, edit 328, autonomy 325, review 312, screencast 311 + мелкие) | `src/*` | Не разбирались этим тиком — §5-записи по графику | **PENDING §5** (без вердикта — по директиве §6 нельзя оставлять UNKNOWN навсегда; очередь) |

## D. Live-state факты тика
- me2-daemon в sandbox НЕ запущен (14041 мёртв; bun-процессы = webhook-relay + a2-edge-local) → кварантин вступает в силу при следующем boot через gate; in-memory риска нет; рестартов live-состояний не производилось.
- Build pin браузера UNCHANGED (0.7.0-dev.36336130139.1, CURRENT) — effect-plane re-probe пропущен корректно.
- Commit: 35369651 (providers.ts + eval.ts + tokens.ts, main, branch-local; push — через git-sync → sandbox/me2-os).
