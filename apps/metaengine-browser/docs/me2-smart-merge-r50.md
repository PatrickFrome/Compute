# ME2 ⇄ METAENGINE Browser — умное слияние R50 (фаза B: единая оболочка)

База: release-мейнлайн после R49 (PR #950). Принцип прежний: браузерные механизмы
авторитетны, ME2 — дочерняя плоскость (fail-open, zero-authority). R50 закрывает
решения K2/K6 из `docs/electron-rebuild-plan.md` и достраивает B4/B5.

## Решение K2/K6 зафиксировано

**Авторитетная оболочка — METAENGINE Browser** (live-установки, self-update-runtime-v8 +
Guardian, CI autorelease). `desktop/` из ветки `sandbox/me2-os` остаётся источником
механизмов и вычислительным заделом, но собственной доставки обновлений больше не имеет —
гонка двух updaters исключена архитектурно (updater.ts помечен DEPRECATED в исходниках).

## Что добавлено (браузер, этот PR)

1. **`src/me2/me2-ui-gateway.mjs`** — встроенный мини-gateway (порт механизма
   desktop/gateway.ts в me2-плоскость): loopback :8137 (env ME2_UI_GATEWAY_PORT);
   обычные запросы → Next UI :3000, `?XTransformPort=NNNN` → daemon/стримы,
   WS-upgrade — сырой TCP-pipe. ЕДИНЫЙ UI работает внутри браузера без единой правки —
   Electron полностью заменяет Caddy на машине оператора.
2. **`src/me2/me2-ui-host.mjs`** — хост панелей Mission Control (Next UI v5):
   усыновление живого UI (health-проба), спавн `bun run start` с backoff (ME2_UI_DIR /
   resources/me2-ui / cwd-кандидаты), MAX_RESTARTS, честные DEGRADED-строки; отсутствие
   каталога UI → фолбэк Mission Control на GET /ui daemon'а (не ломает ничего).
3. **`me2-mission-control.mjs`** — разрешение UI на каждый ensure:
   env ME2_UI_URL → живой встроенный gateway (панели v5) → самодостаточный /ui daemon'а
   (`ui_mode: env|live_gateway|daemon_fallback` в каждой lifecycle-строке и статусе).
   Вкладки FLEET открывают `#chat=<session_id>` — сайт сам открывает конкретного агента.
4. **`me2-integration-entry.mjs`** — порядок старта: daemon-host → contract-handshake →
   ui-host → ui-gateway → fleet-bridge → mission-control → brain → mesh; статус несёт
   ui_host/ui_gateway; will-quit: деликатная остановка (UI и daemon переживают закрытие
   окна, killChild:false — наследие постоянных сессий). ME2_INTEGRATION_VERSION =
   `r50-unified-shell-1`.

## Согласованные изменения на стороне daemon (sandbox/me2-os)

- `GET /ui` — добавлен hash-роутинг `#chat=<id>` (фолбэк-UI тоже честно открывает
  агента из FLEET-вкладки).
- Панели v5 (Next UI) — тот же `#chat=<id>` → событие `me2:select-chat` → чат выбран
  на главной панели БРАУЗЕР (существующий механизм выбора от R44-G6).

## Гарантии

- probe-режимы не тронуты; self-update authority не задета (gateway/host ничего не знают
  о release-состоянии); loopback-only; все новые старты guarded с честным DEGRADED.
- Порядок загрузки UI: живой gateway (панели v5) → /ui daemon'а — оператор всегда имеет
  Mission Control даже без каталога UI.

## Проверки

- `npm run check` (node --check, включая оба новых модуля).
- Интеграционный прогон под Node против живых сервисов: HTTP-прокси gateway
  (:3000 UI и :3041 с XTransformPort) + WS-upgrade socket.io через gateway с
  agentchat:op ack — в тексте PR.
