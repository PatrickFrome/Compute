# METAENGINE: реестр поэтапного закрытия критического аудита (2026-10-18)

**Статус документа:** BINDING EXECUTION REGISTER / PLAN RECORDED / NO TECHNICAL GATE ACCEPTED.
**База анализа:** PatrickFrome/Compute, исходный SHA 7eaa00f0c4f618ece008968dd606fb648c157c4e; Draft PR #1318, дочерний #1317 и локальная интеграция #1316.
**Статус базовой установленной системы:** INSTALLED AUTONOMY NOT QUALIFIED.
**Место в иерархии:** это подчинённый журнал исполнения к действующему ROADMAP_UNIFIED_COMMAND_CONTINUITY_V1.md, а НЕ новый Level-1 roadmap, алгоритм планирования, Supervisor или authority.
**Приоритет пользователя:** тщательно, безопасно и последовательно закрывать дефекты, не наращивая неподключённую инфраструктуру.

## 1. Неизменная конечная цель

METAENGINE постоянно развивает поставленную оператором задачу посредством координирующихся, общающихся логических чат-агентов с рекурсивной постановкой подзадач; задачи, сообщения, проверенные результаты и логические личности переживают закрытие UI/сессий и перезапуск Host. Отсутствует глобальный лимит на число логических агентов, глубину и задачи; конечные физические слоты, затраты и проектная политика учитываются раздельно. Десять слотов внешнего DevFleet не являются лимитом METAENGINE.

Подлинный первый критерий пользы: authenticated Goal → existing Supervisor/W30 lease → isolated and bounded Git edit → physical tests → independent Critic → W39 durable own-PG17 checkpoint → restart → independently verified next useful task without replaying unknown effects. Реальное исполнение важнее количества модулей, workflow и демонстрационных тестов.

## 2. Неприкосновенные границы

- Единственный источник истины о задачах/lease/событиях/эффектах — собственный PostgreSQL 17. Единственный физический scheduler — существующий Supervisor/DevOS. No Supabase/hosted/cloud fallback, no shadow scheduler or control authority.
- Host/Guardian/native process birth, project/Owner epoch/generation, private credentials and immutable source/package must be independently bound. No authority from renderer, page text, model output or caller-supplied verified booleans.
- AMBIGUOUS after a lost ACK is terminal for automatic replay until trustworthy physical reconciliation; never change to PENDING by convenience.
- No silent rewrite of Owner profile, installer, Guardian, attached PostgreSQL or OS policy. Do not install unsigned QA over current Owner. No automatic secret copy, blanket credential scans printed to logs or arbitrary shell/SQL/URL execution.
- Every modification: exact HEAD readback; isolated branch/worktree; narrow scope; deterministic tests including negatives; Draft PR; reviewer/independent Critic; no main merge without explicit integration acceptance.
- One exact source SHA for each claim; source tests, CI workflow, physical Windows package, local installed process, own-PG17 and independent Critic are distinct evidence classes. Do not inherit green checks from parent SHA or mark QUEUED/CANCELLED/SKIPPED as PASS.
- Any UNKNOWN trust or effect gate remains BLOCKED; a source-only fix never automatically becomes an installed fix. Release/package version uniqueness is mandatory.

## 3. Порядок и статус этапов

Статусы: NOT_STARTED, IN_PROGRESS, BLOCKED, EVIDENCE_READY, VERIFIED. Условия завершения обязательны; только terminal independent evidence переводит этап в VERIFIED. Результаты готовятся поэтапно, с отдельным коммитом/PR на каждую ограниченную работу. Read-only исследования соседних этапов допустимы параллельно, но не разрешают обход зависимостей, установку или promotion.

| Gate | Приоритет | Краткая цель | Текущее состояние | Главная зависимость |
| --- | --- | --- | --- | --- |
| G0 | P0 | Evidence freeze, exact SHA / installed identity, источники, риск | IN_PROGRESS | нет |
| G1 | P0 | Signed provenance, новая версия, безопасный Owner/runtime upgrade | BLOCKED | G0 |
| G2 | P0 | Default authentic W74/W75/W76 Host/Guardian/Owner custody | BLOCKED | G1 trust proof; G3 can use disposable PG in parallel |
| G3 | P0 | Реальная own-PG17 схема/ACL/lease/backup/restore | BLOCKED | G0; read-only и disposable work параллельно G1 |
| G4 | P1 | C1 реальный worker + C2 первый serial coding loop | BLOCKED | G2, G3 и физический sandbox |
| G5 | P1 | Restart continuity, loss-of-ACK, independent next task | BLOCKED | G4 |
| G6 | P1 | Durable logical agent identities, mailboxes, recursive coordination | BLOCKED | G5 |
| G7 | P1/P2 | Reachability audit, no unexplained production modules, hosted removal | IN_PROGRESS (read-only only) | G0; удаления после независимой проверки |
| G8 | P2 | Scale, resource economics, 72h soak, rollback | BLOCKED | G5, G6 и G7 |
| G9 | P3 | Governed RSI, independent evaluation, safe canary | BLOCKED | G8 |

### G0 — исходное состояние и единый evidence baseline

**Нужно:** зафиксировать чистый локальный и GitHub SHA, parent ancestry, исходный branch/PR, проверяемое описание installed EXE/ASAR/runtime и source inventory; отдельно записать RUNNING/UNKNOWN/AMBIGUOUS effects, OS Owner/Guardian/PG process incarnation, конечные CI job IDs и причины отказов. Проверить отсутствие новых секретов в изменениях и факт отзыва ранее опубликованных — если доказательства нет, отметить UNKNOWN. Не производить read-write SQL или каких-либо auto-recovery.

**Уже установлено как snapshot, НЕ приёмка:** 7eaa00f (PR #1318) является source-only; local Windows Owner pin расходится с digest нового runtime, установленный QA EXE NotSigned; Postgres listener 127.0.0.1:55432 ранее виден, но authority не прочитана. GitHub Package Smoke run 39085411714 отверг повторное использование версии 0.7.0-dev.1107139874568.1 (до этого связана с b4caa18). Self Update run 39085411708 и Shell V1 run 39085411670 красные с тремя source/contract regressions; Installed Chat/Soak зависят от пакета. Эта информация относится только к моменту опроса, требует fresh readback перед новым изменением.

**Выход G0:** один immutable baseline manifest с exact SHA, branch/PR, снимком terminal CI (и явным UNKNOWN), списком первичных блокеров, отметками read-only безопасности; независимая сверка артефактов и отсутствие неизвестной локальной мутации. Пока НЕ VERIFIED.

### G1 — доверенный пакет и безопасное обновление Owner/runtime

**Действия:** раздельно проверить реальную SLSA/build/source/installer-to-staging byte provenance, Ed25519 release root и Windows Authenticode; использовать новую строго монотонную неповторявшуюся версию. Проверить физическую привязку уже установленного пакета. Спроектировать auth-bound transactional upgrade существующего Owner: native Owner+Guardian identity, exact epoch/source/incarnation, проверка lease/AMBIGUOUS, защищённый backup/ACL+digest, CAS старой привязки, атомарная запись и readback, rollback. Не считать совпадающий SHA самоавторизацией; no free-form installer auto-promotion. QA preflight из PR #1318 — лишь защита одного scripted пути, interactive NSIS отдельно.

**Выход:** signed exact version/package + валидированная цепочка release provenance; positive и negative Windows install/upgrade/rollback; обычный стабильный Browser startup; protected Owner и attached PG сохранены. Если signer/custody недоступен — BLOCKED, не подменять staging фейком.

### G2 — замкнуть реальную production identity/custody composition

**Действия:** подключить не только определения, но и production caller bindHostOwnerGenesisW74, доверенных W75 native Guardian proofs, W76 private Gateway credential/own-PG birth/protected backup-root producers в main/Host/FinalRuntimeActivation. Убрать null-by-default completion. Проверять PID + native exact 100ns birth, device/client/project, owner epoch/generation, source, независимый native before/after readback; приватные данные не сериализовать в renderer/env/log.

**Выход:** физический Windows Host/Guardian/PG17 Owner proof на одном installed SHA; отрицательные revoke/epoch/source/PID/custody/reparse tests; no READY при UNKNOWN. Disposable источник может подтвердить только STAGING.

### G3 — собственная PostgreSQL 17 truth plane и recovery

**Действия:** replay миграций с чистой БД; выявить отсутствующие predecessor и дубликаты; проверить RLS/EXECUTE/GRANT и закрыть hosted SQL authority; выполнить genuine lease CAS, concurrent workers, W39 evidence/critic separation, AMBIGUOUS fencing. Полный backup, restore и rollback на ДВУХ независимых новых PG17-кластерах с byte/digest/role/row readback. Attached пользовательскую PG не мигрировать без отдельного approval.

**Выход:** exact-source PG17 tests PASS, реальный restore на два disposable clusters, независимый verifier. No optimistic ready по пустым mock ответам.

### G4 — C1 и C2: первая полезная операция

**Действия:** сначала квалифицировать real admitted Linux worker по C1 (его отдельная canonical gate), затем разрешённый C2 serial coding loop в существующем Supervisor/DevelopmentPlane, используя bounded signed FIXED_SANDBOX_SOURCE_EDIT с настоящим sandbox_backend_bound=true только после физического sandbox readback, generated pinned Git worktree, allowlist path/patch/bytes/pre/post-image и W30 lease. Реально запустить тесты и независимого Critic, запечатать W39 checkpoint. Не использовать новый executor/scheduler, arbitrary shell/SQL или пустые тестовые записи как свидетельство.

**Выход:** одна сквозная AUTHENTIC goal/task/edit/tests/independent Critic/checkpoint операция с exact source and physical readback; C1 и C2 принимаются отдельно.

### G5 — полезное продолжение после рестарта

**Действия:** на уже принятом G4 остановить/возобновить disposable или специально согласованную связанную инкарнацию; loss-of-ACK, orphaned lease и CAS resumption проверять независимым PG/native читателем. Не возобновлять AMBIGUOUS без подтверждения результата и отсутствия эффекта. UI shutdown не должен сам завершать durable работу.

**Выход:** next admitted task реально выполнена один раз после restart; ноль обнаруженных дублированных неизвестных физических эффектов, записанная проверка из другого процесса.

### G6 — координация, сообщения, рекурсия

**Действия:** logical_agent_id отделить от session_incarnation и BrowserCell; scoped own-PG append-only causal mailboxes, provenance-bound sender/recipient/sequence/ack/cursor, child tasks и конкуренцию нескольких агентов привязать к существующей authority, не вводить вторую mailbox DB. Ограничения физических слотов не должны обрезать логический граф; владелец проекта сохраняет свой policy.

**Выход:** многократный handoff, child delegation, collision/stale/revoke/duplicate negatives, больше логической очереди, чем физических слотов; полное восстановление после restart.

### G7 — убрать мёртвый и опасно дублирующийся код

**Исходная гипотеза из статического аудита на 7eaa00f:** 2886 Git-tracked файлов; 812 исследованных исходных модулей в пяти областях; 238 без найденного входящего обычного source import (Browser 73, ME2 UI 48, daemon 2, coordination 92, infra 23). Из UI components/ui 29 не получили импортов. Это НЕ означает 238/29 доказанно мёртвых файлов: Next aliases, Electron registerHooks, dynamic imports, manifest/worker preload, CLI, SQL, extension MV3, Next routes, CI jobs и native binary edges требуют отдельного учёта. Статический scanner был эвристическим, счёт меняется при расширении entrypoint graph.

**Действия:** для ВСЕХ production candidate modules определить runtime roots и reachability graph; присвоить ACTIVE, DYNAMIC_ENTRY, CLI_ONLY, TEST_ONLY, LEGACY_REQUIRED, DEPRECATED, ORPHAN либо UNKNOWN, указать owner/reason/consumer/test. Особое внимание: ME2 UI 29 unreferenced controls; RSI test-only pieces; legacy cloud.ts, supabase-health-sentinel и hosted fallbacks, DevOS governance, остатки старого SQLite scheduler. Учитывать production import hooks/registries. Удаление ТОЛЬКО для independently confirmed ORPHAN, одна малая группа за PR с compile/test/runtime negative canary. Не удалять исторические схемы, security fence и тестовые доказательства только ради снижения счётчика.

**Выход:** 100% учтённых production-модулей; ноль unexplained ORPHAN/UNKNOWN в production bundle; ни одного несанкционированного cloud/parallel scheduler пути; согласованные typecheck, build, native runtime и CI. Read-only классификация может идти параллельно G1–G6, удаление только через доказательство.

### G8 — ограниченные ресурсы и непрерывность

**Действия:** реальная физическая нагрузка, планировщик единственный; 4→16→32→64 логических contexts с независимым физическим pool, backpressure/queue/owner quotas; 72-hour physical canary, cancellation, crash/restart, health and telemetry, backup/restore, deterministic source and causal receipts.

**Выход:** измеренные useful verified completions/hour, p95 handoff, memory/storage/CPU bounds, lost-ACK duplicate rate и восстановление без нарушения Owner/Guardian.

### G9 — управляемое самоулучшение

**Действия:** активировать уже существующие проверенные experience/skill/RSI контуры только после G4–G8; независимый evaluator и экспериментальные ветки без возможности менять собственный evaluator, release signer, ACL или trust root. Canary, measured baseline delta и полноценный rollback.

**Выход:** подтверждённое независимым reviewer улучшение cost/latency/quality без деградации security/continuity и без самостоятельного release promotion.

## 4. Учёт задач, доказательств и переходов

Любая последующая работа по данному плану обязана отразиться в этом register без переписывания доказательств задним числом:

| Поле work item | Что требуется |
| --- | --- |
| Item / gate / priority / owner | Один ограниченный пакет; DRAFT PR, компетентный исполнитель и независимый проверяющий |
| Baseline + exact HEAD | Полный SHA, target/parent branches, source ancestry, changed paths |
| Hypothesis vs fact | Defect reproduction before; явно отдельные historical and speculative findings |
| Scope / exclusions | Какие файлы/системы можно менять, что запрещено трогать, нет hidden auth |
| Tests & receipts | Версии toolchain, точные команды, negative cases, exit codes, run/job IDs, source/installer/PG/Windows linked identity |
| Adversarial acceptance | Revoke, stale incarnation, alternate source, duplicate ACK, negative ACL/restore, cloud-block canary по мере применимости |
| Decision | BLOCKED / REQUEST_CHANGES / EVIDENCE_READY / VERIFIED; кто независимо подтвердил |
| Next step / blocker | Единственный следующий gate, недостающие producer/credentials/artifacts и условия разрешения |

Правило порядка: работать последовательно внутри критического пути G0→G1→G2/G3→G4→G5→G6→G8→G9. G7 разрешён как самостоятельный read-only поток, но не подменяет G4. Не запускать новый DevFleet send без фактических данных о доступных слотах и подтверждения receipt; не считать queued task выполнением.

Перед каждым новым шагом: прочитать этот register, текущий exact HEAD/PR/CI, два действующих roadmap/ADF документа, последнее решение; затем сделать только одну узкую реализацию/контрпроверку и записать факт. Не менять status на VERIFIED от одного позитивного source fixture.

## 5. Первое конкретное следующее действие

**NEXT = G0.1: exact-head source / installed / CI evidence manifest + blocker triage.** По свежему SHA проверить актуальный статус всех terminal jobs, исключить повтор версии пакета, проверить реальное installed Owner/Guardian/PG и подписывающего producer ТОЛЬКО read-only; оформить независимый ledger с UNKNOWN для нечитанных producer. Начинать новую сборку/миграцию или удалять код до этого не требуется.

**Решение при записи:** утверждена последовательность и критерии, НЕ утверждена готовность G0–G9, НЕ разрешена установка, release promotion, SQL мутация, cleanup без consumer proof или merge в main.

## 6. Источники принятия

- Canonical Level-1: [CANONICAL_ROADMAP.md](../../docs/CANONICAL_ROADMAP.md)
- Принятый ADF ADR: [METAENGINE_AUTONOMOUS_DEVELOPMENT_FABRIC_V1.md](../../docs/METAENGINE_AUTONOMOUS_DEVELOPMENT_FABRIC_V1.md)
- Живой Unified Roadmap: [ROADMAP_UNIFIED_COMMAND_CONTINUITY_V1.md](./ROADMAP_UNIFIED_COMMAND_CONTINUITY_V1.md)
- Исторические локальные аудиты: [REPORTS_ARCHITECTURE.md](../../docs/audits/metaengine-20261018/REPORTS_ARCHITECTURE.md), [REPORTS_CONTINUITY.md](../../docs/audits/metaengine-20261018/REPORTS_CONTINUITY.md), [REPORT_CODE_RUNTIME.md](../../docs/audits/metaengine-20261018/REPORT_CODE_RUNTIME.md), [OWNER_RUNTIME_RECOVERY_PLAN.md](../../docs/audits/metaengine-20261018/OWNER_RUNTIME_RECOVERY_PLAN.md).
- Исходная синхронизация: [PR #1316](https://github.com/PatrickFrome/Compute/pull/1316); предыдущее диагностическое исправление: [PR #1317](https://github.com/PatrickFrome/Compute/pull/1317); QA pre-install guard: [PR #1318](https://github.com/PatrickFrome/Compute/pull/1318).
- Выводы исходного статического аудита и CI readback относятся к точному снимку 7eaa00f, а не гарантируют будущую истинность после новых коммитов.

## 7. Журнал прохождения этапов (append-only)

| ID | Gate | Запись | Результат | Изменения authority |
| --- | --- | --- | --- | --- |
| PLAN-20261018 | G0 | Зафиксированы 10 этапов, критерии и точная исходная база; привязано к Unified Roadmap. | PLAN_RECORDED; ни один технический gate не VERIFIED | NONE |
| NEXT-G0.1 | G0 | Требуется свежий read-only source/installed/CI baseline с source-to-artifact provenance и независимой сверкой. | OPEN | NONE |

Каждый следующий завершённый пакет добавляет запись (а не меняет прошлый SHA/доказательства): дата, gate, PR, SHA, тесты, реальный readback, negative-case, независимый decision и следующий шаг. Спорные старые доказательства остаются HISTORICAL.
### G1-NSIS-EXTERNAL-RESTORE — 2026-10-19 / R1, ADF-1 / STAGING ONLY

- **Baseline:** PR #1340, exact `c2a45d82fecab447c318b4dca027c16d5970f997`.
  Isolated branch/worktree: `work/metaengine-g1-nsis-effects-restore-20261019`.
  **Implementation commit:** `94920be23a04c39c53c7bdf3260306530545c42f`.
  Distinct source-only package identity: `0.7.0-dev.1107139874583.1`; predecessor
  `.4582.1` is burned. No intermediate source/version physical build was reused.
- **Finding:** the existing G1 recovery observer compares the HKCU uninstall
  record and Start Menu shortcut but does not restore them. The frozen NSIS
  configuration also enables a Desktop shortcut, so that effect must be included.
- **Implementation:** `qa-disposable-nsis-effects.ps1` captures and restores all
  supported registry value types, including an unexpanded ExpandString, exact
  signed DWord/QWord representations, binary and MultiString values, plus the
  original bytes of BOTH real Windows .lnk files. The complete snapshot is
  externally digest-pinned; every value is decoded before mutation. Reject
  changed snapshots/preimages, uncaptured subkeys and filesystem junctions.
- **Physical Windows evidence:** 9 native scenarios (TAP 10/10 including parent)
  PASS with no skip. Exact restoration, three separately corrupted backup
  files, changed preimage, injected failure between registry and links, blocked
  replay, unknown subkeys, junction and invalid scope were exercised. The
  injected partial effect journals EFFECT_UNKNOWN_REQUIRES_READBACK and cannot
  be retried. Independent before/after hashes of the REAL uninstall record and
  both live shortcuts matched; only UUID-derived temporary objects were written.
- **Regression:** 46/46 focused Windows recovery/image/Owner/NSIS/Sentinel/
  activation tests PASS; Browser syntax/source checks 190 PASS; native PowerShell
  parser PASS. Exact-HEAD protected Git blob closure is required after the final
  evidence commit. Native regression is registered BEFORE package acquisition in
  the EXISTING Windows Self Update job; no new scheduler or workflow authority.
- **Current CI facts:** parent #1340 Self Update contract SUCCESS; physical
  Self Update run 39195995296/job 117879718388 still IN_PROGRESS at readback.
  Package Smoke run 39195995234/job 117878832011 still IN_PROGRESS. Separate W59
  run 39195995324 is FAILURE: W45 reported two lease acquisitions across a
  five-second fixture lease; fixture timing versus locking is not resolved here.
- **Decision:** EVIDENCE_READY for this disposable native external-effect
  operation only. G1 installed acceptance remains BLOCKED. This is not a live
  restore API, signed release or NSIS install/Owner transaction. User workstation
  readback still showed 3 Browser, 1 Guardian and 6 PostgreSQL processes.
- **Next:** join whole-image restoration, exact external effects and Owner CAS
  under the existing crash journal on an isolated real NSIS installation; retain
  unknown-effect fencing, independently verify the same final package provenance
  and obtain terminal Windows update/rollback evidence before live installation.

**G1 same-work-item follow-up — Desktop admission / NSIS evidence V2.**
Source parent for this follow-up: `a15bd61d1c867c1ee3393dd72e4bc9e258b78917`.
The existing `qa-nsis-external-effects.mjs` read-only producer and the existing
prepare/publish/rollback consumers now require V2 evidence with TWO independently
target-bound shortcut digests. V1 receipts, an omitted/mismatched Desktop digest
or a missing/incorrect Desktop link are rejected; old receipts are not rewritten.
The fixed native reader also closes its own stdin pipe.
Affected Owner and external-effect regressions were repeated: **13/13 PASS**.
Actual read-only Windows V2 observation of installed `.4568.1` returned OBSERVED,
one uninstall record, two shortcuts and both targets bound, mutation=false:
registry SHA256 `556b683a65eea5dca186ede9081b3a50ac5e6e7adf9fab0a83135f61ce451bd9`,
Start Menu `44eaa92adedb6d7419c2f4d6dac30916171846c366313ecf221565ab35644d49`,
Desktop `dc11fb6da13bbe9967306c1ef39fe94ff884509242825b3f396f62464555b3d0`.
This closes the missing Desktop readback in G1, not live restoration or installation.
