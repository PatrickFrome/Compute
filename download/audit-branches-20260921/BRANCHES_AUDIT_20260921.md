# АУДИТ ВЕТОК REPO PatrickFrome/Compute — 2026-09-21

Task ID: 2-a · READ-ONLY аудит (никаких мержей/пушей) · Метод: GitHub REST API (curl+jq) + локальный полный clone (rsi-work/Compute-r) для git cherry / reverse-apply верификации. Токен из /home/z/.a2/ghtoken (не логируется).

---

## 1. Общая картина

| Показатель | Значение |
|---|---|
| Всего веток | **1154** (12 страниц API, сверено) |
| Открытых PR | **587** (6 страниц), из них черновиков **564**, готовых **23** |
| Rail (релизная) | `release/self-update-ambiguity-live-v2` @ **6bf173c7** (merge PR #938 ← work/browser-closed-loop-audit-fixes-v1, 2026-09-20T19:20:52Z) |
| Актуальный релиз | **v0.7.0-dev.35532004761.1** (published 2026-09-20T19:33:37Z, target 6bf173c7, **7 ассетов** — подтверждено через /releases) |
| Эталонное «сейчас» аудита | 2026-09-20T19:33:38Z (head dev-канала) |

## 2. Группы веток (naming-паттерны, 1154)

| Группа | Кол-во | Пример / комментарий |
|---|---|---|
| work/browser-final-2026-* | **96** | RSI-конвергенционная линия (phase36, r5-r8, r9-r14, lineage, exposure) |
| work/metaengine-rsi-* | **274** | пофазные RSI-ветки (phase19→phase37, verifier-shadow, adaptive-retrieval…) |
| work/* прочие | **650** | домены: main-roadmap-accelerators (16), same-point-duel (13), a2-browser-operator (9), self-update-publish (4), browser-runtime-compatibility (4), work/rsi/* (4), + сотни одноразовых фич/фиксов v1/v2 |
| fix/* | **45** | glm-rollover-test-windows, browser-autonomy-hardening, read-plane-v2.2… |
| repair/* | **31** | supervisor-multihop-r1/r6, command-wait-poll-p2, heartbeat-contract… |
| ops/* | **16** | w1-эра (probe/step08, 2026-08-22…25) — исторические |
| integration/* | **11** | runtime-coherence-heartbeat/world-model, self-update-live-77-1-baseline |
| release/* | **8** | rail + self-update-ambiguity-live-v1, a2-chat-bridge-v0.5.22 и др. |
| tmp* | **8** | tmp-recovery-do-not-use, tmp-ignore… (мусор) |
| perf/* | **3** | browser-self-update-e2e (current/reuse) |
| scratch/* | **3** | r1-step05a/06 (w1-эра) |
| analysis/* | **2** | a2-dual-launch, integration |
| Одиночные | **7** | main, browser-dev-channel, update/browser-dev-channel, build/*, archive/*, noop-check, do-not-use-placeholder |
| **Итого** | **1154** | |

Ключевые служебные: `main` (85767548, merge #821), `browser-dev-channel`, `update/browser-dev-channel` (авто-подсказка dev-апдейта).

## 3. Активность (последний коммит ВСЕХ 1154 веток, ref 2026-09-20T19:33Z)

| Возраст | Веток | Доля |
|---|---|---|
| ≤24 ч | 20 | 1.7% |
| ≤7 дней | 442 | 38.3% |
| ≤30 дней | 684 | 59.3% |
| ≤90 дней | 8 | 0.7% |
| >90 дней | **0** | 0% |

По группам: work/metaengine-rsi-* — **100% свежее 7 дней** (активная RSI-фабрика); work/browser-final-* — 79% ≤7д; work/* прочие — 90% в окне 8–30 дней (завершённые конвергенции); ops/* и tmp* — вся активность 25–30 дней назад (мёртвые исторические); release/* — rail единственная «живая» (24ч). Вывод: репозиторий живой, но 59% веток — остывший хвост конвергенций, кандидаты на архивацию.

## 4. Цепочка релиза (rail)

- HEAD rail = **6bf173c7** — ПОДТВЕРЖДЁН (последний коммит = merge PR #938). CI rail 12/12 success (из предыдущего аудита CLOUD-AUDIT-20260921-006).
- Релиз v0.7.0-dev.35532004761.1 опубликован с target 6bf173c7, 7 ассетов (инсталлятор + blockmap + dev.yml + guardian .exe×2 + guardian-native-staging-manifest.json + verified-self-update-manifest.json).
- **update/browser-dev-channel** (d567da2d, 2026-09-20T19:33:38Z): единственный коммит во всей системе НОВЕЕ момента публикации релиза — это авто-bump «advance verified dev update hint to 0.7.0-dev.35532004761.1», т.е. **тот же номер версии, что у релиза**. Никакого кода новее релиза не существует.
- compare rail…dev-channel: ahead=125 — разбор показал: 7 = main-коммиты (см. §6), остальные ~118 — серия авто-коммитов «chore(browser): advance verified dev update hint …» + 2 инициализационных. **Продуктового кода в dev-канале нет** — это операционная телеметрия канала обновлений.

## 5. Неслитые ветки (compare rail…<branch> + локальный reverse-apply тест)

Из 15 самых свежих work/* **11 полностью слиты** в rail (ahead=0: closed-loop-audit-fixes, t3-delta-bus-mission-control-rpc, pigsty-db-integration, fleet-experience-driven, live-check-observability, work-graph-unified, shell-quantum-console, tier1-closed-loop-wave1, jscpd-gate-rsi-recalibration, rsi-live-integration, supervisor-mesh-start-recovery). **4 не слиты:**

| Ветка | ahead | Верификация контента (git cherry / reverse-apply на 6bf173c7) |
|---|---|---|
| work/browser-final-2026-convergence-rsi-r14-graduation-effect-v1 | **161** (154 не-merge от 19.09: 48 fix, 65 test, 17 feat, 17 ci RSI) | 82/154 патчей уже на rail (reverse-apply OK), **72 патча НЕ на rail**; файлы: 1359/1464 идентичны rail, 105 различаются. Темы потерянных: Phase34B runtime admission closure, Phase37A zero-effect graduation certificate, crash-aware durable state persistence, R13/R14 durable witness, Phase37A statistics binding, latest-head cancellation реконструкция |
| work/browser-final-2026-convergence-rsi-r8d-lineage-contamination-gate-v1-sol | 59 | только 7/59 на rail, **52 не дошли**; тема: stable-source lineage contamination gate / one-attempt exposure; ветка = head **draft PR #917** (base — другая work-ветка r8c-stable-source-effect-v1-gpt, т.е. стековый PR, не на rail) |
| work/browser-ci-latest-head-concurrency-v1 | 12 | 5 CI-патчей «cancel superseded runs»: на rail concurrency-механика **отсутствует в 4 workflow** (metaengine-browser-shell-v1, browser-windows-package-smoke, browser-windows-installed-chat-qualification, browser-final-runtime-activation-v1); в 5-м (governance-preview) — уже есть и совпадает |
| work/browser-final-…-rsi-ci-latest-head-concurrency-v2 | 13 | содержимое (включая d1d292b1 +1 строку governance-preview) на rail уже есть — diff пуст |

«Потеря» по reverse-apply консервативна (патч может не примениться из-за изменившегося контекста при уже присутствующем смысле), но git-сообщения этих тем на rail отсутствуют (grep=0) — считаем контент частично неперенесённым, требует трёхстороннего ревью.

## 6. Судьба 7 main-коммитов, отсутствующих в rail (compare 6bf173c7…main: ahead=7)

| SHA | Дата | Сообщение | Файлы |
|---|---|---|---|
| dd4b9509 | 08-26 | ci(chat-bridge): make contract workflow version-aware for browser operator | `.github/workflows/chat-control-plane-contract.yml` (+241, новый) |
| b08638c5 | 08-27 | ci(operator): add trusted Playwright MV3 runtime canary | `.github/workflows/a2-browser-operator-runtime-canary.yml` (+117, новый) |
| 4de680ee | 08-27 | ci(operator): add supervisor control behavioral gate | тот же файл (+3) |
| 0e067c9b | 08-27 | ci(operator): execute supervisor board DOM contract | тот же файл (+2) |
| 0f8206cf | 08-27 | ci(operator): verify pairing epoch rotation behavior | тот же файл (+2) |
| 0d1c074c | 08-27 | ci(operator): make runtime canary version-aware and gate rollover | тот же файл (+18/−9) |
| 85767548 | 09-18 | merge PR #821 «Work/metaengine rsi phase34b lifecycle cas admission v3» | **1428 файлов** (полный git-список; API отдал первые 300): ~73 workflow, native browser-guardian-scm (update-actuator.cpp +1166, scm-service, session-broker-wts…), src браузера (main.mjs, fleet-provisioner-core, browser-brain-*, guardian-*, devos-native-task-cycle-core…), smoke/dp, скрипты PS1 |

**Вердикт по судьбе:**
1. Оба операторских workflow-файла на rail **ПОБАЙТНО ИДЕНТИЧНЫ** main-версии (`git diff main rail -- <файлы>` пуст) → содержимое 6 ci(operator)-коммитов **НЕ потеряно**, вошло в rail другим путём. Полные файлы сохранены в commit-files/*.json.
2. Merge #821: **1301 из 1428 файлов идентичны** на rail, **0 файлов отсутствуют**; 127 расходятся. Направление расхождения: при переходе rail→main −6768/+998 строк, т.е. rail-версии эволюционировали дальше; main-уникальный объём ~998 строк в 127 файлах (среди них package.json, security-static-gate.mjs, cognitive-delta-bus, fleet-provisioner-*, devos-native-task-cycle-*) — требует точечного ревью, но признаков массовой потери нет.
3. Единственный реальный недовоз в rail от main-стороны: **cancel-superseded concurrency в 4 workflow** (см. §5) — операторская CI-механика экономии раннеров.

## 7. Открытые PR (587)

Распределение по префиксам заголовков: feat(rsi) 180 · без-conventional 163 (RSI Phase/METAENGINE/Repair-заголовки) · perf(browser) 90 · feat(browser) 41 · fix(browser) 32 · fix(rsi) 25 · test(rsi) 9 · feat(devos) 5 · test(browser) 5 · fix(devos) 4 · feat(browser-compute) 3 · browser 3 · прочие единичные (governance, host-agent, read-plane, ci/release…). Браузерной тематики (keyword по title/ветке: browser, supervisor, tab, fleet, guardian, self-update, shell, watchdog…) — **353 PR**.

**Топ-20 свежих браузерных PR** (все — стековые черновики RSI-конвергенции от 2026-09-19; № и ветка):

| PR | Дата | Название | Ветка (head) |
|---|---|---|---|
| #917 | 09-19 | feat(rsi): gate stable-source Phase36 exposure on lineage contamination | …rsi-r8d-lineage-contamination-gate-v1-sol |
| #913 | 09-19 | feat(rsi): add zero-effect exposure transition proof | work/browser-final-2026-rsi-phase36-transition-proof-v1 |
| #909 | 09-19 | feat(rsi): execute one-attempt exploration release with exact readback record | …rsi-phase36-one-attempt-release-effect-v1-sol |
| #903 | 09-19 | fix(rsi): bind Phase36 certificate to fresh source identity | …rsi-phase36-… (convergence) |
| #902 | 09-19 | feat(rsi): converge R5-R8 on one current lineage with cross-stage authority | …rsi-r5-r8-current-v1-gpt |
| #901 | 09-19 | feat(rsi): bind Phase36 exposure certificate to fresh source identity | …rsi-r8-fresh-identity… |
| #896 | 09-19 | feat(rsi): add durable one-attempt Phase36 exposure release | work/browser-final-2026-rsi-r8-exposure-effect-… |
| #894 | 09-19 | feat(rsi): persist Phase36 exposure certificates as zero-effect evidence | …rsi-r8-certificates… |
| #892 | 09-19 | feat(rsi): converge fresh GitHub-DB-runtime source identity… | …rsi-r5-source-identity… |
| #889 | 09-19 | feat(rsi): bind Phase36 certificate to reviewed admission lineage v2 | …rsi-phase36-… |
| #887 | 09-19 | feat(rsi): add provenance-bound dormant retrieval review | …rsi-r7-review… |
| #886 | 09-19 | feat(rsi): add provenance-bound dormant retrieval review on current Phase35 | …rsi-r7-dormant… |
| #885 | 09-19 | feat(rsi): gate admission on exact source identity convergence | work/metaengine-rsi-source-identity-convergence… |
| #884 | 09-19 | feat(rsi): converge Phase35 explicit exposure hold on current canonical repo | …rsi-r6-exposure… |
| #883 | 09-19 | fix(rsi): bind matched exposure review to confirmed Phase34B admission | …rsi-r7-provenance… |
| #882 | 09-19 | fix(governance): converge RSI merge-admission contract | work/same-point-duel-v4-rsi-governance-contract… |
| #881 | 09-19 | fix(rsi): bind Phase36 exposure certificate to exact next governance | …rsi-phase36-… |
| #876 | 09-19 | feat(rsi): bind dormant exposure review to confirmed admission provenance | …rsi-phase36-… |
| #874 | 09-19 | feat(rsi): add Phase36 external exposure release certificate | …rsi-phase36-… |
| #872 | 09-19 | test(rsi): repair Phase32 exact-evidence revalidation fixtures | …rsi-phase32-… |

Готовых (не-черновик) PR всего 23, старейший #37 (08-23, read-plane v2.2); самые свежие готовые: #830 (fix glm-rollover-test-windows D-K7), #641 (chore rsi browser-release-sync), #558/#557 (supervisor multihop/transitive boundary repairs), #550 (installer heartbeat state route), #549 (runtime coherence world-model-final). Стековые PR мержатся вручную в rail пачками (PR #920–#938 уже так ушли).

## 8. Ветки/PR новее релиза

- Коммитов после 2026-09-20T19:33:37Z во всех 1154 ветках: ровно **1** — d567da2d (dev-hint bump, номер версии совпадает с релизом).
- PR, созданных/обновлённых после релиза: нет (самое позднее обновление PR — #839, 2026-09-20T00:07).
- **Версий новее v0.7.0-dev.35532004761.1 не существует** — релиз является глобальным фронтиром.

## 9. ВЕРДИКТ: достаточен ли rail как базис релиза

**ДА, rail 6bf173c7 — валидный и актуальный базис.** Он: (а) содержит содержимое обоих операторских CI-workflow и ≥91% файлов merge #821 (1301/1428, отсутствие целых файлов — 0); (б) поглотил 11 из 15 свежайших work-веток; (в) является фронтиром версий; (г) CI зелёный, релизная механика (verified-self-update-manifest, guardian-стейджинг) воспроизводится. Операторские CI-механики в rail **не потеряны** (2 файла идентичны), кроме одной узкой недостачи — concurrency-групп «cancel superseded» в 4 workflows.

**Риски (ранжированы):**
1. **RSI-долг**: 72 патча r14 (Phase34B admission closure, Phase37A graduation certificate, crash-aware durability) + 52 патча r8d-sol (lineage contamination gate) не в rail — реальная функциональная работа, от 19.09, требующая трёхстороннего ревью/мержа (или сознательного решения «поглощено эквивалентами»).
2. **main↔rail расхождение**: 127 файлов с main-уникальными строками (~998) поверх идентичных 1301 — при следующем сведении main нужен `git merge-file`-ревью; сам main целесообразно привести к rail (или объявить архивом #821).
3. **CI-механика**: 4 workflows без concurrency-cancel — срочно cherry-pick 4-строчных патчей (becfc53a-класс) — дёшево.
4. **Гигиена**: 1154 ветки (59% остывшие 8–30 дней) и 587 открытых PR (96% черновики) — при существующем `branch-lineage-audit-v1` workflow настроить авто-архивацию смерженных, иначе аудит-шум растёт.
5. tmp*/do-not-use-placeholder/noop-check — удалить (мусорные имена провоцируют ошибки выбора базовой ветки).

**Артефакты аудита** (в этом каталоге): branches-all.json, prs-all.json, activity-all.json (даты/шы 1154 веток), activity-sample.txt, commits-sample/ (73), commits-all/ (1154), compares/ (17 compare rail…ветка, включая main и dev-channel), commit-files/ (7 коммитов main с files), releases-latest.json, browser-prs.json (353), branch-groups.json, compare-list.txt.
