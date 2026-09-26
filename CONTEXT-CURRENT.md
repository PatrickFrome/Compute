# PHOENIX CONTEXT DIGEST (auto, heartbeat v2.2)

gen: 2026-09-26T23:03:51Z | worklog: 1838644B / 9978L | sha12=ae769793a70e

## КАК ПОЛУЧИТЬ ПОЛНЫЙ КОНТЕКСТ (выполни по порядку)
1. `bash /home/z/my-project/scripts/phoenix/phoenix-restore.sh --check` — кворум 8 источников, вердикт целостности
2. Прочитай: /home/z/my-project/CONTEXT.md (handoff-документ) + /home/z/my-project/PHOENIX-PROTOCOL.md
3. Прочитай хвост /home/z/my-project/worklog.md (последние 150+ строк) — канонический журнал ВСЕХ чатов
4. Если локальный worklog усечён/отсутствует: `phoenix-restore.sh --merge` (секционный merge-append без потерь)
5. Диагностика канала Supabase: хвост /home/z/context-vault/journal/phoenix.log (HB-SB-FAIL содержит тело ошибки)

## КАНАЛЫ ПОЛНОЙ КОПИИ worklog.md (1838644B)
| Канал | Путь | Переживает env-reset |
|-------|------|---------------------|
| Supabase Storage | me2-evidence/context-vault/latest/worklog.md | ДА (внешний) |
| OSS (ossfs) | /home/sync/me2-context-backups/latest/worklog.md | ДА (сетевой) |
| Vault | /home/z/context-vault/{latest,snapshots,repo}/ | частично |
| cron-KV | шарды CTX-SHARD-A/B (payload cron-задач) | ДА (серверный) |

## ПОСТОЯННЫЕ CRON-ЗАДАЧИ КОНТЕКСТА
- 413338: PAT watcher (15m) — при появлении GITHUB_TOKEN_ADMIN в /home/z/.a2/.github.env делает push-pending
- 416526: Context Guard (15m) — снапшоты/детект усечения/авторестор/феникс (скрипт в payload задачи)
- PHX-HEARTBEAT: (30m) — этот digest + Supabase/ossfs пульс (скрипт в payload задачи)
- CTX-VAULT-COMPACTOR: (1h) — обновляет KV-шарды CTX-SHARD-A/B

## ПОСЛЕДНИЕ 15 СЕКЦИЙ worklog (Task ID → Task)
- R80-PUSH-L → PAT-watcher прогон: push-pending-r80
- EVOLVE-ROUND-9 (implemented-EV-TOPO, engine v1.15→v1.16) → EV-TOPO — доменная группировка 12 панелей в 3 домена Runtime/Convergence/Evidence (Phase-2 из UI-аудита); устранить разрыв «движок планирует, агент не реализует»
- EVOLVE-ROUND-8 (implemented-EV-TOPO, engine v1.15→v1.17) → EV-TOPO — доменная топология: 15 панелей → 3 домена Runtime/Convergence/Evidence со sticky-заголовками (Phase-2 UI-аудита)
- R80-PUSH-M → PAT-watcher прогон: push-pending-r80
- R80-PUSH-N → PAT-watcher прогон: push-pending-r80 (main→sandbox/me2-os ff + 2 архив-ветки), верификация ls-remote
- EVOLVE-ROUND-9 → Раунд самоэволюции клиента — следующая задача бэклога: [EV-RESPONSIVE] mobile-first аудит: брейкпоинты sm/md/lg, touch-цели >=44px в Mission Control
- EV-RESPONSIVE (implemented, round 9, engine v1.19→v1.20) → EV-RESPONSIVE — mobile-first аудит Mission Control: брейкпоинты sm/md/lg, touch-цели >=44px
- EVOLVE-ROUND-10 → Раунд самоэволюции клиента — следующая задача бэклога: [EV-TOASTS] toast-фидбек на все мутирующие действия клиента (use-toast)
- R80-DESKTOP-1A-20260927 → ME2-раунд: self-evolve тик + аудит + desktop-клиент (me2/r78-desktop-from-scratch): GAP #1a activation/handoff/qualification
- R80-PUSH-Q → push-pending R80 — публикация main→sandbox/me2-os ff + 2 архив-ветки (GITHUB_TOKEN_ADMIN на месте)
- R80-PUSH-20260927-0627 → push main→sandbox/me2-os + 2 архивных ветки, ls-remote верификация
- DB-GITHUB-20260927 → подключить БД (db/custom.db) к GitHub-треку sandbox/me2-os
- R80 → push-pending main→sandbox/me2-os + 2 архив-ветки, ls-remote верификация
- EV-HEARTBEAT-V2.1 → аудит и апгрейд scripts/phoenix/phoenix-heartbeat.sh (v2.0 → v2.1)
- EVOLVE-ROUND-11 → Раунд самоэволюции клиента — следующая задача бэклога: [EV-WS-RESILIENCE] WS (:3040): reconnect c backoff + бейдж состояния связи в UI

## ХВОСТ worklog (последние 40 строк, вербатим)
```
- схема БД остаётся контролируемой prisma/schema.prisma; крупные/секретные .db по-прежнему вне трека по умолчанию
---
Task ID: R80
Agent: Super-Z (cron Job 413338, 2026-09-27 06:52)
Task: push-pending main→sandbox/me2-os + 2 архив-ветки, ls-remote верификация

Work Log:
- .github.env валиден (GITHUB_TOKEN_ADMIN присутствует) → scripts/push-pending-r80.sh исполнен
- main → sandbox/me2-os: b751deff..591b11a4, ff-push ok
- архивы: me2/archive-r21-sandbox-snapshot (73486ddf) up-to-date, me2/archive-v040-main-archive (c95de219) up-to-date
- ls-remote верификация: sandbox/me2-os = 591b11a4 ≡ local HEAD; дерево чистое
- секреты не печатались и не логировались

Stage Summary:
- вся локальная state опубликована (DONE: all local state published); следующий цикл стартует с 591b11a4
---
Task ID: EV-HEARTBEAT-V2.1
Agent: Super-Z (операторская директива «критический анализ скрипта + улучшение»)
Task: аудит и апгрейд scripts/phoenix/phoenix-heartbeat.sh (v2.0 → v2.1)

Work Log:
- аудит v2.0: off-by-one в awk (substr($0,8)→7 — съедалась 1-я буква Task в дайджесте); 4 бессмысленных SB-fail каждые 30 мин при проблемных кредах; нет retry и flock (worst-case рантайм > 30мин интервала → параллельные инстансы); двойной '000' при сбое curl; refusal-коды не различались; Supabase versioned/ рос бесконечно; отказы cp глотались молча; phoenix.log без ротации; пустой worklog затирал дайджест
- v2.1: все 9 пунктов закрыты; контракт stdout 'heartbeat ok: ...' сохранён; bash -n ok; прогон: heartbeat ok v=2.1, cp=11 sync=8, vault/latest ≡ local sha
- известный блокер сохраняется: sb=6fail (JWT невалиден — JWT pending operator), versioned-ротация активируется при появлении валидного JWT

Stage Summary:
- heartbeat v2.1 в scripts/phoenix/ + vault/latest; cron-payload задачи 416629 всё ещё несёт v2.0 (обновить payload при следующей правке cron)

---
Task ID: EVOLVE-ROUND-11
Agent: self-evolve v1.22 (sealed engine)
Task: Раунд самоэволюции клиента — следующая задача бэклога: [EV-WS-RESILIENCE] WS (:3040): reconnect c backoff + бейдж состояния связи в UI

Work Log:
- client health: GET / = 200, lint = 0/0, audit score = 83%
- движок: self-check OK, зеркала пересинхронизированы, версия движка: 1.22
- СЛЕДУЮЩЕМУ АГЕНТУ (webDevReview/tick): реализуй [EV-WS-RESILIENCE] в src/app/page.tsx (только / route), затем запусти 'bash scripts/phoenix/self-evolve.sealed.sh self-update implemented-EV-WS-RESILIENCE'

Stage Summary:
- раунд 11 зафиксирован; бэклог клиента продвигается; скрипт пережил проверки каналов выживания
```
