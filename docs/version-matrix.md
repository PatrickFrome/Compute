# R52 — Матрица версий (K8, план electron-rebuild §E11)

> Живая сторона вычисляет матрицу в `GET /state → capabilities.compat` (R52).
> Этот документ — человеческая проекция + история изменений контракта.

## Текущая матрица

| Слой | Компонент | Версия / ожидание | Проверка |
|---|---|---|---|
| Оболочка | METAENGINE Browser (`apps/metaengine-browser`) | `>=0.7.0-dev` с me2-плоскостью (смарт-мерж R40, PR #948) | handshake: `integration-entry` читает `/state` при старте |
| Контракт | `me2-daemon-contract.v1` | `ops ⊇ ['turn','mesh_heartbeat']`, `GET /ui`, `GET /state → capabilities` | `GET /state` → `capabilities.contract` |
| Daemon | `me2-daemon` | `0.44.0` (R52) | `/health → version` |
| UI (панели v5) | `apps/me2-ui` | standalone-сборка в `resources/me2-ui` (C7) | `GET /` → text/html; фолбэк `GET /ui` |
| UI (fallback) | самодостаточный `GET /ui` | всегда присутствует (0 сборки, 0 зависимостей) | `GET /ui → text/html` |
| SQL-контур | `me2_event_mirror_h205f22` | опционально (operator-gated `ME2_SQL_MIRROR=1`) | `GET /sqlmirror → state ∈ OFF/WARMUP/LIVE/DEGRADED` |

## Правила совместимости (что делает каждая сторона)

- **Браузер**: при несовпадении контракта мосты честно DEGRADED (restart-шторма нет — R49).
- **Daemon**: аддитивная эволюция capabilities (только добавление; удаление op = bump мажора
  контракта `me2-daemon-contract.v2`).
- **UI**: отсутствие каталога `resources/me2-ui` — легитимный фолбэк на `GET /ui` (R50).

## История контракта

| Версия контракта | Раунд | Изменения |
|---|---|---|
| `me2-daemon-contract.v1` | R49 | handshake, `mesh_heartbeat`, `GET /ui`, eval v18 |
| `me2-daemon-contract.v1` | R50 | ui-host/ui-gateway (браузер несёт UI), фолбэк `/ui` |
| `me2-daemon-contract.v1` | R51 | изоляция инстансов (env ME2_*), transport.port живой |
| `me2-daemon-contract.v1` | R52 | `capabilities.compat` (K8-матрица в /state), SQL-контур `/sqlmirror` |
