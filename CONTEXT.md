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
| Context Guard (416526) | каждые 15 мин (fixed_rate 900s) | Выполняет /home/z/context-vault/context-guard.sh — снапшоты worklog/CONTEXT, детект усечения, авторестор, git-история, /tmp-зеркало, push context-vault при PAT. Феникс-скрипт встроен в payload задачи. |
| PHX-HEARTBEAT (416629) | каждые 30 мин (fixed_rate 1800s) | phoenix-heartbeat.sh v2.0: строит CONTEXT-CURRENT.md digest, грузит latest/* + versioned в Supabase (sha-дедуп), зеркалит в ossfs + /tmp + PolarFS. Феникс-скрипт (компакт-эталон) встроен в payload. |
| CTX-SHARD-A (416554) | ежегодно 09.09 (cron «0 0 0 9 9 ?») | ОФЛАЙН-копия CONTEXT.md + эталон guard-скрипта внутри payload — переживает env-reset VM. Read-only; при срабатывании отвечать «shard-ok». |
| CTX-SHARD-B (416555) | ежегодно 09.09 (cron «0 0 0 9 9 ?») | ОФЛАЙН-копия: протокол восстановления + хвост worklog + ключевые факты R80. Read-only. |
| CTX-VAULT-COMPACTOR (416631) | каждый час (fixed_rate 3600s) | Рефреш шардов: CONTEXT.md + PHOENIX-PROTOCOL.md + guard → SHARD-A; индекс 15 секций + хвост worklog 60 строк + протокол v2 → SHARD-B; верификация get → удаление старых генераций. Устаревание шарда ≤1ч (было 24ч). Лимит payload ≤10000 симв. |

## 3. Текущий блокер (главный)

- **PAT отозван** (~11:52 предыдущего дня, после 401-инцидента). Файл /home/z/.a2/.github.env отсутствует с ~15:18.
- Последний успешный push: `b39db2e0..56ba1b87` → `sandbox/me2-os`.
- Все публикации (включая восстановление истории) стоят в очереди до нового токена.
- При возврате PAT: сначала Job 413338 (push-pending), затем guard сам запушит ветку context-vault.

## 4. Инцидент env-reset (15:18 +08, 2026-09-26) — учиться и жить с этим

- Откат /home/z/my-project к R21-снапшоту: main @ 73486dd; worklog усечён ~1951→130 строк.
- Удалены: scripts/push-pending-r80.sh, Chrome-расширение zai-chat-export, zip, public/zai-chat-export/, /home/z/.a2/ (токен), /home/z/me2-workspace, /home/z/me2-sandboxes.
- Невосстановимо без remote (не были запушены): расширение v1.0.1, push-pending скрипт, worklog-хвост Sep 23–26 (R78–R80).
- Восстановлено из локального git: **worklog до-reset @ коммит 954e1b2 (Sep 22 14:10 UTC) — 1003995B / 6442 строки** → слит в канонический worklog.md (итог ~6700+ строк: глубокая история GLM/ME2-чатов + наш хвост R15→CTX-1).
- ⚠️ РАЗЪЯСНЕНИЕ ОПЕРАТОРА (обязательно для всех будущих агентов): worklog — ЕДИНЫЙ МНОГОЧАТОВЫЙ журнал одного проекта. Записи из разных чатов (GLM-IM, cron-агенты, R-сессии) с незнакомыми Task ID — ВАЛИДНАЯ история. Ничего не считать «подменой», ничего не удалять/перезаписывать. Работа разных чатов над одним проектом — норма платформы.
- Вывод: ЛЮБОЙ важный артефакт должен попадать в context-vault (или remote, или cron-шард) в течение 15 минут.

## 5. Состояние R-линии (по аудиту оператора, доставлен 22:22–22:37 +08)

- Trunk/authority: `release/self-update-ambiguity-live-v2` @ **cf747798** (Browser source authority). R77 НЕ финал; #967 — desktop donor (7 commits, behind 21); sandbox/me2-os @ 56ba1b87 = unrelated history (merge ЗАПРЕЩЁН, только semantic extraction).
- P0-блокеры: Supervisor ROLLOVER_AMBIGUOUS / composer_not_unique (cycle 2109 застыл с 24.09); live native_supervisor_idle_maintenance_wait_timeout; Edge production v13 ≠ release source (v14 canary активен); daemon не бандлится в installer; closed loop не доказан (seed_proven=0); Supabase roadmap baseline b69f… ≠ Browser cf747…; raw credentials в chat export → ротация обязательна.
- Roadmap R81–R90: AUTHORITY FREEZE → SUPERVISOR LIVENESS → EDGE CONVERGENCE → DESKTOP CONVERGENCE → SINGLE RUNTIME → CLOSED LOOP → BRAIN/MEMORY → RESILIENCE → QUALIFICATION → RELEASE SEAL. Старт R81 заблокирован PAT (нужен fetch release-ветки).

## 6. Ключевые пути

- /home/z/my-project/worklog.md — канонический МНОГОЧАТОВЫЙ журнал (~1MB, append-only)
- /home/z/my-project/CONTEXT-CURRENT.md — авто-digest «как получить полный контекст» (обновляет heartbeat)
- /home/z/my-project/PHOENIX-PROTOCOL.md — полный протокол защиты/восстановления контекста
- /home/z/my-project/scripts/phoenix/ — phoenix-heartbeat.sh, phoenix-restore.sh (--check/--restore/--merge), phoenix-snapshot.sh (write-ahead)
- /home/z/my-project/worklog-archive-pre-reset.md — копия глубокого архива (954e1b2)
- /home/z/my-project/CONTEXT.md — этот файл
- /home/z/context-vault/ — snapshots/, snapshots-wa/ (write-ahead), latest/, journal/, repo/ (git), context-guard.sh, supabase-persist.sh
- **/home/sync/** (OSS, rw) — вне overlay: me2-context-backups/{latest,versioned,bundles}/ + repo.tar (платформенный, НЕ ТРОГАТЬ); bundles/repo-all-*.bundle — полный git-архив 125MB
- **/tmp/my-project/** (PolarFS) — staging платформы: .a2-backup/me2.env.20260922 (креды Supabase/GitHub), context-vault-mirror/
- Supabase Storage: бакет me2-evidence, context-vault/latest/ (worklog, CONTEXT, CONTEXT-CURRENT, PROTOCOL, 5 скриптов, 2 журнала) + versioned/<ts>/ + bundles/ (125MB bundle НЕ влезает — лимит объекта ~50MB, HTTP 400)
- /home/z/.a2/.github.env — токен (создаётся оператором; никогда не печатать)

## 7. Механизм защиты контекста (Phoenix Context Vault v2)

0. **phoenix-restore.sh v2.0** — кворум 8 источников (local, vault/latest, vault-snapshot, vault-git, /tmp, PolarFS, ossfs, Supabase): `--check` (вердикт OK/НЕПОЛНАЯ/УСЕЧЕНИЕ), `--restore` (рестор из наибольшего, truncated-архив), `--merge` (СЕКЦИОННЫЙ merge-append: добавляет только отсутствующие блоки «---/Task ID», dedup по sha тела — безопасно для мульти-чатов, ничего не удаляет).
0a. **phoenix-snapshot.sh v2.0** — write-ahead снапшот ПЕРЕД любой правкой worklog/CONTEXT (snapshots-wa/, ротация 60, sha-дедуп).
0b. **phoenix-heartbeat.sh v2.0** (каждые 30 мин, Job 416629) — CONTEXT-CURRENT.md digest + Supabase latest/versioned + ossfs зеркала + /tmp/PolarFS. Окно внешней копии ≤30 мин (было: только вручную).
1. context-guard.sh v1.0 (каждые 15 мин, Job 416526): снапшот worklog/CONTEXT при изменении; если worklog удалён/усечён >40% при эталоне >1000B — автокопия «truncated-*» и РЕСТОР из последнего снапшота; журнал; git-коммит в vault/repo; зеркало в /tmp; push ветки context-vault при PAT.
2. Феникс-свойство ×2: guard-скрипт встроен в Job 416526, heartbeat-скрипт (компакт-эталон) встроен в Job 416629 — при полном wipe оба пересоздаются из cron-хранилища автоматически.
3. Протокол агентов: (a) в начале работы: `bash scripts/phoenix/phoenix-restore.sh --check` → CONTEXT.md → CONTEXT-CURRENT.md → хвост worklog; (b) ПЕРЕД правкой worklog/CONTEXT — `phoenix-snapshot.sh`; (c) append-only, незнакомые Task ID = валидные мульти-чат записи; (d) изменения состояния — обновлять CONTEXT.md; (e) секреты не печатать/не логировать; (f) после значимой работы — дать heartbeat/guard отработать (≤30 мин до внешней копии).
4. Cron-шард-хранилище: CTX-SHARD-A/B (Job 416554/416555) — CONTEXT.md + guard + протокол + хвост worklog ВНУТРИ payload. COMPACTOR (Job 416631) ежечасно пересоздаёт (gen<дата>). Roundtrip верифицирован; лимит payload 10000 символов (компакт-эталоны).
5. Supabase (ВНЕ платформы): heartbeat грузит latest/* (11 объектов, sha-дедуп) + versioned/<ts>/worklog.md (раз в ≥3ч при изменении). Верифицирован бит-в-бит (GET=локаль sha12 243cb67bda33).
6. OSS/PolarFS: /home/sync/me2-context-backups/{latest,versioned,bundles}/ + /tmp/my-project/context-vault-mirror/. Git-bundle 125MB (--all, verify OK) в bundles/ — полная история репо. repo.tar — МЕХАНИЗМ RESET, не трогать.

## 8b. Runbook восстановления v2 (после ЛЮБОГО wipe)

0. `bash /home/z/my-project/scripts/phoenix/phoenix-restore.sh --check` — если скрипты живы, они сами покажут кворум источников и вердикт; при УСЕЧЕНИИ: `--restore`; при НЕПОЛНОЙ: `--merge` (без потерь секций).
1. Проверить /tmp/my-project/context-vault-mirror/ и /home/sync/me2-context-backups/ (сетевые ФС, наиболее вероятное выживание) → восстановить vault + worklog.
2. Проверить /home/z/my-project/.git (глубокие блобы, reflog) — история в git-объектах могла пережить reset; полный клон из bundle: `git clone /home/sync/me2-context-backups/bundles/repo-all-*.bundle`.
3. Supabase: GET $SU/storage/v1/object/me2-evidence/context-vault/latest/worklog.md (creds в /tmp/my-project/.a2-backup/me2.env.20260922) или `phoenix-restore.sh --merge` (скачает сам).
4. Cron-шарды: cron list/get по префиксу CTX-SHARD — CONTEXT.md + guard-скрипт + протокол + индекс секций.
5. Феникс: Job 416526 и 416629 пересоздают guard/heartbeat скрипты из своих payload автоматически при следующих тиках.
6. Проверить probe-файлы (reset-probe-*.md в 5 локациях) → определить актуальную границу reset.
7. Выполнить bash /home/z/context-vault/context-guard.sh; дальше — §8.

## 8. Если ты — новая сессия после потери контекста

0. `bash /home/z/my-project/scripts/phoenix/phoenix-restore.sh --check` — кворум-вердикт целостности worklog (10 сек).
1. Прочитай этот файл, /home/z/my-project/CONTEXT-CURRENT.md (авто-digest) и хвост worklog.md (150 строк).
2. Проверь: `test -s /home/z/.a2/.github.env && echo PAT-OK || echo PAT-MISSING`.
3. Если PAT-OK → выполни протокол Job 413338 (push-pending-r80.sh; если скрипта нет — сообщи оператору, восстанови по описанию в worklog).
4. Если vault пуст → запусти cron-задачу Context Guard руками или дай guard отработать по расписанию (скрипт пересоздаст всё, кроме старых снапшотов).
5. Продолжай по roadmap R81+ из раздела 5; первая задача — AUTHORITY FREEZE (после возврата PAT).
