# R61 — CURSOR CAPABILITY ENCYCLOPEDIA (индекс)

Раунд: R61 (2026-09-24) · Миссия оператора: «MetaEngine должна получить capability-level parity с Cursor и его агентами, а затем превзойти Cursor».
Метод: **только официальные источники**, актуальные на момент исполнения. Каналы: `web_search`/`page_reader` — 429 (11-я сессия подряд, не амплифицированы); **прямой curl к cursor.com — рабочий** → скачан sitemap (338 URL) и полный корпус: **329 страниц, 0 отказов** (207 docs + 122 blog/security/changelog), чистый текст 3.5MB (`/tmp/r61-corpus`, восстановимо скриптом `tool-results/r61/fetch-corpus.py`).

## Состав энциклопедии

| Файл | Трек | Capabilities | Покрытие миссии |
|---|---|---|---|
| r61-track-A-core.md | A | 53 | §2 Core Agent, §3 Harness, §4 Tools, Planning, Projects, Agents Window, Debug/Design, run-modes |
| r61-track-B-extensibility.md | B | 57 | §5 Rules/Skills/Subagents/Hooks/MCP/Plugins/SDK/Extension API |
| r61-track-C1-cloud-env.md | C1 | 61 | §7 Cloud/Background Agents, §9 Dev Environment, §15 Long-running, §19 Self-hosted pools |
| r61-track-C2-cli-automation.md | C2 | 54 | §11 Git/Delivery, §13 Automations, API/webhooks, CLI, Origin (git-forge) |
| r61-track-D-security-computeruse.md | D | 45 | §8 Computer Use (4 поверхности), §10 Sandbox/Security, Bugbot, Security Agents, enterprise-контролы |
| r61-track-E1-models-context.md | E1 | 44 | §14 Model Routing (Compass+таксономия), §20 Context Engineering, §21 Evaluation |
| r61-track-E2-fleet-changelog.md | E2 | 46+timeline | §12 Multi-agent/Fleet (swarm, agent VCS, Field Guide), датированная история 2024-09→2026-09 |
| **Итого сырьё** | | **360** | → дедуплицировано в матрицу 138 строк |

Каждая capability в треках несёт: что делает → как запускается → runtime за ней → prerequisites → ограничения → уровень автономии (L0..L4) → точные цитаты-улики → статус (GA/BETA/PREVIEW/ANNOUNCED/DEPRECATED/RESEARCH) → confidence.

## Сводные выводы (детали — в матрице и roadmap)

1. **Единый harness**: правила/скиллы/субагенты/хуки/MCP — один и тот же набор под IDE, CLI, Cloud Agents и SDK. Паритетить нужно harness, не UI.
2. **Три уровня enforcement у Cursor**: allowlist → sandbox-when-possible (Seatbelt/Landlock) → auto-review LLM-классификатор (маленькая модель, пре-исполнение, «не security boundary» по их же словам). У ME2 enforcement жёстче (non-bypass шина, fail-closed), но нет ни классификатора, ни OS-сандбокса.
3. **Облачные агенты** = Firecracker microVM + environment.json + Builds-снапшоты + egress-политики + self-healing (Cloud Doctor/autoinstall) + долговременные прогоны (Temporal-подобный durable execution).
4. **Автоматизации** = cron + 12 типов GitHub-триггеров + Slack/Linear/webhooks — универсальная event/schedule-плоскость; у ME2 только внутренние расписания.
5. **Swarm-выводы Cursor (research)**: рекурсивные planner→worker деревья, handoff-документы как протокол, кастомный agent VCS, Field Guide; locks/integrators/judges — выкинуты; масштабирование = экономия контекста ролей, не параллелизм.
6. **Роутер**: Compass (P(satisfaction)) → таксономия задач → бюджет per-turn; real-time RL чекпоинт каждые ~5 часов.
7. **Персистентной памяти агентов в корпусе не найдено** (corpus-negative) — у ME2 memory.ts (эпизоды/семантика/процедуры + economy) уже есть → SUPERIOR-кандидат подтверждён.
8. **Паритет уже достигнут (18 строк)**: model-switch, task tracking, subagent-lifecycle (leases), MCP-сервер, browser-tool, secrets, redaction, stuck-detection, worktrees, multi-agent-repo, screenshots, logs, internal evals, reward-hack audit, self-update, контракт, harness-evals, egress-default.
9. **SUPERIOR (6 строк, corpus-negative + evidence)**: персистентная память, tamper-evident execution trace (hash-chain+OTel+non-bypass), non-bypass шина с eval-гейтом, «аудит как цикл» (переходные события), exthost строже канона (prlimit+env-whitelist+stdio-only+caps), Supabase state-plane с RLS fail-closed + reconcile.
10. **Главные гэпы (P0)**: см. R61-GAP-ANALYSIS.md — терминал/exec-инструмент, OS-сандбокс, классификатор пре-исполнения, провижининг окружения, внешние триггеры автоматизаций, durable execution, swarm-протокол, Plan Mode, MCP-клиент, hooks как пользовательские скрипты.

## Числа паритета

| Статус | Строк |
|---|---|
| PARITY | 18 |
| PARTIAL | 76 |
| MISSING | 34 |
| SUPERIOR | 6 |
| NOT_APPLICABLE | 4 |
| **Всего** | **138** |

Гэпы: 110 → **P0: 15 · P1: 36 · P2: 44 · P3: 15**.

## Как читать комплект R61

- **R61-SOURCE-REGISTRY.md** — все источники с датами/доверием + честный журнал каналов.
- **R61-ARCHITECTURE-MODEL.md** — модель архитектуры Cursor (только подтверждённые свойства).
- **R61-PARITY-MATRIX.md** + **r61-parity-matrix.json** — матрица (JSON = источник истины, MD генерируется).
- **R61-GAP-ANALYSIS.md** — разбор каждого PARTIAL/MISSING: причина, архитектура, контракты, тесты.
- **R61-ROADMAP.md** — P0..P9 dependency-DAG, slices, verification, benchmark-план, beyond-Cursor.
- **r61-track-*.md** — энциклопедия-сырьё (360 capabilities с цитатами).
