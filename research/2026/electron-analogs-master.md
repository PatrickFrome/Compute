# Мастер-ресёрч: лучшие аналоги на Electron и их маппинг на ME2 (агрегатор R49–R59)

Раунд: R59 (2026-09-23) · Статус: КОНСОЛИДАЦИЯ. web_search 429 (9-я сессия) — собрано из
живых проб R52–R59 и базы знаний. Источники-серии: research/2026/r49…r59-analogues.md,
s1…s23 (shells, tauri, cdp, codex, orchestration), docs/electron-rebuild-plan.md.
Мандат (высший, R55): «больше не разрабатывать Electron и me2 отдельно — объединить все
механики в одну наилучшую систему и собрать полноценную Electron-версию MetaEngine».

## 1. VS Code — эталон архитектуры единой системы

**Процессная модель.** main (Node) → renderer (Chromium, workbench) → extension host
(отдельный процесс, безопасное API) → utility processes (pty, search, file watcher).
Урок ME2: наши процессы daemon (:3040/:3041) + ui-host + браузер-плоскость — тот же узор:
«толстый» main-процесс владеет состоянием, рендерер только видит API. Extension host =
канон «недоверенный код в песочнице» — прямой аналог наших skills/policy-гейтов.

**Workbench services (DI).** InstantiationService: сервисы объявляются декларативно,
лениво инстантируются, зависимости — по интерфейсу. Урок: наш /ui (self-contained,
0 сборки) сознательно проще, но контракт capabilitiesJson() = тот же «список сервисов»;
следующий шаг — ленивые панели (панель зеркала уже грузится отдельно от флота).

**Storage.** state.vscdb — SQLite (ключ-значение, globalState/scope). Урок: наш выбор
SQLite (store.ts) + meta-таблица курсоров зеркала = канон VS Code; никаких JSON-файлов
на 10k записей.

**Self-update.** Windows: NSIS in-place с сохранением user-data; macOS: Squirrel;
проверка манифеста + атомарная замена + откат. Урок: наш self-update E2E (R52, зелёный
CI) повторяет модель «манифест → загрузка → атомарная активация → health-probe → откат»;
версия-матрица K8 = их compat-подход (обязательный минимум клиента).

**Безопасность.** contextIsolation:true, sandbox:true, preload-мост с белым списком IPC,
keytar/safeStorage для секретов. Урок: secrets НИКОГДА в рендерере — наш принцип
«ключ не покидает daemon» (service_proxy R54) и vault-в-БД (R47) — то же самое слово в
словах VS Code «renderer knows identifiers, main knows secrets».

**Производительность.** activation events (расширения грузятся по событию), lazy renderers,
виртуализация списков. Урок: наши панели грузят ленты порциями (limit≤200), поллинг с
анти-штормом — канон совпадает.

**Remote development.** «UI-клиент + серверная часть на другой машине» — протокол
синхронизации состояния. Урок: ME2 уже так живёт (daemon в песочнице, панели где угодно
через gate :81); формализация «remote-профиля» в установщике — кандидат R59+.

## 2. Cursor — дисциплина форка и AI-обвязка

- **Форк VS Code по milestone-срезам**: ребаза на апстрим-релизы, свой код — изолирован
  в расширениях/модификациях ядра минимум. Урок: наш смарт-мерж (R40, PR #948/#953/#954)
  = та же дисциплина: sandbox-ветка → release → CI-гейты с первого прогона.
- **AI через backend-прокси**: ключи и тяжёлые вызовы — на сервере, клиент получает
  стримы диффов. Урок: gotrue-канал R57 (пароль/секрет в daemon, в UI — только
  короткоживущий JWT) = точно их модель.
- **Apply-model для диффов**: отдельная лёгкая модель «применяет» патч над файлом с
  валидацией. Урок: наш report_outcome + evidence-chain = тот же принцип «изменение
  без доказательства не существует».
- **Device-flow auth** для CLI/IDE: вход без вставки секретов в клиент. Кандидат для
  операторского входа в me2-панели (сейчас — только daemon-каналы).

## 3. Прочие лучшие аналоги — что берём

| Продукт | Канонический приём | Маппинг ME2 |
|---|---|---|
| Slack | мультиокно + профили per-window | FLEET-вкладки браузера → будущие окна Electron shell |
| Discord | GPU-композитинг, IPC-бюджет | screencast-панель (R15) — стрим без блокировки REST |
| Notion | локальный кэш + серверная истина + офлайн-чтение | SQLite-истина + зеркало Supabase (D-фаза) — читаемое из UI |
| Obsidian | local-first, плагинная экономика, SQLite | skills-каталог daemon'а + policy.json — расширяемость без перекомпиляции |
| Linear | перф-одер: виртуализация, optimistic UI | река событий /ui: порции + prepend, без перерисовки всего |
| 1Password | секреты: zero-knowledge, короткоживущие расшарки | vault R47 + ui-token TTL 120с + gotrue TTL 1ч |
| Zotero/Thunderbird | владение данными, экспорт-канон | hash-chain + SQL-зеркало = данные принадлежат оператору |

## 4. Что уже совпадает с каноном (инвентарь R58)

1. Единая система: daemon = main-process; панели = renderer; ui-host = supervisor. ✔
2. Self-contained /ui (0 сборки, 0 внешних зависимостей) — «workbench в одном файле». ✔
3. Контракт-хендшейк (R49) как LSP initialize / MCP handshake. ✔
4. Self-update E2E + версионная матрица + смарт-мерж CI-гейты. ✔ (PR #953/#954)
5. Секреты: main-side only, публичные идентификаторы в UI. ✔ (R54/R57)
6. RLS-гейт как демонстрация (anon отказ + authenticated чтение + service запись). ✔
7. «Политики как данные» — самоаудит каталога (R58, этот раунд). ✔ (за пределами аналогов)
8. Шина 47 действий с non-bypass инвариантом — строже, чем у аналогов (у VS Code API
   версионируется, но bypass-аудита нет). ✔✔ (наше превосходство)
9. «Аудит как цикл» — периодический level-аудит + переходные события (K8s/AWS Config
   узор; у аналогов-приложений этого нет). ✔ (R59: RLS + сверка реестра 243, хеш 337ccab1d17f)
10. Изоляция расширений строже канона: prlimit (--as=1GiB --nofile=256 --core=0) +
   env-белый-список + caps-медиация (у VS Code exthost наследует env целиком и без rlimit;
   расширение видит только stdio — сети нет по построению). ✔ (R60: src/exthost.ts)
11. Durable rollback правок строже checkpoint'ов Cursor: бэкап исходника в SQLite-журнале
   (агент не может подменить бэкап-файл на диске), восстановление байт-в-байт, события
   EDIT_APPLIED/EDIT_ROLLBACK в hash-chain; у Cursor checkpoints — локальные файлы
   «stored locally, separate from Git». ✔ (R62: src/edit.ts)
12. Allowlist терминала по СЕГМЕНТАМ конвейера (split | ; && || \n — каждый бинарь против
   белого списка) строже канона Cursor Run-Mode (allowlist на уровне команды): «echo hi &&
   curl evil» отсекается вторым сегментом; подстановки $()/env= — явный отказ. ✔
   (R62: src/exec.ts — сверка research/2026/r62-analogues.md)

## 5. Пробелы против канона (честно) → дорожная карта

| Пробел | Аналог-референс | Кандидат-раунд |
|---|---|---|
| ~~Периодический RLS-аудит из daemon-цикла~~ | AWS Config rules | ✔ R59 (src/self-audit.ts) |
| ~~Сверка реестра RPC 243 против облака (count+хеш)~~ | Terraform drift | ✔ R59 (rpc-reconcile) |
| ~~Workbench-лэйаут панелей (сворачивание/скрытие)~~ | VS Code workbench | ✔ R60 (тогглы+dblclick+персист localStorage; SQLite-персист R61+) |
| ~~Extension-host аналог: изоляция skills в подпроцессе~~ | VS Code extension host | ✔ R60 (prlimit+stdio-only+caps-медиация; long-lived R61+) — сверка: research/2026/r60-analogues.md §2 |
| ~~Exec/edit инструменты агентного harness (TERMINAL_RUN+FILE_EDIT)~~ | Cursor terminal/edit-files/checkpoints | ✔ R62 (src/exec.ts+src/edit.ts; P0-a из R61-GAP-ANALYSIS; классификатор=P0-1, Landlock/egress=P0-2) — сверка: research/2026/r62-analogues.md |
| ~~Run Modes + классификатор пре-исполнения (тир-3)~~ | Cursor auto-review/run-modes | ✔ R63 (src/review.ts: эвристика 8 правил + LLM opt-in, ask-очередь; канон D02) — сверка: research/2026/r63-analogues.md |
| ~~OS-сандбокс (fs/syscall-конфайнмент + default-deny сеть)~~ | Cursor Sandbox (D08/D09/D11: Landlock+seccomp / Seatbelt / bwrap; sandbox.json; SSRF-блок) | ✔ R64 (src/sandbox2.ts + launcher: ns user+mount через util-linux (Landlock ≥5.13 — честный skip на 5.10) + seccomp-bpf 28-deny + net=deny; strict fail-closed; probe 4/4; вердикт «sandbox» классификатора реален) — сверка: research/2026/r64-analogues.md |
| Device-flow вход оператора в панели | Cursor/gh-cli | R61 |
| Remote-профиль установщика (daemon локально, UI где угодно) | VS Code Remote | R61+ |

## 6. Вывод раунда

Канон лучших Electron-приложений подтверждает архитектуру ME2: main-side secrets,
SQLite-истина, манифестный self-update, контрактный хендшейк, стриминговые ленты,
«аудит как цикл» (R59), workbench-лэйаут и exthost-изоляция (R60). Уникальные
преимущества ME2 против аналогов: hash-chain событий + SQL-зеркало с RLS-гейтом +
non-bypass шина + «политики как данные» + периодический самоаудит с переходными
событиями + изоляция расширений строже канона (п.10 инвентаря). Следующий прирост —
device-flow вход (R61) и long-lived exthost / SQLite-персист лэйаута (R61+); exec/edit
инструменты Cursor-parity закрыты R62 (P0-a, 15 P0 гэпов R61 → первый в коде),
классификатор R63 (P0-b), OS-сандбокс R64 (P0-2: userns+mountns+seccomp со строгим
fail-closed — Landlock честно skip на ядре 5.10); полный
разбор R60 — research/2026/r60-analogues.md, R62 — research/2026/r62-analogues.md,
R63 — research/2026/r63-analogues.md, R64 — research/2026/r64-analogues.md.
