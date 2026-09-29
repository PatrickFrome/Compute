# PHOENIX-PROTOCOL.md — Протокол несгораемого контекста (Phoenix v2)

> ЦЕЛЬ: **каждый ответ в любом чате исходит из максимально полного контекста работы,
> и этот контекст переживает любые ресеты** (env-reset VM, откат volume, потеря сессии).
>
> Этот файл — нормативный документ. Все агенты всех чатов ОБЯЗАНЫ следовать ему.
> Копии этого файла: vault/latest/, Supabase context-vault/latest/, ossfs latest/,
> cron-KV (SHARD-A, ежечасно). Если файл отсутствует — восстанови по §5.

## 1. Почему это нужно (урок env-reset)

- env-reset 2026-09-26 15:18 +08 = **полный restart VM**: процессы и /tmp умирают,
  volume может откатываться к старому снапшоту (worklog был усечён ~1951→130 строк).
- Выживают гарантированно: **cron-хранилище платформы** (payload задач), **сетевые ФС**
  (ossfs /home/sync, PolarFS /tmp/my-project), **внешние сервисы** (Supabase).
- Отсюда правило: любой важный артефакт должен покинуть ephemeral-слой за ≤30 минут.

## 2. Архитектура слоёв (10 уровней)

| # | Слой | Что хранит | Периодичность | Переживает env-reset |
|---|------|-----------|---------------|---------------------|
| 0 | Живой worklog.md (append-only, ~1MB) | ВСЁ | непрерывно | ⚠️ частично (volume может откатиться) |
| 1 | **phoenix-snapshot.sh** (write-ahead, snapshots-wa/) | worklog+CONTEXT перед правкой | перед каждой правкой | ⚠️ |
| 2 | **Context Guard** (Job 416526): snapshots/ + авторестор + git vault/repo | работа | 15 мин | ⚠️ + феникс из payload |
| 3 | **PHX-HEARTBEAT** (Job 416629): Supabase latest+versioned, ossfs, /tmp, PolarFS, CONTEXT-CURRENT.md | всё | 30 мин | ✅ внешний |
| 4 | **CTX-VAULT-COMPACTOR** (Job 416631) → CTX-SHARD-A/B: payload cron-задач | digest+хвост+протоколы | 60 мин | ✅ серверный |
| 5 | Supabase Storage `me2-evidence/context-vault/` | полные копии | 30 мин (дедуп) | ✅ внешний |
| 6 | ossfs `/home/sync/me2-context-backups/{latest,versioned,bundles}` | полные копии + git-bundle 125MB | 30 мин | ✅ сетевой |
| 7 | vault git-история (`/home/z/context-vault/repo`) | каждый снапшот | 15 мин | ⚠️ |
| 8 | GitHub ветка context-vault | vault-состояние | 15 мин при PAT | ✅ внешний |
| 9 | Git-bundle + GitHub push-pending (Job 413338) | полная история репо | по PAT | ✅ внешний |

Окна потери контекста: запись→write-ahead = 0; запись→guard-снапшот ≤15 мин;
запись→внешняя копия (Supabase/ossfs) ≤30 мин; запись→KV-шард ≤60 мин.

## 3. ОБЯЗАННОСТИ КАЖДОЙ СЕССИИ (Golden Rules)

**При старте (до первого ответа по существу работы):**
1. `bash /home/z/my-project/scripts/phoenix/phoenix-restore.sh --check` → вердикт кворума.
2. Прочитать: `CONTEXT.md` → `CONTEXT-CURRENT.md` (авто-digest) → хвост `worklog.md` (150+ строк).
3. Незнакомые Task ID в worklog — ВАЛИДНАЯ мульти-чат история (не «мусор», не «подмена»).

**При работе:**
4. ПЕРЕД любой правкой worklog.md/CONTEXT.md: `bash scripts/phoenix/phoenix-snapshot.sh` (write-ahead).
5. worklog — **append-only** (шаблон `---` / Task ID / Agent / Task / Work Log / Stage Summary). НИКОГДА не перезаписывать, не урезать, не «ресторить» поверх более полной версии.
6. Изменение состояния проекта → обновить CONTEXT.md (после write-ahead).
7. Секреты не печатать и не логировать (токены, креды — только exit-коды и наличие).

**При подозрении на потерю:**
8. `phoenix-restore.sh --merge` — секционный merge-append: добавит только отсутствующие
   блоки, ничего не удалит. `--restore` — только при УСЕЧЕНИИ (вердикт --check), архивирует
   усечённое как truncated-*.
9. Инцидент — одной строкой в `scripts/phoenix`-журнал `/home/z/context-vault/journal/phoenix.log`.

## 4. Контрольные точки (если ты не уверен, что контекст полон)

- Кворум 8/8 источников с одинаковым sha12 = контекст полон (`--check`).
- CONTEXT-CURRENT.md содержит: последние 15 секций (Task ID → Task) + хвост 40 строк.
- Если работаешь после долгого перерыва: сравни sha12 в CONTEXT-CURRENT.md с текущим worklog.

## 5. Восстановление после wipe (кратко; полный runbook — CONTEXT.md §8b)

1. Guard и heartbeat пересоздадутся сами из cron-payload (феникс, ≤15 мин).
2. worklog: `bash scripts/phoenix/phoenix-restore.sh --merge` (возьмёт лучший из
   8 источников: Supabase → ossfs → PolarFS → /tmp → vault).
3. Если скриптов нет: GET `$SUPABASE_URL/storage/v1/object/me2-evidence/context-vault/latest/phoenix-restore.sh`
   (Bearer из /tmp/my-project/.a2-backup/me2.env.20260922) или перепечатай из payload Job 416629.
4. Git-история: `git clone /home/sync/me2-context-backups/bundles/repo-all-*.bundle`.
5. Cron-шарды: cron list → CTX-SHARD-A/B → CONTEXT.md + протокол + индекс секций.

## 6. Реестр cron-задач контекста (не удалять, не менять расписания)

| Job ID | Имя | Ритм | Роль |
|--------|-----|------|------|
| 413338 | ME2 R80 push watcher | 15 мин | PAT-check → push-pending (секреты не печатать) |
| 416526 | Context Guard: Phoenix Vault | 15 мин | guard-скрипт (феникс-эталон в payload) |
| 416629 | PHX-HEARTBEAT | 30 мин | heartbeat-скрипт (компакт-эталон в payload, ≤10000 симв.) |
| 416631 | CTX-VAULT-COMPACTOR hourly | 60 мин | пересоздание CTX-SHARD-A/B |
| 416554/416555 | CTX-SHARD-A/B gen<дата> | annually (cron «0 0 0 9 9 ?») | reset-immune KV-шарды |

При изменении этого реестра — обнови CONTEXT.md §2 и следи за лимитом payload 10000 символов.

## 7. Известные ограничения (честно)

- Supabase Storage: лимит ~50MB/объект (HTTP 400) → git-bundle 125MB живёт только в ossfs
  bundles/ и GitHub (после PAT). Компенсация: worklog (1MB) в Supabase помещается свободно.
- cron payload ≤10000 символов → в payload живут компакт-эталоны (функционально идентичны).
- KV-шарды хранят дайджест, не весь worklog — полные копии только в Supabase/ossfs/GitHub.
- ossfs/Supabase-каналы зависят от внешних сервисов — при их недоступности guard+git+шарды
  дают локальную деградацию, не потерю.
