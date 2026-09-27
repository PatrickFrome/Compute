# PHOENIX CONTEXT DIGEST (auto, heartbeat v2.2)

gen: 2026-09-27T01:01:06Z | worklog: 1868218B / 10201L | sha12=899ed8d371ec

## КАК ПОЛУЧИТЬ ПОЛНЫЙ КОНТЕКСТ (выполни по порядку)
1. `bash /home/z/my-project/scripts/phoenix/phoenix-restore.sh --check` — кворум 8 источников, вердикт целостности
2. Прочитай: /home/z/my-project/CONTEXT.md (handoff-документ) + /home/z/my-project/PHOENIX-PROTOCOL.md
3. Прочитай хвост /home/z/my-project/worklog.md (последние 150+ строк) — канонический журнал ВСЕХ чатов
4. Если локальный worklog усечён/отсутствует: `phoenix-restore.sh --merge` (секционный merge-append без потерь)
5. Диагностика канала Supabase: хвост /home/z/context-vault/journal/phoenix.log (HB-SB-FAIL содержит тело ошибки)

## КАНАЛЫ ПОЛНОЙ КОПИИ worklog.md (1868218B)
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
- EV-HEARTBEAT-V2.1 → аудит и апгрейд scripts/phoenix/phoenix-heartbeat.sh (v2.0 → v2.1)
- EVOLVE-ROUND-11 → Раунд самоэволюции клиента — следующая задача бэклога: [EV-WS-RESILIENCE] WS (:3040): reconnect c backoff + бейдж состояния связи в UI
- HB-V2.2 → Критический анализ phoenix-heartbeat.sh и улучшение (запрос оператора после прогона 06:48 UTC+8)
- EVOLVE-ROUND-11-IMPL → [EV-WS-RESILIENCE] WS (:3040): reconnect c backoff + бейдж состояния связи в UI
- R80 → push-pending main→sandbox/me2-os + 2 архив-ветки, ls-remote верификация
- R80 → push-pending main→sandbox/me2-os + 2 архив-ветки, ls-remote верификация
- AUD-20260926-233328 → авто-аудит полноты контекста; фиксация смены статусов
- R80 → push-pending main→sandbox/me2-os + 2 архив-ветки, ls-remote верификация
- R80 → push-pending main→sandbox/me2-os + 2 архив-ветки, ls-remote верификация
- SEC-RESTORE-2 → Оператор ре-постнул секреты (88B-blob + service_role eyJ-JWT). Восстановить Supabase-канал, обновить носители, обновить cron-payload heartbeat до v2.2.
- R85-LIVE-AUDIT → фиксация состояния R85 qualification: exact head 35cacda4, PR #987, test-drift, Package Smoke #2422
- R85-INSTALLER-FORGE-20260927 → закрыть audit-loop R85 и реализовать архитектурный срез build-once installer provenance
- R80 → Проверка токена + push main→sandbox/me2-os + архив-ветки + ls-remote верификация
- R80 → Проверка токена + push main→sandbox/me2-os + архив-ветки + ls-remote верификация
- R86-BUILD-ONCE-PROVENANCE-20260927 → Полноценная разработка браузера (директива оператора: не мониторинг/аудит): закрыть следующий архитектурный срез «build once → immutable installer SHA/provenance → downstream gates тестируют одни и те же bytes» (устранить 4× дублирование NSIS-сборки), НЕ мешая R85 visual capture.

## ХВОСТ worklog (последние 40 строк, вербатим)
```
Stage Summary:
- Публикация актуальна: sandbox/me2-os = 3b630e6a; дерево чистое; блокеров нет

---
Task ID: R80
Agent: cron-413338
Task: Проверка токена + push main→sandbox/me2-os + архив-ветки + ls-remote верификация

Work Log:
- .github.env валиден (token=valid, без печати)
- push-pending-r80.sh: main→sandbox/me2-os up-to-date (ff-состояние подтверждено), архив-ветки up-to-date
- ls-remote ≡ local HEAD = fbb125e9 ✅

Stage Summary:
- Публикация актуальна: sandbox/me2-os = fbb125e9; дерево чистое; блокеров нет
---
Task ID: R86-BUILD-ONCE-PROVENANCE-20260927
Agent: Z.ai Code (main)
Task: Полноценная разработка браузера (директива оператора: не мониторинг/аудит): закрыть следующий архитектурный срез «build once → immutable installer SHA/provenance → downstream gates тестируют одни и те же bytes» (устранить 4× дублирование NSIS-сборки), НЕ мешая R85 visual capture.

Work Log:
- Аудит: daemon 0.21.0 жив (47/47, last_seq 226); /home/z/.a2/.github.env валиден; кодовая база браузера локализована = /home/z/me2-desktop (origin PatrickFrome/Compute), R85-ветка work/r85-control-room-ui-v1, PR #987 OPEN/DRAFT/mergeable=true
- PR-head ушёл вперёд во время раунда: 35cacda4 → … → ca04c934 → ac6e1d60 (2-4 коммита/час, драйвит другой цикл). test-contract fix УЖЕ приземлился коммитом 631ac0e3 «test(r85): qualify causal drawer identity contract»: тест теперь требует seq:++contextDrawerSyncSeq + presentationSyncStillCurrent(request,{seq,workspace,page}) — ровно как предписывал оператор; Critical Audit/Shell/и др. на новых головах SUCCESS
- CI-гонка: cancel-in-progress отменяет Package Smoke каждой волны при следующем пуше (#2422→#2423 cancelled, далее #2424→#2426→#2427→…→#2436 in_progress) → пуш в PR-ветку заблокирован весь раунд (правило оператора «не отменять visual capture» соблюдено)
- Картография 4× NSIS: package-smoke / installed-chat / final-runtime / soak — идентичная «npx electron-builder@26.15.7 --win nsis --x64 --config electron-builder.test.json» (4 легаси-workflow вне R85-волны не тронуты)
- NEW scripts/installer-provenance.mjs (zero-dep, node>=18): write | verify | resolve | download | acquire; схемы metaengine.browser.installer-provenance.v1 / -acquired.v1 / installer-run-resolved.v1 / installer-artifact-downloaded.v1 / -error.v1; fail-closed коды: sha_mismatch, size_mismatch, head_mismatch, name_mismatch, installer_missing, provenance_schema_invalid, provenance_field_invalid, artifact_not_found, artifact_expired, installer_provenance_producer_failed/_run_absent/_timeout
- Package Smoke (продюсер, единственный NSIS-builder): после digest — «installer-provenance.mjs write» (installer/blockmap/config sha256, GITHUB_RUN_ID/NUMBER, source-head); installer-provenance.json добавлен в артефакт metaengine-browser-windows-candidate-<head>
- Consumers ×3 (Installed Chat / Final Runtime / Soak package-session-soak): шаг «Build exact-head…» заменён на «Acquire provenanced exact-head installer from Package Smoke» (acquire→Expand-Archive→verify fail-closed), прежние RUNNER_TEMP-пути и proof-JSON-схемы сохранены байт-в-байт; permissions += actions:read; таймауты 28→75 / 30→80 / 45→90 (poll 45м, interval 30s, absent-grace 10м)
- Тесты: test/installer-provenance.test.mjs ×19 (CLI spawnSync — не-сетевые; resolve/download/acquire — in-process против локального http-фейка GitHub API; loopback capability-probe со skip) — 19/19
- Урок среды (UX-урок №9): в песочнице fetch на loopback из процесса-внука (spawnSync) висит НАВСЕГДА без ошибки/запроса; лечение — скрипт экспортирует API при не-CLI-запуске (pathToFileURL-гейт), сетевые тесты идут in-process
- Верификация: YAML-парс 4/4 ok; node --check ok; node --test: 19/19 + clean-genesis/release-exact-sha-workflow-contract/package-identity 27/27 + me2-primary-shell-runtime 40/40; после ребейза 59/59; секрет-скан диффа = 0
- Ребейз на ac6e1d60 чистый (их: «repair visual harness selector syntax», «fail fast on visual harness parse errors» — пересечений нет); локальный коммит 1880a83a «ci(r86): build-once installer provenance for all downstream gates» — НАМЕРЕННО НЕ ЗАПУШЕН
- Наблюдение: /home/z/.a2 частично деградировал (остался только .github.env); supabase-канал жив через ENVF/sealed-носители (heartbeat 11ok/0fail), функционального разрыва нет — восстановление дословно из ENVF при необходимости

Stage Summary:
- R86 СДЕЛАН: build-once provenance реализован и протестирован локально — 1 NSIS-сборка на head вместо 4; все downstream-гейты верифицируют одни и те же байты (fail-closed), product-код и R85-гейты не ослаблены
- Push-процедура в окне тишины (Package Smoke текущего head не in-flight): cd /home/z/me2-wt-r86 && git fetch origin work/r85-control-room-ui-v1 && git rebase FETCH_HEAD && (cd apps/metaengine-browser && node --test test/installer-provenance.test.mjs) && git push origin HEAD:work/r85-control-room-ui-v1
- После пуша: первый acquire-прогон покажет единственность NSIS-builder; следить за installer_provenance_* кодами в installed-chat/final-runtime/soak
- Backlog R87: подрезка таймаутов по фактической статистике прогонов; перевод 4 легаси-workflow на build-once; прокинуть provenance в release-evidence-gate/fast-autorelease аттестацию; EV-A11Y; watcher CI-гонки
- Открытое: R2 S3 secret access key (оператор); .a2 partial (не блокер); terminal outcome R85 visual capture (#2436…) — ждём
```
