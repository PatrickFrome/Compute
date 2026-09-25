# METAENGINE Desktop (R78 — zero-based rebuild)

Electron PID-1 клиент системы **ME2 OS**, собранный **абсолютно с нуля** по директиве
оператора (trace `1a0d6ad9f8728939`): не порт legacy-браузера RSI-линии (382 файла),
а чистая оболочка вокруг функций/механизмов/модулей **системы ME**.

## Состав (каждый модуль = механизм системы ME)

| Модуль | Механизм ME-системы | Контракт |
|---|---|---|
| `src/me2/daemon-host.mjs` | daemon (Bun+SQLite): adopt-or-spawn, health, капы рестартов | `:3041/health`, `/state` → `me2-daemon-contract.v1` |
| `src/me2/ui-host.mjs` | Mission Control (Next standalone, R75): спавн + честный node-фолбэк | `:3000/` |
| `src/me2/ui-gateway.mjs` | внутренние ворота: XTransformPort http+ws, allowlist | `:8137` → {3040,3041,3042,3043} |
| `src/me2/fleet-tabs.mjs` | флот 12 чат-сессий chat.z.ai → FLEET-вкладки | `TAB_CEILING=12` |
| `src/core/window-shell.mjs` | оболочка: BrowserWindow + WebContentsView (Electron 44) | роли MAIN/FLEET/SUPERVISOR |
| `src/core/browser-policy.mjs` | политика безопасности: allowlist, deny-by-default | навигация/права |
| `src/core/journal.mjs` | evidence-дисциплина: JSONL-журнал в userData | boot/plane/exit |
| `src/update/staged-updater.mjs` | self-update: poll → verify → download → stage → journal | `me2.desktop-update-manifest.v1` |

## R77-урок — вшит в конструкцию

electron-builder (26.15.7 **и** 26.16.1-latest) безмолвно выбрасывает КОРНЕВОЙ
`node_modules` любого копируемого набора (`createFilter(): relative === "node_modules" → false`).
Установщик R77 потерял node_modules Mission Control → MODULE_NOT_FOUND → старый UI.

Защита в трёх слоях:
1. **electron-builder.yml** — отдельное правило `me2-ui-dist/node_modules → me2-ui/node_modules`;
2. **beforePack** — fail-loud, если артефакта/зависимостей нет или SHA не тот;
3. **тесты**: `test/packaging-contract.test.mjs` (конфиг) + `scripts/verify-builder-copy.cjs`
   (физическая сборка fixture: дефект документирован, фикc доказан) +
   `scripts/verify-installed-bundle.mjs` (пост-установка: SHA, зависимости, HTML/JS, запуск
   через упакованный electron).

## Команды

```bash
npm run check     # node --check всех модулей
npm test          # node --test (свежий suite, ноль legacy-портов)
npm run pack:ui   # apps/me2-ui standalone → me2-ui-dist (+ manifest)
npm run dist:dir  # локальная распакованная сборка (проверка упаковки)
npm run verify:builder-copy   # физическое доказательство механизма копирования
npm run verify:installed      # проверка установленной копии
```

## Честные границы (R78)

- Полная parity self-update с v8-рельсом (Guardian-активация) — следующий раунд;
  сейчас: honest staged+verified+journaled без тихого исполнения.
- GUI-прогон в песочнице невозможен (нет дисплея) — smoke-проба плоскости и
  упаковочные доказательства машинные; оконная обкатка — на машине оператора.
