# R52 — Ресёрч: упаковка served-UI в Electron-релизы (эталоны для C7) + продолжение аналогов

> Раунд R52 (фаза C7 + подготовка D8/H6). Задача: «делай глубокие ресёрчи и аудиты,
> собирай всё тщательно и аккуратно, проводи тесты, делай ресёрчи по лучшим аналогам».
> Метод: web_search снова 429 (пятая сессия подряд — не амплифицируем, честно зафиксировано).
> Материал — внутренний анализ документированных архитектур + живой аудит наших CI-конвейеров
> (release-ветка: me2-unified-gate.yml, browser-final-runtime-activation-v1.yml, electron-builder.test.json).
> Веб-верификация ссылок — при первом окне квоты (⏳).

## 1. Как эталоны упаковывают «тяжёлый UI» в Electron-релиз

| Система | Паттерн | Что берём |
|---|---|---|
| **VS Code** ⏳ | workbench (UI) собирается тем же конвейером, что и main-process; внутри ESB (build-система) единый граф сборки: UI не «отдельный релиз», а артефакт того же SHA | С7: UI-сборка = шаг того же release-конвейера, что и браузер (один SHA → один релиз) |
| **Cursor** ⏳ | минимальный дифф форка: собственные модули изолированы, сборка апстрима не ломается | наш `pack-me2-ui.mjs` — отдельный скрипт БЕЗ правок чужих build-файлов (кроме одной extraResources-строки) |
| **Slack** ⏳ | локальный webview-сервер отдаёт UI приложения; оболочка тонкая | уже реализовано: me2-ui-gateway (:8137) + ui-host; C7 добавляет упаковку каталога |
| **code-server / VS Code Server** ⏳ | UI раздаётся каталогом «как есть» (static files), версия каталога = версия релиза | `resources/me2-ui` = самодостаточный standalone-каталог с манифестом версии |
| **Chrome/Chromium** ⏳ | resources.pak версионируется вместе с бинарём; рассинхрон невозможен by design | manifest `me2-ui-manifest.json` внутри каталога: ui_version + git_sha + built_at |

## 2. Ключевые решения C7 (следствие ресёрча)

1. **Один SHA → один релиз.** UI-бандл собирается из того же коммита, что и установщик
   (шаг в browser-final-runtime-activation-v1.yml перед electron-builder). Никаких
   «последних артефактов из другого воркфлоу» — это источник рассинхрона (анти-паттерн).
2. **Standalone как формат бандла.** Next `output:"standalone"` даёт самодостаточный каталог
   (server.js + обрезанные node_modules + .next + public) — прямой аналог code-server'ного
   «каталог как релиз». Размер ≈ 60-90 МБ против ~200 МБ при полной установке deps.
3. **Контракт каталога = ожидание ui-host.** `resources/me2-ui/package.json` со скриптом
   `start` (ui-host R50 спавнит `bun run start`); health-probe `GET / → text/html`.
   pack-скрипт обязан переписать `start` на `bun server.js` (пути standalone сдвигаются).
4. **Fail-open против Fail-dead.** Отсутствие бандла НЕ ломает релиз (ui-host честно
   DEGRADED → фолбэк GET /ui, R50). before-pack предупреждает, не роняет.
5. **Гейт независимо перепроверяет.** me2-unified-gate.yml собирает и пакует UI на PR —
   required-check ловит поломку сборки ДО мерджа (тот же pack-скрипт, что и в релизе).

## 3. Продолжение аналогов (дополнение к r51)

- **Изоляция инстансов как gate-требование** (новое в R51, подтверждено R52): smoke-тесты
  VS Code запускают `code --user-data-dir` на чистый профиль — наш boot-probe на девственной
  SQLite это в точности повторяет (локально + CI). Держится.
- **Реестр внешних контрактов как данные** (новое, R52): у VS Code extension API —
  versioned manifest; у нас 243 legacy-RPC Supabase → таблица-реестр с tier'ами
  (ACTIVE/CONTROL_PLANE/FREEZE) вместо молчаливой деградации. Паттерн «deprecation
  как данные» (feature flags/deprecation registries) ⏳ — принят: `sql/0002-rpc-registry.sql`.
- **Осознанные НЕ-заимствования**: Squirrel.Windows (у нас verified self-update v8 + Guardian);
  electron-updater (двойной-updater анти-паттерн K6 закрыт в R50 DEPRECATED-маркером).

## 4. Проверка наших конвейеров (аудит R52)

- `me2-unified-gate.yml`: daemon-gate (boot-probe eval) + ui-gate (frozen install) — **успех** на release-голове b5860acb0.
- Производственный конфиг electron-builder: `electron-builder.test.json` (имя историческое, используется реальным конвейером) — extraResources: guardian-native, devos-source-snapshot, a2-compute-browser → добавить `me2-ui-dist → me2-ui`.
- `browser-final-runtime-activation-v1.yml`: сборка `npx electron-builder@26.15.7 --win nsis --x64 --config electron-builder.test.json` — шаг UI-сборки вставить ПЕРЕД ним.
- Вывод: C7 встраивается двумя маленькими точками (pack-скрипт + extraResources) + ui-build job в гейт — минимальный дифф (Cursor-дисциплина).
