# AGENT DB CONNECT CAPSULE v1 — Swarm Shared Infrastructure

Операторское распоряжение (2026-09-28): ВСЕ агенты роя подключаются к ОДНОЙ БД и ОДНОМУ репозиторию.

## Что внутри
| Файл | Назначение |
|---|---|
| `agent-connect.env.sh` | Единая точка загрузки кредов → `AGENT_*` переменные (source перед работой) |
| `sb.sh` | Supabase REST: `bash sb.sh <table> [query] [method] [body]` |
| `gh.sh` | GitHub: `bash gh.sh {whoami\|clone\|pull\|push\|api}` (push блокирует секреты в стейдже) |
| `agent-bootstrap.sh` | One-shot проверка связи (только HTTP-коды). Exit 0 = полностью подключён |
| `swarm-secrets.env` | САМОДОСТАТОЧНЫЙ бандл секретов (perm 600, в git НЕ едет, раздаётся диспетчеризацией + Supabase) |

## Быстрый старт для агента
```bash
. /home/z/my-project/scripts/swarm/agent-connect.env.sh
bash /home/z/my-project/scripts/swarm/agent-bootstrap.sh   # ждём supabase=200 github_user=200 github_repo=200
```

## Общая БД (канонические таблицы, суффикс `_h205f22`)
- `compute_fabric_a2_browser_supervisor_state_h205f22` — heartbeat/состояние супервизора
- `compute_fabric_a2_browser_supervisor_command_h205f22` — очередь команд (status/receipt/error)
- `compute_fabric_a2_supervisor_mesh_instance_h205f22` — флот
- `compute_fabric_a2_browser_device_h205f22` — устройства
- `me2_event_mirror_h205f22` — журнал событий (сюда же сложена капсула: type=AGENT_DB_CONNECT_CAPSULE_V1)

## Общий репозиторий
- `PatrickFrome/Compute`, синк-ветка `sandbox/me2-os` (push), чтение main.
- Репозиторий ПУБЛИЧНЫЙ → секреты в git запрещены (guard в gh.sh/git-sync.sh).

## Железные правила (директива + урок R8)
1. Секреты НЕ печатать, НЕ логировать, НЕ коммитить.
2. Работа с БД только через service-role JWT из капсулы.
3. О каждом использовании писать событие в `me2_event_mirror` (type=AGENT_<ИМЯ>).

## Доставка капсулы
- HOST: `/home/z/my-project/scripts/swarm/` (этот каталог)
- SUPABASE: `me2_event_mirror_h205f22`, event type `AGENT_DB_CONNECT_CAPSULE_V1` (payload = полный бандл)
- FLEET: brief с капсулой диспетчеризован во все 4 вкладки (PLANNER/RESEARCHER/IMPLEMENTER/CRITIC)
- GIT: только скрипты (без секретов) — ветка `sandbox/me2-os`
