# R21 — ELECTRON CLIENT: RESEARCH + SPEC (P0 Foundation)

Round: R21 · Task: P0 Foundation «Cursor Capability Parity» — клиент-оболочка
Date: 2026-09-24 · Discipline: §34 (announced ≠ available; no evidence → no claim)

---

## 1. Ключевой факт: Cursor — это Electron-приложение

Cursor построен как **форк VS Code** (Anysphere), а VS Code — Electron-приложение.
Значит цель паритета (Cursor) живёт на Electron-стеке, и директива оператора
«клиент на базе Electron» совпадает с архитектурой бенчмарка.

| Источник | Дата | Evidence | Confidence |
|---|---|---|---|
| daily.dev «Cursor vs VS Code vs Windsurf: 2026 Comparison» | Mar 26, 2026 | «Cursor, a specialized fork of VS Code, has gained traction for its AI-first design» | HIGH |
| devopstales.github.io «The Best AI Coding IDEs in 2026» | Mar 19, 2026 | «Cursor is a fork of VS Code… first to deeply integrate Composer» | HIGH |
| ayautomate.com «Windsurf vs Cursor vs Claude Code» | Jun 8, 2026 | «Cursor… is also a VS Code fork, built by Anysphere» | HIGH |
| visualstudiomagazine.com «What a Difference a VS Code Fork Makes» | Jan 26, 2026 | «Cursor, Windsurf, and Google Antigravity all start from the same foundation: a fork of VS Code» | HIGH |

Вывод: **все три лидирующих agentic IDE (Cursor, Windsurf, Antigravity) — VS Code forks = Electron**.
Медиана отрасли для agentic-клиента — Electron, а не «лёгкие» обёртки.

## 2. Electron vs Tauri (честный trade-off)

| Критерий | Electron | Tauri 2 |
|---|---|---|
| Паритет с Cursor (одинаковый рантайм Chromium+Node) | ✅ идентичная база | ❌ системный webview (Safari/WebView2 — расхождения рендера) |
| Легаси-линия ME2 (старый браузер MetaEngine — Electron) | ✅ прямое наследие | ❌ переписать shell-интерфейс |
| Footprint/RAM | больше (tech-insider: Tauri «96% smaller, 75% less RAM», Apr 5 2026) | меньше — честное преимущество |
| Сборка в песочнице | нет (нужен npm-кэш Electron-бинарей) → **сборка = CI** | нет (нет cargo) → сборка = CI (M3 DONE) |
| Обновления | electron-updater (Squirrel/NSIS) зрелые | tauri-updater (minisign) настроен в CI |

Решение (R21): **клиент = Electron (primary)** — директива оператора ×3 + паритет
с Cursor + легаси-линия. **Tauri-shell сохраняется** как CI-артефакт M3 (не удаляется,
это легальный альтернативный shell с уже настроенным updater).

Источники trade-off: teamdev.com Jul 27 2026 / Apr 27 2026, pkgpulse.com Jun 15 2026,
tech-insider.org Apr 5 2026, github.com Elanis/web-to-desktop-framework-comparison.
Confidence: MEDIUM-HIGH (вторичные источники; официальные доки Electron — отложено, см. §5).

## 3. SPEC: me2-electron shell v0.1

Цель: окно-клиент Mission Control + sidecar me2-daemon. Ровно как Tauri-вариант (R17),
но на Electron — один источник поведения, два раннера сборки.

- **Процессы**: main (Node) — единственный привилегированный; sidecar
  `me2-daemon` (bun --compile бинарь) спавнится main'ом; renderer — наш MC UI.
- **Безопасность** (официальная модель Electron, knowledge-based, confidence HIGH):
  `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
  `webSecurity: true`; вся связь renderer→main — только через preload `contextBridge`
  с узким типизированным API (`me2.health()`, `me2.version()`); никаких remote-модулей.
- **Загрузка UI**: `ME2_UI_URL` (default `http://127.0.0.1:81` — gateway на daemon+MC);
  до загрузки — health-poll `:3041/health` (30с таймаут, ретраи 300мс), иначе
  fallback-страница с поллингом (урок R17: надёжнее remote-URL при мёртвом демоне).
- **Single instance**: `app.requestSingleInstanceLock()` — второй запуск фокусирует окно.
- **Lifecycle**: sidecar лог → `app.getPath('userData')/sidecar.log`; смерть daemon →
  баннер в окне + рестарт-кнопка (не автоцикл — lesson M15 «13.5h тупик»); exit → kill sidecar.
- **Updater**: НЕ в v0.1 (backlog P8: electron-updater + подпись; Tauri-updater уже в CI).

## 4. CI-стратегия (единственная верифицируемая сборка в песочнице)

`electron-build.yml`: матрица ubuntu-22.04 / macos-14 / windows-2022 →
setup-bun → bun install → `bun build --compile` sidecar под target-triple →
`npm ci` в electron/ → `npx electron-builder --dir` → upload artifact.
На тегах v* — установщики + draft release. Verify в этой сессии ограничена:
GitHub-токен потерян при env-reset (см. worklog R21-0) → push и CI-прогон отложены.

## 5. Ограничения исследования (честно)

- Веб-поиск исчерпал квоту (429 ×4 за сессию, скрин dev.log R18 — тот же лимит) →
  свежие свипы «Cursor internals»/«Electron security 2026» отложены в R22.
- Модель безопасности Electron и sidecar-паттерн в §3 — из документации Electron
  (knowledge-based, confidence HIGH, но без свежего свипа: пометка «re-verify R22»).
- Cursor-интринзики по-прежнему НЕ раскрываются официально (форк закрыт) —
  parity-матрица (R21-CURSOR-PARITY-MATRIX.md) фиксирует только публичные факты.

## 6. Влияние на roadmap P0→P9

- P0 Foundation: **закрыт клиентский фундамент** (решение + скелет + CI) и
  **деливерабл Capability/Parity Matrix** (файл + живое поле в /mechanics).
- Следующий gap (P1 Core Cursor Parity): табы/композер в клиенте (Cursor-подобный
  composer-UX поверх sense-слоя ME17) — либо дерево chat/composer-агента.
