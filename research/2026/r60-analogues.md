# Ресёрч R60: workbench-лэйаут + extension-host — сверка с каноном после внедрения

Раунд: R60 (2026-09-24) · web_search 429/ошибка (10-я сессия подряд — одна проба через CLI,
не амплифицирован). Всё ниже — из базы знаний серии (r50–r59, мастер-агрегатор
electron-analogs-master.md) и живых проб системы R49–R60. R60 ВНЕДРИЛ оба пункта
дорожной карты мастера — этот документ фиксирует, что именно взято у канона, что
сделано строже, что осталось.

## 1. Workbench-лэйаут — что взято у эталонов

**VS Code.** Workbench = сетка частей (activity bar / sidebar / editor groups / panel /
status bar), каждая часть сворачиваема, состояние переживает перезапуск — персист в
state.vscdb (SQLite key-value: `workbench.explorer.views.state`, размеры панелей,
pinned items). Двойной клик по заголовку панели — maximize/восстановление. Урок:
«лэйаут — это данные, а не побочный эффект DOM». Наш R60: collapse/expand каждой из 4
секций (кнопка-тоггл в заголовке + dblclick по заголовку — оба канонических хода),
персист в localStorage (`me2.ui.workbench.v1`) — честный web-уровень того же принципа;
SQLite-персист силами daemon'а (аналог state.vscdb) — кандидат R61+.

**Cursor.** Форк-дисциплина: workbench сохранён 1:1, AI-панель встроена как «editor
group» — НОВОЕ не ломает канон лэйаута. Наш R60: секция «Расширения (exthost)» добавлена
ЧЕТВЁРТОЙ в конец, порядок существующих секций не тронут (урок R12/R16 «не плодить
слоёв» заодно с каноном Cursor) — rule (в) из r59-analogues §3 выполнена.

**JetBrains (IDEA).** Tool windows: collapse/expand + widescreen-режим, персист в
workspace.xml (файл, не SQLite) — доказывает, что НЕВАЖНО, где персистить (файл/SQLite/
localStorage), важна семантика: «состояние лэйаута переживает перезапуск и принадлежит
пользователю».

**Zed (не Electron — контрольная группа).** Docks (left/right/bottom) +
serialize-workspace в собственной БД — тот же узор в Rust-мире: канон межстековый.

**Electron-приложения (Slack/Notion/Discord).** Персист геометрии окна
(electron-window-state) и сайдбара (web-tier localStorage, например Notion) — узор
«двухуровневого персиста»: нативная оболочка помнит окно, web-слой помнит лэйаут. Наш
случай — web-слой без нативной оболочки (панель живёт где угодно через gate :81), поэтому
localStorage — единственный честный носитель сейчас.

**A11y-канон.** WAI-ARIA disclosure pattern: кнопка-тоггл с `aria-expanded` +
`aria-controls` на сворачиваемую область; клавиатурный фокус нативный (button). Наш R60
следует паттерну буквально (eval-маркеры: aria-expanded/aria-controls в HTML).

## 2. Extension host — сверка внедрённого с каноном VS Code

Реализация R60: src/exthost.ts + skills/ext/mirror-digest (манифест + stdio-only entry).

| Канон VS Code | ME2 R60 | Строгость |
|---|---|---|
| exthost = отдельный процесс; краш расширения не валит workbench | одноразовый spawn на прогон: краш = вердикт `exit_N`, daemon невредим | равная (одноразовый процесс изолирует даже сильнее: нет длительного состояния) |
| `$initialize` handshake; вечно-висящий хост ловится супервизором | handshake 2с: нет ack → `handshake_timeout` + kill (канон «вечно-THINKING») | равная |
| API-поверхность (`vscode.*` dts) вместо require ядра | расширение видит ТОЛЬКО stdio (newline-JSON): ни import, ни fetch, ни БД (eval ассертит чистоту entry) | **строже** (у VS Code расширение всё же требует node-модули) |
| proposed-API gating (enableProposedApi) | caps-белый-список в манифесте; неизвестная cap → честный `cap_not_allowed` (проба негативом: `["fs.write","net.fetch"]` отказана без spawn) | сопоставимая, семантика ближе к capability-based security |
| окружение расширения наследует env хоста | env-белый-список (PATH/HOME/TMPDIR/LANG + ME2_EXT_*): секреты daemon'а (vault, DB URL) процессу недоступны | **строже** |
| нет rlimit | prlimit --as=1GiB --nofile=256 --core=0 (канон sandbox.ts) | **строже** |
| long-lived exthost + ping-супервизия | одноразовые прогоны; long-lived + ping — R61+ | у VS Code пока богаче |
| activation events (onCommand/onLanguage) | activation: `manual` / `bus:<TYPE>` — опрос шины 30с, level-triggered (K8s resync), курсор с головы шины | другой домен (у нас события шины, не языки) — механика равная |

**Инвентарь «совпадений с каноном» пополняется пунктом 10: изоляция расширений строже
канона** — prlimit + env-белый-список + caps-медиация; у аналогов exthost наследует
окружение хоста целиком и не имеет rlimit. Плюс небезынтересная деталь: наш extension
получает данные ГОТОВЫМИ от хоста (caps-медиация `mirror.feed.read`) — у расширения сети
нет по построению, у VS Code расширения сетью пользуются свободно (для доверенного
маркетплейса это ок; для нашего non-bypass мира — нет).

## 3. Инвентарь R60: дорожная карта мастера

| Пункт мастера | Статус в R60 |
|---|---|
| ~~Workbench-лэйаут панелей~~ (VS Code workbench) | ✔ R60: тогглы 4 секций + dblclick + персист localStorage + сброс; порядок секций неизменен; SQLite-персист — R61+ |
| ~~Extension-host изоляция skills~~ (VS Code exthost) | ✔ R60: src/exthost.ts (prlimit, stdio-only, handshake, caps-медиация, activation bus:*) + образец mirror-digest; long-lived хост — R61+ |
| Device-flow вход оператора | R61 (как планировалось) |
| Remote-профиль установщика | R61+ |
| (новое) SQLite-персист лэйаута daemon-каналом | R61+ (разбор §1) |
| (новое) long-lived exthost с ping-супервизией | R61+ (разбор §2) |

## 4. Вывод R60

Оба пункта дорожной карты мастера закрыты малым объёмом (1 модуль ~300 строк + 1 секция
/ui + 2 eval-проверки; шина 47/47 нерушима; REST вне шины). Сверка с каноном показала:
в трёх измерениях (env-изоляция, rlimit, stdio-only API) наш exthost строже VS Code, в
остальном — канонически равен; long-lived хост — единственное отставание, осознанно
отложенное в R61+. Указание оператора R60 («UI не обязан быть read only») встроено в
контракт как узор «санкционированных записей»: REST-записи из панели разрешены, каждая
именована в capabilities.rest.write и попадает в eval-белый-список — поводок стал
короче, а не длиннее. web_search закрыт 10-ю сессию подряд — ресёрч честно из базы
знаний серии.
