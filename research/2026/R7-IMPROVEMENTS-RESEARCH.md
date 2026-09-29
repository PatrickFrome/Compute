# R7 · Ресёрч улучшений ME2 OS (2026-09-22)

Контекст: daemon v0.7.0 (реестр 47/47 полон), Mission Control v4, ветки браузера замкнуты в контур
(вкладки/навигация/актuation через шину + WS-стрим). Ресёрч — по прямому указанию оператора
«делай ресёрчи по улучшениям». Метод: web-search (4 направления) + анализ встроенных возможностей
agent-browser. Внедрённое из ресёрча в этом же раунде: **СКРИНКАСТ-панель** (см. ниже).

## 1. Источники (web-search, топ-находки)

| Тема | Источник | Вывод для ME2 |
|---|---|---|
| Tauri sidecar | v2.tauri.app «Embedding External Binaries» (июн 2026) | bun-бинарь daemon → `bundle.externalBin` в tauri.conf.json; рабочая директория sidecar ≠ ресурсов — резолвить через `resourceDir()` (грабли подтверждены issues) |
| Tauri sidecar | github.com/tauri-apps issues (мар 2026) | для многофайловых бинарей — отдельная папка ресурсов; bun single-file ок |
| CDP screencast | chromedevtools.github.io; kenneth.io (BrowserRemote) | Page.startScreencast = live-preview; НО agent-browser уже даёт стрим выше уровнем — CDP напрямую не нужен до M3-Rust |
| Agent-паттерны 2026 | learn.microsoft.com (Azure Architecture Center, фев 2026); dataaspirant (авг 2026) | 8 паттернов: chaining, routing, parallelization, **orchestrator-workers**, **reflection**, tool-loop; ME2 уже = orchestrator-workers (master loop + workers) |
| Мульти-агент EDA | confluent.io «Four Design Patterns for Event-Driven Multi-Agent Systems» | event-driven уже в ядре ME2 (hash-chain events); добавить **saga/compensation** для многошаговых задач |
| Production-паттерны | digitalapplied.com (май 2026): fan-out, pipeline, debate, supervisor, swarm | ME2 ближе к supervisor; «debate» — кандидат для RESEARCHER-ролей (дуэль-механика из наследия A2) |
| **Стриминг браузера** | **github.com/vercel-labs/agent-browser**: «Stream the browser viewport via WebSocket for live preview / pair browsing» | **ВНЕДРЕНО в R7** — см. §2 |
| Observability | docs.browser-use.com | poll лёгкого status-эндпоинта вместо скачивания всех событий — у ME2 уже так (/events since=, WS push) |
| Транспорт | rxdb.io (июл 2026): WS vs SSE vs long-poll | WS оправдан для кадров; служебные события — тоже WS (уже есть :3040) |

## 2. Внедрено в R7: СКРИНКАСТ-панель (live view вкладок)

**Находка**: agent-browser имеет встроенный runtime-стриминг (`stream enable`), который мы до сих пор
не использовали: WS-сервер с кадрами `frame` (base64 JPEG + metadata.timestamp), событиями `url`/
`tabs`/`status`/`console` и **обратным вводом** (input_mouse/keyboard/touch — pair browsing).

**Реализация**:
- Порт запинен на **:3042** (`stream disable` → `stream enable --port 3042`); автопин при каждом
  старте daemon (start.sh §4.5, идемпотентно).
- Консоль: toggle «live» в БРАУЗЕР-стрипе → `new WebSocket("ws://<host>/?XTransformPort=3042&maxFps=8")`
  (gateway-правило XTransformPort соблюдено; origin localhost — в allowlist стрима).
- Кадры → `img.src = data:image/jpeg;base64,...`; caption-бар: URL активной вкладки + ● fps + возраст кадра;
  offline-состояние честно показывается.
- **Вне бюджета шины** — стрим не ест cost 24/60s, не пишет события в hash-chain (иначе mirror-спам).

**Проверено живьём**: кадры идут (118KB JPEG), fps-счётчик работает, открытие вкладки через шину
(BROWSER_OPEN example.com) — стрип обновился, стрим пережил переключение активной вкладки.

**Параметры bandwidth** (из доков стрима, на будущее): `AGENT_BROWSER_STREAM_QUALITY` (80 → ~54KB/кадр
@720p; 20 → 25KB), `AGENT_BROWSER_STREAM_MAX_WIDTH/HEIGHT`; `pacing=ack` + `maxFps` для слабых каналов.

## 3. Отсортированный бэклог улучшений (приоритет ↓)

1. **Pair-browsing из консоли** (низко висит): прокинуть `input_mouse/input_keyboard` в стрим —
   оператор кликает в скринкасте, ввод летит в активную вкладку. Каст: confirm-плашка «remote control».
2. **Console-лента вкладки в EVENT-LOG**: стрим шлёт `console`-события — добавить вкладку «браузер-консоль»
   в EVENT-LOG фильтры (лента живая, не в audit — по доке).
3. **Saga/compensation для задач** (Confluent EDA): TASK_RETRY уже есть; добавить компенсирующие шаги
   в spec-контракт (`on_fail: [...`) — агент-воркер исполняет компенсации при FAILED.
4. **Reflection-паттерн** (Azure/dataaspirant): после FAILED — RESEARCHER-агент получает spec+error+
   последние STEP_* события и предлагает патч spec;TASK_RETRY с патчем. У нас всё для этого есть:
   EVENTS_SEARCH + WORKSPACE_WRITE.
5. **M3 Tauri 2**: `externalBin` = bun-бинарь daemon (bun build --compile); sidecar-грабли: рабочая
   директория; WebView = только консоль (dist-билд Next); Chromium отдельно (уже так).
6. **Bandwidth-профили скринкаста**: селектор качества (q20/640×360 для мобильного оператора).
7. **GC воркеров агрессивнее** (OFFLINE-зомби, из R3): reap по heartbeat > 90s уже есть; добавить
   авто-WORKER_REAP в master loop раз в 5 мин.
8. **Debate-дуэли для RESEARCHER** (наследие A2-протокола): две RESEARCHER-задачи на один вопрос +
   оператор-сейл. Отложить до M5.

## 4. Анти-находки (что НЕ делать)

- **CDP напрямую сейчас** — дублирует agent-browser стрим/ввод; вернуться только в M3-Rust (chromiumoxide).
- **Кадры через шину команд** — mirror-спам в event-log и budget; стрим отдельным каналом — верно.
- **`bun run build` в sandbox** — по-прежнему не запускать (dev-only контур).

## 5. R8: протокол pair-browsing ВЕРИФИЦИРОВАН живьём (база для pair-control)

Метод: детерминированная проба — страница-мишень с полноширинной кнопкой (fixed bottom 200px) и
input с автофокусом; bun-скрипт коннектится к ws://127.0.0.1:3042 и шлёт input-события по доке
(skill-data/core/references/streaming.md); результат читается через `agent-browser get title`.

| Событие (client→server) | Результат пробы |
|---|---|
| `{"type":"input_mouse","eventType":"mousePressed"\|"mouseReleased",x,y,button:"left",clickCount:1}` | ✅ клик отработал (title→CLICKED-OK) |
| `{"type":"input_keyboard","eventType":"keyDown",key:"m",text:"m"}` + `keyUp` | ✅ посимвольный ввод (title→TYPED:me2) |
| `{"type":"input_keyboard","eventType":"keyDown",key:"Enter",text:"\r"}` | ✅ (принят, страница без формы) |
| координатная база | `metadata.deviceWidth/Height` = viewport (1280×720), не размер jpeg |

**Console-лента** (server→client, только по http-страницам; file:// НЕ эмитит — caveat):
`{"type":"console","level":"log\|error\|warning","text":"<первый string-arg>","args":[{type,value\|preview}],"timestamp"}` —
текст покрывает только первый аргумент; объекты брать из `args[i].preview.properties` / `description`.
Дока честно предупреждает: console = live feed, НЕ audit log (ordered channel может терять события при лаге).

**CDP-семантика клавиатуры** (web-search, chromedevtools/Playwright-исходники): `keyDown` с `text`
вставляет символ (text и есть символ); спец-клавиши — keyDown/keyUp без text; модификаторы — битмаска
Alt=1, Ctrl=2, Meta=4, Shift=8. Browser-шорткаты с Ctrl/Meta из remote-ввода сознательно НЕ прокидывать.

**Эксплуатационная находка (start.sh)**: пин :3042 слетел после рестарта daemon — процесс живёт как
`bun --hot index.ts`, а kill-паттерн искал `bun index.ts`; и export AGENT_BROWSER_STREAM_PORT не
наследовался (export стоял после старта). Фикс: kill по cwd (рядом чужие сервисы) + export до старта.
Дубль-защита: даже при респавне agent-browser env-пин сам поднимет стрим на :3042.

**UX-решение pair-control** (реализовано в R8): режим «руль» — отдельная кнопка-arm (не по умолчанию!),
клик/клавиатура/колесо идут в стрим только в armed-состоянии; Ctrl/Meta-комбо пропускаются в браузер
оператора; координаты маппятся с учётом letterbox (object-contain): scale = min(rw/dw, rh/dh), offset —
центрирование; колесо — нативный listener passive:false (React onWheel пассивен, preventDefault не сработал бы).
