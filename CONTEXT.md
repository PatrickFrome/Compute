# CONTEXT.md — Компактный контекст проекта (Handoff Document)

> НАЗНАЧЕНИЕ: если ты (агент/сессия) только что подключился и ничего не помнишь —
> прочитай ЭТОТ файл первым (он маленький), затем хвост /home/z/my-project/worklog.md
> (последние ~150 строк). Этого достаточно для продолжения работы без истории чата.
> Обновляй этот файл после КАЖДОГО значимого изменения состояния.
> Защита от потери: /home/z/context-vault (см. раздел «Механизм защиты»).

## 1. Идентификация

- Проект: **me2-os** (ME2 OS — daemon v0.18+, Mission Control, Tauri shell)
- Репозиторий: https://github.com/PatrickFrome/Compute.git (origin, https)
- Локальная копия: /home/z/my-project
- Окружение: песочница Z.ai, Next.js 16 + App Router, bun; gateway Caddy (один внешний порт)
- Часовой пояс оператора: Europe/Moscow

## 2. Cron-задачи (постоянные)

| Job | Расписание | Суть |
|-----|-----------|------|
| 413338 | каждые 15 мин (agentTurn) | Проверка /home/z/.a2/.github.env (GITHUB_TOKEN_ADMIN). Если есть → `cd /home/z/my-project && bash scripts/push-pending-r80.sh` (main→sandbox/me2-os ff + 2 архив-ветки me2/archive-r21-sandbox-snapshot, me2/archive-v040-main-archive) + запись ls-remote в worklog. Если нет → однострочная пометка «PAT ожидается, push-pending готов (ba623a59)». Секреты не печатать. |
| Context Guard | каждые 15 мин (fixed_rate 900s, agentTurn) | Выполняет /home/z/context-vault/context-guard.sh — снапшоты worklog/CONTEXT, детект усечения, авторестор, git-история, /tmp-зеркало, push context-vault при PAT. Феникс-скрипт встроен в текст самой cron-задачи (пересоздаёт vault при wipe). |

## 3. Текущий блокер (главный)

- **PAT отозван** (~11:52 предыдущего дня, после 401-инцидента). Файл /home/z/.a2/.github.env отсутствует с ~15:18.
- Последний успешный push: `b39db2e0..56ba1b87` → `sandbox/me2-os`.
- Все публикации (включая восстановление истории) стоят в очереди до нового токена.
- При возврате PAT: сначала Job 413338 (push-pending), затем guard сам запушит ветку context-vault.

## 4. Инцидент env-reset (15:18 +08, 2026-09-26) — учиться и жить с этим

- Откат /home/z/my-project к R21-снапшоту: main @ 73486dd; worklog усечён ~1951→130 строк.
- Удалены: scripts/push-pending-r80.sh, Chrome-расширение zai-chat-export, zip, public/zai-chat-export/, /home/z/.a2/ (токен), /home/z/me2-workspace, /home/z/me2-sandboxes.
- Невосстановимо без remote (не были запушены): расширение v1.0.1, push-pending скрипт, хвост worklog R22–R80.
- Вывод: ЛЮБОЙ важный артефакт должен попадать в context-vault (или remote) в течение 15 минут.

## 5. Состояние R-линии (по аудиту оператора, доставлен 22:22–22:37 +08)

- Trunk/authority: `release/self-update-ambiguity-live-v2` @ **cf747798** (Browser source authority). R77 НЕ финал; #967 — desktop donor (7 commits, behind 21); sandbox/me2-os @ 56ba1b87 = unrelated history (merge ЗАПРЕЩЁН, только semantic extraction).
- P0-блокеры: Supervisor ROLLOVER_AMBIGUOUS / composer_not_unique (cycle 2109 застыл с 24.09); live native_supervisor_idle_maintenance_wait_timeout; Edge production v13 ≠ release source (v14 canary активен); daemon не бандлится в installer; closed loop не доказан (seed_proven=0); Supabase roadmap baseline b69f… ≠ Browser cf747…; raw credentials в chat export → ротация обязательна.
- Roadmap R81–R90: AUTHORITY FREEZE → SUPERVISOR LIVENESS → EDGE CONVERGENCE → DESKTOP CONVERGENCE → SINGLE RUNTIME → CLOSED LOOP → BRAIN/MEMORY → RESILIENCE → QUALIFICATION → RELEASE SEAL. Старт R81 заблокирован PAT (нужен fetch release-ветки).

## 6. Ключевые пути

- /home/z/my-project/worklog.md — главный журнал (append-only, шаблон ---/Task ID/Agent/Task/Work Log/Stage Summary)
- /home/z/my-project/CONTEXT.md — этот файл
- /home/z/context-vault/ — snapshots/, latest/, journal/, repo/ (git), context-guard.sh
- /tmp/context-vault-mirror/ — зеркало (переживает project-reset, переживает не всё)
- /home/z/.a2/.github.env — токен (создаётся оператором; никогда не печатать)

## 7. Механизм защиты контекста (Phoenix Context Vault)

1. context-guard.sh (каждые 15 мин): снапшот worklog/CONTEXT при изменении; если worklog удалён/усечён >40% при эталоне >1000B — автокопия «truncated-*» и РЕСТОР из последнего снапшота; журнал; git-коммит в vault/repo; зеркало в /tmp; push ветки context-vault при PAT.
2. Феникс-свойство: полный текст guard-скрипта встроен в cron-задачу Context Guard → даже при полном wipe vault пересоздаётся автоматически.
3. Протокол агентов: (a) в начале работы читать CONTEXT.md + хвост worklog; (b) значимые события — append в worklog; (c) изменения состояния — обновлять CONTEXT.md; (d) секреты не печатать/не логировать; (e) новые важные скрипты дублировать в /home/z/context-vault/snapshots/.

## 8. Если ты — новая сессия после потери контекста

1. Прочитай этот файл и хвост worklog.md (150 строк).
2. Проверь: `test -s /home/z/.a2/.github.env && echo PAT-OK || echo PAT-MISSING`.
3. Если PAT-OK → выполни протокол Job 413338 (push-pending-r80.sh; если скрипта нет — сообщи оператору, восстанови по описанию в worklog).
4. Если vault пуст → запусти cron-задачу Context Guard руками или дай guard отработать по расписанию (скрипт пересоздаст всё, кроме старых снапшотов).
5. Продолжай по roadmap R81+ из раздела 5; первая задача — AUTHORITY FREEZE (после возврата PAT).
