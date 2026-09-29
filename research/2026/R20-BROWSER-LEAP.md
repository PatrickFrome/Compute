# R20 — Браузер ME2: анализ, ресёрч лучших систем 2026, шаги качественного скачка

Дата: 2026-09-22 · Источники: код daemon v0.19.0 (commands.ts BROWSER-группа, screencast.ts :3043),
легаси `src/lib/browser-tools.ts` (git-история, read-only), 6 веб-ресёрчей (R20-s1…s6).

## 0. Анализ текущего браузерного слоя ME2

**Что есть:**
- **Actuation** (шина 47/47): 16 действий BROWSER_* — все через CLI-обёртку agent-browser
  (`/usr/local/bin/agent-browser`, таймаут 20с): TABS/OPEN/SNAPSHOT/SCREENSHOT/CLOSE/NAVIGATE/
  BACK/FORWARD/RELOAD/CLICK/TYPE/PRESS/SCROLL/SELECT_TAB/URL/TITLE. Каждый вызов = spawn процесса.
- **Визуальный канал**: me2-screencast :3043 — собственный CDP-сервер, сам находит QA-браузер
  (порт 37165), отдаёт jpeg-кадры с per-client q/w (каденс 2.5с, клиентский поллинг).
- **Ветви браузера**: живые вкладки agent-browser в ВЕТКИ-панели MC (клики по вкладкам → SELECT_TAB).

**Чего нет (гэпы против лучших систем 2026):**
- G1: snapshot'ы (@eN-refs) **транзиторны** — не сохраняются, каждый потребитель парсит сам;
  нет реестра семантических целей.
- G2: **нет сетевого/консольного восприятия** — screencast только визуальный; агент не видит
  network requests / console errors (главный сенсор Chrome DevTools MCP).
- G3: **нет verify-after-act** — события шины фиксируют факт вызова, но не пост-условие.
- G4: нет **семантической адресации** — у легаси A2 была (`semantic_targets[]` с role/name/
  semantic_ref/backend_node_id/value_sha256 + state_revision_id, «no pixel geometry anywhere»).
- G5: нет **регрессионного датасета** браузерных задач (trace→replay→score).

## 1. Ресёрч: лучшие системы 2026 (6 свипов → research/2026/R20-s*.json)

| Система | Ключевой приём | Вердикт для ME2 |
|---|---|---|
| **Browser Use** (89.1% WebVoyager, лидер open-source) | accessibility-tree как единственный интерфейс агента | у нас уже aria-snapshot — надо ПЕРСИСТ into реестр |
| **Stagehand** | код-овнед авто-пилот: playwright-примитивы + LLM поверх | паттерн «thin LLM над примитивами шины» |
| **Skyvern** (85.85%, формы) | vision+LLM на скриншотах для форм | у нас есть :3043 кадры — vision-контур |
| **Chrome DevTools MCP** (официальный) | network requests, console с source-mapped стеками, performance traces | **главный гэп**: добавить Network/Runtime-сенсоры к CDP-сессии :3043 |
| **Playwright MCP** | a11y-tree snapshot как protocol, локальная предсказуемость | подтверждает наш snapshot-подход |
| **Claude Computer Use / Operator** (72.5% OSWorld / 87% WebVoyager) | пиксель+действие, универсальность | не наш путь (мы tree-first) |
| **Self-healing gen-3** (Keysight/QAskills) | semantic+contextual+visual matching, role-locators с фолбэками, −60..80% правок селекторов | порт легаси semantic_ref = gen-3-lite |
| **Braintrust evals** | trace→score→регрессионный датасет прод-падений | у нас уже OTel-спаны+вердикты — не хватает браузерных трейсов |

**Синтез**: консенсус 2026 — **accessibility-tree-first + сенсоры отладки (network/console) +
verify-после-действия + регрессионные датасеты**. Легаси A2 уже владел самым передовым паттерном
(CAPTURE→act→verify с state_revision_id) — он опередил время и не дожил до MCP-эпохи.

## 2. Конкретные шаги качественного скачка (приоритезация)

**S1. BROWSER_SENSE — персистентная семантическая перцепция** (порт легаси browser-tools, gen-3-lite)
- Парс aria-snapshot'а agent-browser → `semantic_targets[]` {ref, role, name}; SQLite-таблица
  `browser_sense` (tab, url, targets_json, revision=sha256(snapshot), captured_at).
- REST (вне шины, 47/47 инвариант): GET /browser/sense?refresh=1, POST /browser/sense/act
  {key|ref, action:click|type|press, text?} — резолв key→ref→действие + **авто-verify** (re-sense:
  цель жива? ревизия сменилась?) → span + событие BROWSER_SENSED/BROWSER_SENSE_ACTED.
- old_ref в ME-матрице: ME17 «Semantic addressing» ← browser-tools.ts semantic_targets.
- Эффект: агент ссылается на СМЫСЛ («кнопка Отправить»), а не на хрупкий текст/CSS; verify
  ловит сдвиги DOM (self-healing сигнал).

**S2. Отладочные сенсоры к CDP-сессии :3043** (паритет Chrome DevTools MCP, lite)
- На уже открытой CDP-цели включить Network.enable + Runtime.enable: кольцевой буфер
  (последние 200 request'ов: url/status/mime/мс; последние 100 console: level/text/source).
- REST: GET /browser/net, GET /browser/console. Эффект: агент «видит» 4xx/5xx/CORS/JS-ошибки
  — то, чего нет ни у одного tree-only фреймворка из коробки.

**S3. VERIFY-макродействие и регрессионный датасет**
- BROWSER_ACT_VERIFY как композит (act→sense→diff→verdict) — станет шаблоном для worker'а.
- Трейсы браузерных задач (уже в event-log) → экспорт replay-датасета + скоринг (пара к
  вердиктам RH) — паттерн Braintrust.

**S4. Vision-контур на кадрах :3043** (Skyvern-стиль)
- Для форм/канвасов, где a11y-tree слеп: кадр :3043 → VLM → координаты/подтверждение — как
  резервный сенсор поверх S1 (не замена: tree-first остаётся главным).

**Порядок**: S1 (этот раунд) → S2 → S3 → S4. S1+S2 дают скачок «агент видит страницу и её
здоровье» без единого нового bus-действия (REST-плоскость).

## 3. Что принято/отклонено из ресёрча и почему

- Пиксельное управление (Computer Use) — отклонено как основной канал: tree-first надёжнее и
  дешевле; пиксель — только S4-резерв.
- Облачные браузеры (Browserbase/Cloudflare Browser Run) — вне песочницы, но интерфейс
  провайдера Sandbox-плоскости уже допускает второй provider.
- DOMShell (a11y-tree как ФС: ls/cd) — изящно, но несовместимо с существующим snapshot-форматом;
  взят только принцип «структура как навигация».
