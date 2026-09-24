# R24 — Супер-аудит + критический анализ ресёрчей + VS Code/Codex + Роадмап

**Дата:** 2026-09-23 00:05–00:30 UTC | **Agent:** Z.ai Code (main) | **Task ID:** R24-AUDIT-RESEARCH-ROADMAP
**Источники:** живой Supabase REST (sb_secret), GitHub API, логи CI-ранов, research/2026/* (11 артефактов), web-сва ×4 (VS Code/Codex/сравнения/browser-MCP) — research/2026/R24-vs{1..4}*.json.

---

## 1. SUPABASE — ЖИВОЙ АУДИТ (00:05–00:15 UTC)

### 1.1 Состояние и активность
| Метрика | Значение |
|---|---|
| Heartbeat браузера | **2026-09-23T00:10:30 — пульс живой, синхронизация идёт прямо сейчас** |
| Версия браузера | 0.7.0-dev.35655839197.1 (свежайшая рельса), CONTROL/armed |
| Devices | 3 (A2_DEVICE_HTTP_SIGNATURE_V1); активный использован 00:10:32 — **device-auth работает против восстановленного облака** |
| Таблицы (строк) | supervisor_state 16 · supervisor_command **1833** · actuation_lease **4230** · mesh_instance 17 · enrollment_request 3243 · architecture_checkpoint 38 · devices 3 |
| Пустые | chat_bridge_remote_command 0 · peer_health 0 |
| Ограничения восстановления | cognitive_cursor, workspace_binding → 42501 RLS (нет GRANT); me2_evidence → 404 (миграция не применена); devos_fleet_* функции отсутствуют |
| Fleet-активность | transport-promotion leases 23:12 (RELEASED) — флот работал час назад |

### 1.2 Вывод
Восстановленное облако — **не архив, а живая плоскость**: браузер пишет heartbeat/leases/команды непрерывно. Каноническая БД-плоскость легаси работает на тех же механизмах, которые ME2 портировал локально (proof-gate, leases, device HTTP-signature). Для ME2 осталось: применить SQL-миграцию me2_evidence (файл готов: R23-me2-evidence-migration.sql) и (опц.) GRANT на закрытые таблицы.

---

## 2. GITHUB — АУДИТ И ТРЕТИЙ КОРЕНЬ CI

### 2.1 CI: три корня падений найдены и устранены (хронология)
| Ран | Корень | Фикс |
|---|---|---|
| 13257cc..64d1dc8 | ① ENOENT src-tauri/binaries (все ОС); ② GITHUB_ENV delimiter KEYEOF склеен с base64 | mkdir -p; printf '%s\n' + ME2KEYEOF (0334f92) |
| 0334f92 | ③ `failed to decode pubkey: Invalid symbol 95` — плейсхолдер «REPLACE_WITH_TAURI_SIGNER_PUBKEY» в tauri.conf.json | overlay-конфиг через `cargo tauri build --config` с реальным pubkey (ephemeral .pub или секрет TAURI_SIGNING_PUBLIC_KEY); fb1726b+ |
| 0334f92 прочие джобы | sidecar/signing шаги — **зелёные** (фиксы ①② подтверждены логами) | — |

### 2.2 Рельса и репозиторий
- Рельса 71d0d42 (#947) — без новых мержей за последний час (стабильно).
- 200+ веток / 587 открытых PR / ~110 воркфлоу — без изменений с R22.
- sandbox/me2-os: b75848d (v0.22.0, 19/19 WORKS).

---

## 3. СТАРЫЙ LIVE-БРАУЗЕР vs НОВЫЙ (ME2) — итоговое сравнение (обновлено живыми данными)

Легаси (жив, Windows x64, v35655839197, синхронизирован с облаком): effect-эпистемология ✓ (сквозная), identity chain ✓, fleet lease-плоскость через БД ✓ (4230 leases), device HTTP-signature ✓ (живой), self-update транзакционный ✓, память/MC/delta bus/loopback ✓ (локально).

ME2 (v0.22.0, 19/19 WORKS): полная локальная шина 47 действий + эффекты ME19 (порт эпистемологии) + Outcome River + CP-W1 + sense/obsv (впереди легаси: сетевых/консольных сенсоров у легаси нет) + OTel/codegraph/RH-verdicts/sandbox (у легаси нет). Слабее легаси: нет DB-lease-плоскости (нет облака у шины — по дизайну), objectives/work_graph (P2.7), self-update e2e (P3.8).

**Вердикт:** по механикам ME2 закрыл главный разрыв (эпистемология, reliability, liveness). Новый разрыв — не механики, а **интеграционная поверхность**: легаси был замкнут на себя + Supabase; индустрия 2026 (VS Code/Codex/Claude) стандартизовала MCP. Это главный урок раунда → Трек A роадмапа.

---

## 4. КРИТИЧЕСКИЙ АНАЛИЗ НАШИХ РЕСЁРЧЕЙ (research/2026/*, 11 артефактов)

### 4.1 Что подтверждено практикой (ресёрч → код → живая верификация)
| Ресёрч | Заявка | Статус |
|---|---|---|
| R19-OLD-MECHANICS-ANALYSIS | M1–M18 → ME-порт | ✅ ME1–ME19, 19/19 |
| R20-BROWSER-LEAP S1 | tree-first перцепция с verify | ✅ ME17 (живая) |
| R20-BROWSER-LEAP S2 | network/console сенсоры = паритет DevTools MCP | ✅ ME18 (ловит даже собственный скринкаст) |
| R22-AUDIT P1.1/P1.3, P2.4/P2.6 | эпистемология, Outcome River, CP-W1, identity | ✅ ME19/ME6/ME3/ME18 (R23) |
| R18-reward-hacking | tier-1 эвристики | ✅ ME15 + живой позитив |
| R20-s1..s6 (browser-use 89.1%, self-healing gen-3, DevTools MCP) | валидация tree-first + verify | ✅ выбор подтверждён; S3/S4 — отложены |

### 4.2 Критика — системные слабости процесса (честно)
1. **Разрыв «ресёрч → измерение»**: заявки снипетного уровня (например «10x разница токенов между браузерными инструментами», «−60..80% правок селекторов») не воспроизводятся на НАШИХ метриках — нет регресс-датасета (S3 висит с R20) и нет eval-харнесса. Ресёрч убеждает, но не измеряется.
2. **Дрейф роадмапа**: директивы оператора опережают роадмап (S3/S4 из R20 дожили до R24 без исполнения); новый роадмап (§7) требует явного трекинга статусов и «закрытия или переоценки»每 раунд.
3. **Дублирование ландшафта**: R20 и R24 обе описывают browser-MCP-поле — нужен живой индекс (research/2026/INDEX.md) вместо накопления точечных файлов.
4. **Снипеты вместо первоисточников**: ключевые сравнения (Codex 85% vs Copilot 56% SWE-bench; Claude Code 3–4x токенов) взяты из обзоров, не из праймари-бенчмарков — использовать как ориентир, не как истину.
5. **Нет метрик производительности у самого ME2**: ни p95 REST, ни латентности sense-act, ни бюджета памяти obsv — «оптимизация» (запрошена оператором) невозможна без базовых линий → Трек B3.

---

## 5. VS CODE — АНАЛИЗ (по R24-vs1 све + синтез)

1. **Multi-agent как платформа**: VS Code 2026 запускает Claude, Codex и Copilot **рядом** — локальные и облачные агенты в одном харнессе. Урок: ME2 fleet должен быть харнессом для ЛЮБЫХ моделей/агентов, а не только своих воркеров.
2. **Agent mode GA + MCP как расширение возможностей**: агент = план→действие→итерация до цели; инструменты подключаются MCP-серверами (GA в VS Code/JetBrains/Eclipse/Xcode).
3. **Для ME2**: наш daemon — фактически «extension host» для агентов; expose через MCP (Трек A) делает sense/act/obsv/fleet доступными из VS Code/Codex/Claude — стратегический рычаг №1.

## 6. CODEX — АНАЛИЗ (по R24-vs2/v3 свам + синтез)

1. **Harness-словарь OpenAI (Sandbox Agents)**: «harness = control plane around the model: **agent loop, model calls, tool routing, handoffs, approvals, tracing, recovery, run state**». ME2 daemon имеет всё, кроме **handoffs** (передача задачи агентом агенту) и **таблицы approval-политик** (гейты существуют точечно: RSI-adopt, fence-clear).
2. **Auto-review**: ручной аппрув на границе sandbox заменён reviewer-агентом — у ME2 есть RH-verdicts tier-1, но нет второй пары глаз (reviewer-агент перед COMPLETED) → Трек C3.
3. **Sandbox**: Windows = SIDs/ACLs/restricted tokens + отдельные sandbox-аккаунты; ME11 (prlimit+worktree) — Linux-паритет; для Tauri-Windows нужен свой профиль (документировать).
4. **Токен-экономика**: Claude Code ~3–4x токенов Codex; browser-инструменты различаются 10x+ — tree-first (наш выбор) — экономный путь; но НЕТ своих измерений → B3.

---

## 7. РОАДМАП: УЛУЧШЕНИЯ / МОДЕРНИЗАЦИЯ / ОПТИМИЗАЦИЯ (R25+)

### Трек A — Стратегия: ME2 как часть экосистемы MCP (модернизация)
- **A1 (P1) ME2 = MCP-сервер**: stdio+HTTP, инструменты: browser_sense / browser_act / browser_obsv / fleet_list / memory_search / task_enqueue. Эффект: любой агент VS Code/Codex/Claude получает наш браузерный план. Верификация: подключение из стандартного MCP-клиента, эхо-тесты.
- **A2 (P2) ME2 = MCP-клиент**: воркеры получают MCP-инструменты (конфиг-список серверов) → расширение TOOLS без изменения ядра.

### Трек B — Замкнутый контур качества (исправление слабостей §4)
- **B1 (P1) Регресс-датасет браузера** (закрывает S3/R20): запись sense-act сессий (цель→действие→вердикт→ревизии) в SQLite; replay+diff по той же цели. 
- **B2 (P2) Eval-харнесс**: фикстурные задачи для ME15 (RH) и ME19 (эффекты) — прогон на каждый релиз daemon.
- **B3 (P1) Базовые линии производительности**: p95 REST :3041, латентность sense-act, память obsv, boot-time; пороги в /mechanics evidence (например REST p95 <50ms, act p95 <2s, obsv <50MB).

### Трек C — Механики (улучшения)
- **C1 (P2) Objectives→tasks→work_graph** (P2.7 из R22): таблица objectives, TASK_ENQUEUE objective_id, проекция /workgraph + MC-панель.
- **C2 (P2) Handoffs**: передача задачи между агентами с протоколом (порт семантики Codex handoffs; сквозь шину — новое действие вне 47/47 не идёт: handoff = MEMORY-запись + TASK_ENQUEUE с parent).
- **C3 (P2) Reviewer-agent auto-review**: дешёвая модель перепроверяет результат против спеки до COMPLETED (второй контур после RH-verdicts).
- **C4 (P3) Approval-policy таблица**: operator-configurable гейты (fence-clear, RSI-adopt, authority-эффекты) в одном месте.

### Трек D — Оптимизация
- **D1 (P2) Sense diffing**: между ревизиями возвращать только изменённые цели (сейчас полный список ≤250) — экономия токенов агентам.
- **D2 (P2) Obsv выгрузка в SQLite (TTL)**: кольцевые буферы → персист последних N с TTL — долгоживущие сессии без роста памяти.
- **D3 (P3) Screencast тюнинг**: адаптивный q/fps по /stats, per-client дефолты.
- **D4 (P3) БД гигиена**: WAL checkpoint расписание, VACUUM-окно, индексы по горячим запросам.

### Исполнительный ритм
Каждый cron-раунд (15 мин) берёт ОДИН пункт сверху вниз с верификацией; статусы трекаются в этом документе (колонка статуса обновляется в worklog). Приоритет всегда: B3 → A1 → B1 → C-линия.

---

## 8. Артефакты раунда
- research/2026/R24-vs{1..4}*.json — web-сва (VS Code, Codex, сравнения, browser-MCP)
- .github/workflows/tauri-build.yml — фикс ③ (pubkey overlay через --config)
- Этот документ.
