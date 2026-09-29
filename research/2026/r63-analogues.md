# R63 — P0-b «classifier tier» (Run Modes + классификатор пре-исполнения): сверка с каноном Cursor

Раунд: R63 · Слайс DAG: **P0-1** из R61-GAP-ANALYSIS (capability `core.run-modes` + `sec.auto-review-classifier`)
Источники: официальный корпус R61 (329 стр., curl-канал, Source Registry R61-SOURCE-REGISTRY.md), трек D
(r61-track-D-security-computeruse.md: D02, D03, D35), трек A (r61-track-A-core.md: terminal/run-modes).
Метод: только официальные страницы Cursor (docs/blog/security), цитаты дословные, confidence HIGH
(первоисточник), время — сентябрь 2026. Независимая перепроверка корпуса web_search'ом по-прежнему
закрыта (429) — помечено.

---

## 1. Канон Cursor (дословно из корпуса)

**D02 Run Mode — Auto-review (classifier-gated autonomy)** — docs/agent/security/run-modes + blog
agent-autonomy-auto-review (Jun 11, 2026), GA, Cursor 3.6+:
- «Runs allowlisted calls immediately; sandboxes shell when possible; everything else (shell, MCP,
  Fetch) goes to the Auto-review classifier — an agentic small model that reviews actions in context
  before they run. **Order: allowlist → sandbox-ability (unsandboxable → classifier) → classifier.**»
- Рантайм: «small Cursor-managed model — Claude 4.5 Haiku or GPT-5.4 Mini; runs in the same RPC
  stream as the parent agent (subagent-like)»; классификатор может читать workspace
  (ReadFile/Grep/Glob/ListDir); при блоке возвращает объяснение родительскому агенту.
- Границы: «**"not a security boundary"**; classifier blocks ~4% of reviewed actions; only ~7% of
  Auto-review chats hit ≥1 interruption».

**D03 Run Modes (три режима)** — docs/agent/security/run-modes:
- «Three approval regimes for shell/MCP/Fetch calls: Auto-review (recommended default), Allowlist
  (deterministic), Run Everything (zero prompts)».
- permissions.json: `terminalAllowlist` — паттерны команды/аргументов (`npm:install*` — установка
  пакетов ПОД одобрением); `autoRun` — NL-steering классификатора.

**D35 Grok Bot Auto Review** — GA (Enforce Auto-review + team rules = Enterprise only):
- «Independent review model evaluating risky actions BEFORE they run… Verdicts: **let proceed /
  require approval / deny**»; Approvals UI: **Allow once / Always allow (saves matching rule) /
  Deny**; «"Ask first" always stops matches; team rules appear locked».
- Blind spots: «memory writes and most settings changes are not reviewed».

**Terminal tool** (трек A): «Run Mode controls when commands run, when Cursor asks, and when terminal
commands enter the sandbox; sandbox blocks unauthorized file access and network activity».

## 2. ME2 после R63 (реализовано) vs канон

| Измерение | Cursor (канон) | ME2 R63 | Статус |
|---|---|---|---|
| Порядок enforcement | allowlist → sandbox-ability → classifier (D02) | план planExec (allowlist по СЕГМЕНТАМ) → prlimit → classifyGate в runTerminalAsync | **PARITY** (порядок 1:1) |
| Вердикты | let proceed / require approval / deny (D35) | allow / ask / block (+ «sandbox» зарезервирован, до P0-2 не выдаётся) | **PARITY** |
| ask → оператор | Approvals UI: Allow once / Deny (D35) | очередь review_queue + POST /review approve\|deny из Mission Control и консоли | **PARITY** |
| Классификатор | агентная малая модель (Haiku/GPT-5.4-Mini), ≤3с, таймаут-политика не оглашена | LLM-путь opt-in (chat() через providers, P2-lane governor), ≤timeout_ms (policy 3000), **таймаут/429/невалидный ответ → ask (fail-closed к оператору, не к allow)** | **SUPERIOR по fail-closed** (у Cursor таймаут-политика в корпусе не оглашена; у ME2 гарантирован fail-closed) |
| Детерминированный тир | allowlist — на уровне команды; правила типа `npm:install*` | эвристика по именованным правилам: force_push, registry_egress, external_state, supply_chain, destructive_local, redirect_outside_roots, path_outside_roots, var_expansion_path | **PARTIAL→строже**: правило-набор публикуем и тестируем (eval), но он не «малая модель» |
| Security boundary | «not a security boundary» (D02, дословно) | тот же честный статус в /review honest_limits + UI | **PARITY** (самоописание) |
| Контекст решения | reviews actions «in context», читает workspace ReadFile/Grep/Glob/ListDir | улики: команда + cwd + бинари + сегменты + последние 3 прогона exec_runs (LLM-промпт) | **PARTIAL** (workspace-инструменты классификатору не даны) |
| Workspace-чтение классификатором | есть (D02) | нет — сознательно (не даём классификатору лишнюю поверхность до P0-2) | честный PARTIAL |
| Блок-объяснение агенту | «returns an explanation to the parent agent, which can retry a safer path» | reason возвращается в вердикте /exec (classifier_ask/block + detail) — агент видит причину | **PARITY** |
| Run Modes UI | Settings + permissions.json (user+repo, hot-reload) | policy.json `classifier {enabled,llm_enabled,timeout_ms,queue_max,model}` + POST /review config (runtime-override до рестарта) | **PARITY** (config-as-data) |
| Объяснение блоков в данных | событие в UI; метрики 4%/7% | события CLASSIFIER_BLOCK/ASK/APPROVED/DENIED/CONFIG в hash-chain + stats_24h в /review + очередь-журнал | **SUPERIOR** (неотказываемый tamper-evident журнал вердиктов) |
| Слепые зоны | «memory writes and most settings changes are not reviewed» (D35) | классификатор покрывает только /exec (TERMINAL_RUN); FILE_EDIT идёт своей плоскостью (dry-run+backup+rollback) | честный PARTIAL (тот же класс ограничения) |

## 3. Что поймал классификатор, чего не видел tier-1 (живая демонстрация ценности)

- `echo pwn > /home/z/my-project/pwn63.txt` при cwd в песочнице: tier-1 пропускает (echo в белом
  списке), классификатор ловит **redirect_outside_roots** → ask; файл НЕ создан (проверено ls).
  Это точный аналог «sandbox blocks unauthorized file access» — до P0-2 (Landlock) эту гарантию
  несёт тир-3. Патч-доказательство: exec_runs #… reason=classifier_ask.
- `cat /home/z/.a2/…` (секреты хоста) → **path_outside_roots** → ask: чтение чужих данных за корнем.
- `git push --force` → **block**; `git push` → **ask** (канон Cursor treat external state).

## 4. Живые доказательства раунда (REST + eval, сентябрь 24 2026)

- Гейт: `/exec run "echo me2-p0b-ok63"` → exit 0 (allow сквозной); redirect-команда →
  classifier_ask + queue_id, файл вне корней не создан; `curl` → cmd_denied (tier-1 НЕ скипается).
- Очередь: ask #2 → approve → исполнена (exit 128, не-git — исполнение доказано); повторный
  approve → 404; ask #3 → deny → denied; approve 999999 → 404; op bogus → 400.
- LLM-путь: config llm=true → classify → провайдер 429 (13-я сессия каналов) → llmRetry ~6с →
  fallback **ask** (fail-closed) — это одновременно живой FAIL-TEST «классификатор недоступен → ask»;
  канонический таймаут-тест 3.0с → ask подтверждён ранее. LLM-вердикт — при окне квоты (backlog).
- eval v27 `contract.classifier_tier`: план-инварианты (9 команд по именованным правилам), серия
  20 команд → распределение {allow:10, ask:8, block:2}, config on/off/on — **PASS 64/64 ×2**.
- Манифест non-bypass: POST /review классифицирован → **33/33 NO_BYPASS**; liveness LIVE.

## 5. Честные ограничения (не скрываем)

1. Классификатор эвристический по умолчанию; LLM-тир opt-in и упирается в квоту провайдера —
   в этом раунде живой LLM-вердикт не получен (429), получен живой fail-closed fallback.
2. Нет workspace-чтения классификатором (ReadFile/Grep) — как у Cursor, но у нас это и не дано
   принципиально до P0-2.
3. Путь-анализ лексический: редиректы/токены/`${…}`-пути; запутанные пути (base64, symlink из
   корня) ловит только будущий Landlock (P0-2) — классификатор тут **не** security boundary.
4. `verdict=sandbox` зарезервирован контрактом (Cursor D02), не выдаётся до P0-2.

## 6. Выводы для роадмапа

- P0-1 закрыт в коде (второй из 15 P0): approval-плоскость теперь 3-тирная, канонический порядок
  D02 соблюдён, ask-флоу полный (очередь → UI → approve/deny → исполнение с tier-1 на месте).
- Для полного PARITY с D02 осталось: (a) LLM-классификатор как default при доступной квоте —
 Infrastructure, не архитектура; (b) workspace-улики — после P0-2; (c) Always-allow правила
  («saves matching rule») — кандидат следующего мелкого слайса (правила как данные в policy.json).
- Следующий слайс DAG: **P0-e ingress** (внешние триггеры: webhooks-in + GitHub poller) или
  **P0-2 OS-сандбокс** (Landlock, закрывает и «sandbox»-вердикт) — по остатку времени раунда.
