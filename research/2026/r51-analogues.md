# R51 — Ресёрч: лучшие Electron-инженерные системы как эталон для MetaEngine unified

> Раунд R51 (фаза C, план electron-rebuild §C6-C7). Задача пользователя: «делай ресёрчи
> по лучшим аналогам на электроне, vs code, курсор и прочие».
> Метод: web_search недоступен (429, четвёртая сессия подряд — не амплифицируем),
> материал собран внутренним анализом задокументированных архитектур (VS Code docs,
> Chromium docs, публичные engineering-блоги) + наши живые пробы R49-R51.
> Веб-верификация ссылок — при первом окне квоты (честно помечено ⏳).

## 1. VS Code — процессная дисциплина (эталон №1)

**Проверяемая модель** (docs.code.visualstudio.com ⏳, github.com/microsoft/vscode wiki ⏳):
- **4 процесса на окно**: main (node) → renderer (Chromium, только UI) → extension host
  (отдельный node, падение расширений не валит UI) → utility processes (пробросы).
- **«Логика вне UI»**: бизнес-логика живёт в сервисах вне renderer'а; renderer
  переподнимается без потери состояния (ручной «Reload Window» — штатная операция).
- **Один владелец рестартов**: main-процесс единолично решает, кого рестартить;
  extension host получает backoff-политику, а не self-restart.
- **Versioned protocol между main и extension host**: версии несовместимы → хост
  честно помечается deprecated, а не «работает как получится».

**Наши соответствия (уже сделано / в плане)**:
| VS Code | MetaEngine unified | Статус |
|---|---|---|
| main-process | METAENGINE Browser (PID-1) + daemon (дочерний сервис) | R50: зоны стражей разделены |
| extension host | me2-daemon (агент-runtime вне UI) | M1, жив |
| versioned protocol | `me2-daemon-contract.v1` + capabilities-handshake | R49 (PR #950) |
| utility processes | me2-ui-host / me2-ui-gateway / мосты | R50 (PR #951) |
| Reload Window честный | DEGRADED при несовпадении контракта, без restart-штормов | R49 |

## 2. Cursor — дисциплина форка (эталон №2)

**Проверяемая практика** (cursor.com ⏳, публичные разборы ⏳): Cursor держит минимальный
дифф к апстриму VS Code — вся AI-плоскость изолирована в отдельных модулях с guarded
вызовами, поэтому ребейз на новые версии апстрима остаётся механической работой.

**Наш аналог (осознанно совпал)**: вся me2-плоскость браузера живёт в
`apps/metaengine-browser/src/me2/*.mjs` (7+2 модуля) и подключается минимальными
точками входа в чужой код. Смарт-мержи R40/R49/R50 (PR #948/#950/#951) подтвердили:
дифф к release-мейнлайну остаётся малым и читаемым.

## 3. code-server / VS Code Server / Slack local-service — served-UI (эталон №3)

**Практика**: тяжёлый UI раздаётся локальным сервером, оболочка — тонкий клиент.
**Наш аналог**: панели Mission Control (Next) раздаются встроенным
`me2-ui-gateway` (:8137 → XTransformPort-контракт), при отсутствии каталога UI —
честный фолбэк на самодостаточный `GET /ui` daemon'а (R50). Изоляция инстансов
(`ME2_*` env) — прямой аналог `code-server --bind-addr` для мультиинстансности.

## 4. Chromium/Chrome browser-process — вкладки как стражи (эталон №4)

- browser-process = PID-1 владелец всех вкладок; каждая вкладка — изолированный
  процесс; крах вкладки ≠ крах браузера.
- **Наш аналог**: TabRegistry с ролями MAIN/FLEET/SUPERVISOR + потолки (A2_SUPERVISOR_TAB_CEILING),
  supervisor-keepalive как страж ОКНА, daemon-host/ui-host — стражи дочерних сервисов
  (разделение зон R50 — прямой порт паттерна).

## 5. Автообновление: обновляет тот, кто не владеет данными — запрет (эталон №5)

VS Code/Cursor/Chrome: ровно один updater на установку; приложения из магазина —
магазин. **Наш статус**: desktop/updater.ts помечен DEPRECATED (R50), авторитет —
self-update-runtime-v8 + Guardian + verified-download-manager + CI-конвейер
«Fast Verified Dev Release». K6 закрыт.

## 6. Новое из R51 (этот раунд): изоляция инстансов как gate-требование

- VS Code: `code --user-data-dir … --extensions-dir …` — штатный способ поднять
  изолированный инстанс (используется их же smoke-тестами в CI).
- **Применено у нас**: `ME2_WS_PORT / ME2_REST_PORT / ME2_DATA_DIR / ME2_LOCK_FILE /
  ME2_LEGACY_MIRROR_PORT / ME2_SCREENCEAST_PORT` (daemon v0.43.0). Probe-инстанс
  на девственной DB в CI даёт eval PASS 53/53 — это и есть «ME2 unified gate».
- **Побочный продукт gate-теста — реальный баг**: `idx_eval_runs_started` создавался
  до таблицы `eval_runs` (тихий провал, девственная DB навсегда без индекса) —
  исправлен созданием индекса в схеме eval.ts + boot-запись памяти как
  persistence-пруф с первой секунды (eval memory.rows).

## 7. Что осознанно НЕ заимствовано

- Pixel-perfect UI-фреймворки Electron (Photon и пр.) — UI у нас web-native (Next+shadcn).
- Electron's `utilityProcess` API — у нас дочерние процессы через spawn + собственные
  стражи (переносимых модулей me2-плоскости это не требует).
- Мульти-окно как способ мульти-агентности — у нас агенты = контексты daemon'а
  (API-native), вкладки/чаты — представления (принцип G10/R44).

## 8. Следствия для фазы C/D

1. C6 (этот раунд): пакеты `apps/me2-daemon`, `apps/me2-ui` в release-ветке + gate.
2. C7 (R52): autorelease собирает `apps/me2-ui` → `resources/me2-ui` (served-UI
   паттерн), gate встроен в release-конвейер как required-check.
3. D8-D9: Supabase = federation/evidence (аналог VS Code-Telemetry/Remote — не истина).
