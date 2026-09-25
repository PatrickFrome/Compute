# R78 Research — METAENGINE Desktop с нуля (2026-09-25)

## 1. Версии (проверено npm-реестром 2026-09-25)
- **electron 44.4.5** — latest stable (публикация 2026-09-23). Legacy-рельс сидел на 44.0.0 — берём 44.4.5 (директива «не учитывать старые версии»).
- **electron-builder 26.16.1** — latest stable; 27.0.0-alpha.8 существует, в прод не идём (alpha).
- **socket.io-client 4.8.3** (legacy был 4.8.1), **@electron/fuses 2.1.3**.
- Runtime-deps принцип: **единственная зависимость socket.io-client** (electron-updater не нужен — свой staged-updater).

## 2. КЛЮЧЕВОЙ ФАКТ — дефект electron-builder сохраняется в latest
`app-builder-lib/out/util/filter.js` (26.16.1):
```js
// filter the root node_modules, but not a subnode_modules
if (relative === "node_modules") { return false; }
```
createFilter() жёстко отбрасывает корневой node_modules ЛЮБОГО копируемого набора
(в т.ч. extraResources с filter ["**/*"]). Это первопричина R77: me2-ui-dist копился
в установщик БЕЗ node_modules → MODULE_NOT_FOUND у standalone server.js → старый UI.
Значит: фикc = ОТДЕЛЬНОЕ правило копирования `me2-ui-dist/node_modules → me2-ui/node_modules`
(корень того набора — содержимое node_modules, «relative==="node_modules"» не срабатывает)
+ физический тест механизма копирования + post-install верификация.

## 3. Современный Electron 44 — что используем
- WebContentsView (BrowserView мёртв давно) — таб-оболочка.
- contextIsolation+sandbox+preload.cjs — единственный мост me2Desktop.
- electronFuses в конфиге builder'а: asar-integrity + onlyLoadAppFromAsar.
- ELECTRON_RUN_AS_NODE=1 — штатный node-режим (node-фолбэк ui-host, R77-урок).
- node --test (node 24 в CI) — свежий suite без legacy-портов.

## 4. Архитектурное решение: функции системы ME → модули клиента
- Флот 12 чат-сессий → fleet-tabs (TAB_CEILING=12) + FLEET-вкладки chat.z.ai
- Mission Control R75 → ui-host (adopt :3000 → spawn standalone; bun→node фолбэк)
- XTransformPort-контракт → ui-gateway :8137 (allowlist 3040-3043, http+ws)
- me2-daemon-contract.v1 → handshake /state (parseHandshake, честный mismatch)
- evidence-дисциплина → lifecycle JSONL-журнал + update-journal (никогда не молчать)
- ME7-selfupdate (daemon) — НЕ трогаем: у клиента свой staged-updater; активация —
  следующий раунд (Guardian-parity), сейчас без тихого исполнения.

## 5. Что НЕ переносим (осознанно)
- 91 файл rsi-* (39% кода, само-референтная плоскость), 4-слойный emergency-family,
  developer-твины через registerHooks (композиция должна быть явной — урок R78-audit),
  604 legacy-теста (директива: «не ориентироваться на старые тесты»).
