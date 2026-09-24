# ME2 OS — Electron client shell (v0.1, R21)

Primary-клиент ME2 OS по директиве оператора (×3: «клиент на базе Electron») и по
паритету с Cursor (Cursor = форк VS Code = Electron; research/2026/R21-ELECTRON-CLIENT-RESEARCH.md).
Tauri-shell (M3) сохраняется как CI-альтернатива — не удаляется.

## Архитектура

```
┌─ Electron main (единственный привилегированный процесс)
│   ├─ spawn sidecar me2-daemon (bun --compile бинарь, extraResources)
│   ├─ health-poll :3041/health (5s) → события daemon-down/up
│   └─ ipcMain: me2:health | me2:shell | me2:sidecar-restart
├─ preload.cjs — contextBridge "me2" (единственный мост)
└─ renderer — Mission Control (ME2_UI_URL, default http://127.0.0.1:81)
      при мёртвом daemon → fallback-страница с авто-переподключением (урок R17)
```

Безопасность: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
`webSecurity: true`; никаких remote-модулей и `executeJavaScript` на чужих URL.
Смерть daemon НЕ порождает автоцикл рестартов (урок M15) — баннер + ручной рестарт.

## Локальный запуск (вне песочницы)

```bash
# 1. собрать sidecar-бинарь daemon
cd mini-services/me2-daemon && bun install && bun build --compile index.ts --outfile ../../electron/dist-sidecar/me2-daemon-x86_64-unknown-linux-gnu
# 2. запустить shell
cd electron && npm install && npm start
# env-переключатели: ME2_UI_URL, ME2_HEALTH_URL, ME2_SIDECAR (явный путь к бинарю)
```

В dev-песочнице GUI-запуск невозможен (нет дисплея) — верификация = CI
(`.github/workflows/electron-build.yml`, 3 ОС) + `node --check` синтаксис + REST-инварианты daemon.

## Сборка (CI)

- push в sandbox/me2-os (paths: electron/**, me2-daemon/**) → `electron-builder --dir` + artifact (smoke-build, 3 ОС)
- тег `v*` → полные установщики: dmg (mac arm64) / AppImage (linux) / portable (win)

## Backlog (P1+)

- electron-updater + подпись артефактов (P8 Self-Update; Tauri-updater уже в CI)
- интеграция вкладок agent-browser как native-табов окна (мост ME17 sense → UI)
- Tray + глобальные хоткеи (⌘K composer)
- CSP-заголовок для renderer (когда MC начнёт рендерить внешний контент)
