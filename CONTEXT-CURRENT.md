# PHOENIX CONTEXT DIGEST (auto, heartbeat v2.2)

gen: 2026-09-27T00:29:33Z | worklog: 1860830B / 10150L | sha12=f8ff577e0c2d

## КАК ПОЛУЧИТЬ ПОЛНЫЙ КОНТЕКСТ (выполни по порядку)
1. `bash /home/z/my-project/scripts/phoenix/phoenix-restore.sh --check` — кворум 8 источников, вердикт целостности
2. Прочитай: /home/z/my-project/CONTEXT.md (handoff-документ) + /home/z/my-project/PHOENIX-PROTOCOL.md
3. Прочитай хвост /home/z/my-project/worklog.md (последние 150+ строк) — канонический журнал ВСЕХ чатов
4. Если локальный worklog усечён/отсутствует: `phoenix-restore.sh --merge` (секционный merge-append без потерь)
5. Диагностика канала Supabase: хвост /home/z/context-vault/journal/phoenix.log (HB-SB-FAIL содержит тело ошибки)

## КАНАЛЫ ПОЛНОЙ КОПИИ worklog.md (1860830B)
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
- R80-PUSH-20260927-0627 → push main→sandbox/me2-os + 2 архивных ветки, ls-remote верификация
- DB-GITHUB-20260927 → подключить БД (db/custom.db) к GitHub-треку sandbox/me2-os
- R80 → push-pending main→sandbox/me2-os + 2 архив-ветки, ls-remote верификация
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

## ХВОСТ worklog (последние 40 строк, вербатим)
```

Work Log:
- exact head 35cacda4d75f86c1e93832e628661e866c1a4e67 — НЕ qualified; PR #987 по-прежнему OPEN / DRAFT / mergeable=true
- Найден test drift (НЕ product defect): Critical Audit / Shell / Self Update E2E падают на одном устаревшем regression assertion в me2-primary-shell-runtime.test.mjs — тест требует старую схему `const syncSeq = ++contextDrawerSyncSeq; if (syncSeq !== contextDrawerSyncSeq) return`, тогда как R85-код уже сильнее: request фиксирует causal identity {seq, workspace, page}, setPage()/setWorkspace() инвалидируют generation, async resolve/reject сверяются с текущей тройкой + presentationSyncStillCurrent(...)
- Node suite: 3436 PASS / 1 FAIL / 2 SKIP — единственный failure = «R85 Context Drawer splitter is keyboard-accessible and native-sync fenced» на stale regex
- Live-матрица: Desktop Convergence, Typed Workspaces, Meta Orchestrator, Dirty Profile — SUCCESS; focused authority/causal/wake в Critical Audit — SUCCESS; Brain/scale в Autonomous Soak зелёные (1M/128 cells/128 agents, continuous 100k, 2000 tasks/2048 peers, chaos seeds); Installed UI 72-activation — в процессе; Installed Chat — свой NSIS собран, идёт installed clean-genesis/preconnect proof; Final Runtime — на сборке NSIS
- Package Smoke #2422 СОХРАНЁН (не отменялся): workflow имеет cancel-in-progress:true → новый commit сейчас отменил бы физический visual capture «Capture R85 primary ME2 visual evidence» — поэтому даже test-only fix намеренно НЕ закоммичен
- Локализованный patch: 3 stale assertions в me2-primary-shell-runtime.test.mjs → заменить на проверки `seq: ++contextDrawerSyncSeq` и `presentationSyncStillCurrent(request, { seq, workspace, page })`; product-код не трогать, gate не ослаблять
- Порядок после terminal outcome #2422: (1) забрать и проверить r85-command-1440x960.png + r85-command-drawer-1440x960.png + JSON; (2) минимальный test-contract-only commit; (3) новый exact-head qualification; если visual step красный — приоритет: конкретный physical visual defect
- Подтверждена проблема 4× дублирования NSIS-сборки (Installed Chat, Final Runtime, Soak, Package Smoke): следующий архитектурный срез = build once → immutable installer SHA/provenance → downstream gates тестируют одни и те же bytes
- Два product-fix (2 новых фикса до exact head) считаются корректными; красный CI — только stale contract-test
- write-ahead snapshot перед правкой ok

Stage Summary:
- 35cacda4 = potential-green кроме одного stale contract-test; главный незакрытый сигнал — физический R85 visual capture #2422 (Windows run сохранён); план: visual capture → test-contract-only fix → exact-head qualification → build-once installer provenance

---
Task ID: R85-INSTALLER-FORGE-20260927
Agent: Super-Z (dev-round, директива оператора «продолжить разработку браузера, полноценную»)
Task: закрыть audit-loop R85 и реализовать архитектурный срез build-once installer provenance

Work Log:
- CONTEXT GUARD Job 416526 исполнен: guard ok (snaps=37, latest_sha a20e90dd…)
- Live-стейт: голова PR #987 СДВИНУЛАСЬ после аудита: 35cacda4 → 1c487f59 → e3668e65 (параллельная линия: 631ac0e3 «qualify causal drawer identity contract» = ровно тот test-contract fix, что локализовал аудит; далее bounding harness + final-runtime UI provenance)
- Package Smoke: #2422 cancelled 23:55:22Z (пуш 507a1418), #2426 cancelled 00:14:27Z; факел visual capture теперь #2433 in_progress на e3668e65 — PNG (r85-command-1440x960.png, r85-command-drawer-1440x960.png) лягут в артефакт metaengine-browser-windows-candidate-<sha> при первом же terminal success
- Локальная верификация test-drift фикса на 1c487f59 (worktree /home/z/me2-r85): me2-primary-shell-runtime 40/40 PASS — старый regex `syncSeq !== contextDrawerSyncSeq` заменён на `seq: ++contextDrawerSyncSeq` + presentationSyncStillCurrent(request,{seq,workspace,page}) + doesNotMatch старой схемы (gate усилен, не ослаблен); фикс НЕ дублирован
- НОВЫЙ СРЕЗ реализован (ветка work/r85-installer-forge-v1, commit b3ec5440, draft PR #988 → work/r85-control-room-ui-v1):
  - scripts/installer-provenance.mjs: контракт metaengine.installer.provenance.v1 (write/verify, машинные коды 0/2/3/4/5, zero deps)
  - test/installer-provenance.test.mjs: 9/9 PASS (поведенческие: tamper/expect-sha/schema/usage + контрактные: пинят resolve/import/verify/publish в обоих workflow)
  - browser-installer-forge-v1.yml: standalone forge (workflow_dispatch + workflow_call c outputs), immutable артефакт me2-installer-forge-<head_sha> с provenance.json, cancel-in-progress: false
  - browser-windows-package-smoke.yml: resolve-forge (gh api, actions:read) → import по run-id (пин download-artifact как в r1-live) → provenance-verify + source_head drift hard-fail → пропуск inline build; inline-путь тоже штампуется (installer_source='inline-primary') и публикует артефакт СРАЗУ после сборки, ДО install/visual фазы (анти-#2422: retry переиспользует bytes); все install/proof шаги нетронуты
  - YAML-parse OK; зависимые suite зелёные: guardian-native-staging 6/6+skip, release-exact-sha-contract 4/4, release-physical-gate-chain 3/3
  - CI PR-ветки (b3ec5440): Package Smoke #2434 in_progress — первый end-to-end прогон нового resolve→inline→publish пути на Windows + ещё 5 workflow
- Секреты: push по PAT-паттерну set-url→push→clean-url, токен не печатался, git diff --cached скан = 0

Stage Summary:
- Audit-loop R85 закрыт: test-drift фикс подтверждён в дереве (не дублирован), судьбы #2422/#2426 установлены, visual capture = #2433 на e3668e65
- Build-once installer provenance опубликован как draft PR #988: гарантия «все downstream gates тестируют одни и те же bytes»; роллаут на Installed Chat / Final Runtime / Soak — следующий раунд (шаги resolve+import идентичны)
- Backlog: (1) import-шаги в 3 оставшихся gate; (2) забрать r85 PNG при terminal #2433; (3) ребейз #988 на движущуюся голову R85 перед промоушеном; (4) EV-backlog без изменений
- Worktree /home/z/me2-r85 (work/r85-installer-forge-v1) сохранён для следующих раундов
```
