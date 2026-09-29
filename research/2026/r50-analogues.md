# R50 · Ресёрч: продакшн-паттерны Electron-оболочек (supervision, UI-hosting, update-авторитет)

Дата: 2026-09-23 · Раунд: R50 (фаза B) · Статус: внутренний анализ, применён в PR #951;
web-верификация источников повторно отложена (web_search 429 — третья сессия подряд,
прецедент R37/R38/R43/R49; retry при окне квоты).

## 1. Supervision / lifecycle — кто главный страж

### 1.1 VS Code: «логика вне UI-процесса» + один владелец рестартов
- Процессы: main (окна/lifecycle) → renderer (workbench, падение = одна вкладка,
  не приложение) → extension host (изолирован, рестарт без смерти редактора) →
  utility/pty/file-watcher. Ключевой принцип: **UI-процесс одноразовый, состояние —
  вне его** (disk/storage service в main + отдельные процессы).
- Применение у нас: чат-сессии/пул/evidence живут в daemon (SQLite), UI (панели v5)
  — одноразовый процесс, который можно убить без потери флота. R50 делает это
  явным: `me2-ui-host.mjs` — adopt/spawn/backoff, will-quit с killChild:false
  (UI и daemon переживают закрытие окна).

### 1.2 Chrome/Chromium: browser-process как PID-1 вкладок
- TabRegistry нашего браузера наследует ровно эту модель: реестр вкладок в
  главном процессе, WebContentsView — одноразовые; crash вкладки не роняет окно
  (browser-sentinel/keepalive — уже в браузере, R50 их не трогает).
- Урок для B-фазы: НЕ плодить вторых стражей — `supervisor-keepalive` (браузер)
  остаётся единственным стражем окна; `me2-ui-host`/`me2-daemon-host` — стражи
  ДОЧЕРНИХ сервисов, не окна. Зоны ответственности разделены и не пересекаются
  (единственная точка пересечения — will-quit координация, сделана деликатной).

### 1.3 Cursor: fork-дисциплина минимального диффа
- Cursor держит поверх fork'а тонкий AI-слой отдельными сервисами (composer/agent
  поверх workbench), минимизируя правки ядра — это упрощает ежерелизную синхронизацию
  с upstream. Наш аналог: вся me2-плоскость — каталог `src/me2/*` + аддитивные
  guarded-вызовы в `final-runtime-entry`/`main.mjs` (ME2_INTEGRATION=0 → прежнее
  поведение). R50 продолжает принцип: ноль правок механизмов браузера.

## 2. Встраивание веб-UI в оболочку через встроенный gateway

- Паттерн-аналоги: VS Code Server / code-server (UI доставляется локальным сервером,
  оболочка — окно поверх); Electron-приложения с локальным backend (Slack: local
  service + webview; Notion: локальный кэш-слой). Общее: **UI не собирается заново
  под оболочку, а served как есть локальным процессом** с прокси-контрактом.
- Наш выбор (R50): порт desktop-гейтвея (`XTransformPort http+ws`) в
  `me2-ui-gateway.mjs` — единый UI работает в браузере БЕЗ единой правки; при
  отсутствии UI-каталога Mission Control честно падает на самодостаточный `/ui`
  daemon'а. Это даёт THREE-layer UI-политику: env → live_gateway → daemon_fallback
  (ui_mode виден в каждой lifecycle-строке — honest telemetry).
- Верификационный урок раунда: тот же код под Node (рантайм Electron) — WS через
  gateway CONNECTED; под bun-рантаймом node:http upgrade даёт таймаут (пробел
  совместимости bun). Вывод: целевые пруфы me2-плоскости гоняем под Node — он и есть
  рантайм оболочки; bun остаётся рантаймом daemon'а (там node:http-upgrade не нужен).

## 3. Update-авторитет (закрытие K6)
- VS Code: один UpdateService на канал; Squirrel-стиль staged-обновлений; отсутствие
  «второго обновлятора» — инвариант.
- Наше соответствие: self-update-runtime-v8 + verified manifests + Guardian —
  единственный канал; `desktop/updater.ts` помечен DEPRECATED с записью причины
  и запрета подключения (код сохранён как источник механизмов).

## 4. Источники (к web-верификации при окне квоты)
- github.com/microsoft/vscode/wiki/Process-Architecture · code.visualstudio.com FAQ
- chromium.org/developers/design-documents/multi-process-architecture
- electronjs.org/docs/latest/tutorial/process-model · tutorial/updates
- Cursor docs (agents поверх fork'а) · code-server docs (served-UI паттерн)

## 5. Следствия для фазы C (R51+)
- C6 перенос пакетов: UI-каталог в пакете `apps/me2-ui` уже совместим с
  `resolveUiDir()` (resources/me2-ui) — упаковка через extraResources в
  electron-builder.yml без правок кода.
- C7 autorelease-gate: добавить в Fast Verified Dev Release шаг `npm run check`
  (уже покрывает все me2-модули) + eval-прогон daemon-пакета против smoke-профайла.
- K7 salt-детект ротаций Supabase-vs-vault — остаётся в D-фазе.
