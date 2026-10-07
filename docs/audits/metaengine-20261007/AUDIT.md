> Correction, 2026-10-07: the initial schema inventory omitted `destruktion_meta`. The selected live project DOES contain roadmap authority, plan and fleet/task tables. Epoch 3 / baseline `1fde1e53…` was freshly verified. Statements below about absence of those tables describe an incorrect earlier inference and are superseded by [RECOVERY_CHECKPOINT.md](RECOVERY_CHECKPOINT.md). Live state also changed during the authorized recovery: see that checkpoint.

# METAENGINE Browser — аудит экспорта, веток и установленного runtime

Дата: 7 октября 2026 года. Начальный GitHub snapshot: до создания ветки этого аудита. Live readback: 04:29–04:39 UTC / 07:29–07:39 Europe/Moscow. Статус: **READ_ONLY_INSTALLED_RUNTIME_CONFIRMED; STATIC_V30_QUALIFICATION_IMPLEMENTED; USEFUL_WORK_NOT_QUALIFIED**.

## 1. Результат и границы проверки

Установленная пользователем версия действительно обновлена до `0.7.0-dev.37493000001.1`. Свежий heartbeat и завершённая на Windows диагностическая команда подтверждают `be5e84a0524aece3f5ba1a5d84c09f38b05e4d8c` — frozen candidate [PR #1135](https://github.com/PatrickFrome/Compute/pull/1135). Старое утверждение экспорта «live ещё на 37416000001.1» теперь историческое.

Обновление клиента не устранило server-side readiness: stable отвечает HTTP 200, но `runtime_ready=false / DB_SOURCE_ATTESTATION_FAILED`; canary v30 отвечает `runtime_ready=true / ATTESTED / EXACT_DB_SOURCE_MATCH`. Guardian на установленной машине остаётся в HOLD с `connect EPERM`. Четыре ChatGPT-агента зарегистрированы как `BOUND_UNVERIFIED`. Useful work и canonical C2 этим аудитом не доказаны.

Проверены:

- все 1 230 строк основного приложенного `chat-export-2026-10-07.md`;
- полный доступный Git DAG и все **870 удалённых веток** до начала этого среза, включая 733 `work/*`;
- все **384 открытых PR**, полученные четырьмя страницами REST API;
- source/package frontier #1135 и repair frontier #1137, их exact-head workflow и relevant job steps;
- свежие данные выбранного пользователем проекта `jhriwwsryeqsvvvufkok`, конкретный client_id, функции, capability health, environment control и Meta-plan snapshot;
- две реальные диагностические команды через штатный **issue → lease → result** путь;
- загруженные через Supabase deployed entrypoint canary v30, stable v14 и rollback-v12, их import pins и соответствие source.

Глубокая проверка реализации сосредоточена на текущей Client/Edge линии. Для всех остальных веток выполнен полный анализ происхождения, SHA, дат, открытых PR и, для недавних расходящихся веток, состава изменённых файлов. Это не построчный security review кода во всех 870 ветках. `ANCESTOR` означает включение Git-истории в candidate, а не merge в main и не semantic acceptance. `DIVERGED` само по себе не доказывает отсутствие cherry-picked реализации.

Полные машинные индексы: [branches.json](branches.json), [open-prs.json](open-prs.json), [branch-summary.json](branch-summary.json), [live-evidence.json](live-evidence.json), [recent-client-donor-comparison.json](recent-client-donor-comparison.json).

## 2. Что в экспорте актуально, устарело или недостаточно доказано

| Утверждение экспорта | Текущая оценка | Основание |
| --- | --- | --- |
| GitHub и Supabase важнее старых Project Files | Актуально | Новые remote refs и live readback существенно меняют картину старых файлов |
| #1135 frozen на `be5e84a…`, version `37493000001.1` | Подтверждено | PR metadata, 15 exact-head workflow SUCCESS, текущий Windows readback |
| Новый клиент ещё не виден в live | Устарело | Heartbeat и команда DEV_PLANE_STATUS показывают новую версию/source |
| Dark workspace retired в source/package | Подтверждено для frozen candidate | PR/package CI; actual interactive UI на пользовательском экране отдельно не снимался |
| Любая новая правка клиента требует новой package identity | Актуальный инвариант | #1137 Package Smoke отказывает при попытке повторного build consumed identity |
| #1137 — исключительно source-only, live rollout не выполнялся | Противоречие в самом PR | Вверху body осталось старое NOT_DEPLOYED, ниже описан nonce-v3 rollout; текущие Edge metadata подтверждают rollout |
| nonce-v3 и exact rollback установлены | Подтверждено в текущем recovery backend | v30 source использует v3; stable-v14 и rollback-v12 имеют одинаковые файлы и digest |
| PostgREST PGRST002 требует pause → restore | Историческая гипотеза, сейчас не основание для restart | Поздний checkpoint сообщает recovery; нынешние Windows команды завершились, canary capability attested |
| Admission закрыт на generation 28 | Подтверждено сейчас | `devos_environment_state_v1` и runtime readback: CLOSED, authoritative, supervisor=false |
| Fence применён штатным `devos_supervisor_admission_v1` | Экспорт неполон | Поздний PR checkpoint раскрывает, что RPC отсутствовал и применялся guarded direct update в authority plane |
| Stable «версия 12» | Уточнение необходимо | Активная platform version — 14, payload byte-identical v12; нельзя смешивать platform counter и content lineage |
| Старый R83 можно сделать зелёным обновлением pin | Неверно | Старый frozen manifest v27 требует source/migrations exact-equivalence; новый source v30 требует отдельной lineage |
| Roadmap epoch 3 / baseline `1fde1e53…` актуален | В этой сессии не подтверждено | Это исторический Foundation authority readback; выбранный recovery проект не содержит соответствующей таблицы |
| Активного Meta-плана нет | Подтверждено через доступный RPC | `found=false`, generation 8 |
| R1 → C1 → C2 — следующий основной путь | Поддерживается canonical source roadmap | Наличие C4/C5 в Client-названиях не является выполнением одноимённых canonical compute milestones |
| Snapshot Windows state до установки сделан | Не доказано | Пользователь сообщил об установке; сохранение профиля/rollback snapshot независимо не наблюдалось |

Экспорт — текст беседы, а не полноценный журнал операций. Некоторые сообщения содержат пересказ tool activity, а не raw results. Ссылки на installer местами потеряны при экспорте. Поэтому claim о действиях восстановлен по exact GitHub/Supabase данным, где они доступны. Ранние общие советы про лимиты Chat/Work, память Projects и оценку «70–80% удобства» не использовались как технические инварианты продукта.

Особенно существенное расхождение: экспорт смешивает Foundation authority plane и Client recovery runtime plane. При первичном запросе старый `xpeibufgzjknrhbhpffp` не был доступен текущей интеграции. Пользователь выбрал `jhriwwsryeqsvvvufkok`; именно этот ref также pinned в текущем `native-supervisor-endpoints.mjs`, и в нём найден нужный live client. Нельзя автоматически переносить counts, authority epoch и continuity ledger из старого проекта в новый.

## 3. Актуальные frontier

| Plane | Exact identity / результат | Следствие |
| --- | --- | --- |
| Frozen Client source | #1135, `be5e84a0524aece3f5ba1a5d84c09f38b05e4d8c` | Сохранять immutable; новые runtime changes — отдельный candidate |
| Physical package | `0.7.0-dev.37493000001.1`, artifact `11427203806` | Квалифицированные installer bytes нельзя пересобирать под той же версией |
| Installer | SHA256 `81504d8e433704629d350eecadd29ffb30883f0250310bc8d69399840b09884a` | Hash verified ранее; actual installed byte rehash на Windows в этом срезе не выполнялся |
| User runtime | client `2a60d6a2-c7c2-4dcc-b4c9-99de768443c9`, тот же version/source | Fresh Windows connection доказано |
| Repair source | #1137, `6aeea9f68fa91ef38f4d0aea4eddaf1e4d29c0f9` | Server nonce-v3 deployed; client single-writer ещё не включён в установленный frozen installer |
| Canary backend | v30, `2197ca6ef50ae9a00f59a05edecf094b383824ebfddd19d917b73610feb831e6`, pin `6aeea9f…` | Exact normalized root и 11 прямых импортов подтверждены |
| Stable backend | platform v14, digest `5adc4cf2b05246c76a909697b4e613260296c93dc3d73ee9ed5f7bdec653731a` | Старый mixed import closure с минимальным nonce-v3 hotfix; capability attestation не проходит |
| Rollback | `a2-browser-native-supervisor-v12-rollback-snapshot`, v1, тот же digest и files | Exact payload clone доказан; исполнение rollback drill ещё не доказано |
| Admission | authoritative CLOSED, generation 28, refill=true, supervisor=false | Сохранять fence при диагностике |
| Active actuation leases | 0 unexpired/unreleased | Read-only команды не открывали actuation lease |
| Meta plan | found=false, generation 8 | Нельзя считать roadmap executable |
| Original authority | Foundation snapshot из экспорта | Current baseline/epoch требует отдельного fresh readback |

Существуют разные source subjects: установленный Client и canary backend. Их ancestry не превращает систему в same-source qualified. Новая source qualification явно связывает **два subject**, а не подменяет client SHA backend SHA.

## 4. Анализ всех веток и PR

Результаты точного DAG-сравнения:

| Отношение branch head | К frozen #1135 | К repair #1137 | К main |
| --- | ---: | ---: | ---: |
| EXACT | 1 | 1 | 1 |
| ANCESTOR | 257 | 258 | 3 |
| DESCENDANT | 1 | 0 | 0 |
| DIVERGED, общий предок существует | 605 | 605 | 860 |
| UNRELATED, общего предка нет | 6 | 6 | 6 |
| Всего | 870 | 870 | 870 |

95 открытых PR head являются предками/равны frozen candidate, 96 — repair candidate. Они остаются OPEN в GitHub, хотя их история уже присутствует в текущей продуктовой линии. Это не повод массово закрывать их: часть ещё нужна как immutable evidence и stacked-PR history. Но это сильный источник ложного впечатления, что в работе сотни независимых актуальных изменений.

`main @ b26f2d4693e7bab3648e0930b7a9e2c75baef58e` расходится с #1135: `main...candidate` содержит **460 main-only / 4881 candidate-only commits**. Название main не делает его безопасным baseline для нового Client-среза. Общий integration head также нельзя брать по старой handoff-капсуле без проверки области задачи.

Из расходящихся веток с последним commit начиная 29 сентября выделены 67: 32 меняют только docs/coordination, 33 — source или смешанный состав, 2 имеют отдельную историю. Такое разделение показывает реальный backlog для code convergence, но не является семантической классификацией каждого патча.

| Линия | Роль сейчас | Решение |
| --- | --- | --- |
| #1135 `work/client-v1-chatgpt-ui-convergence-v1` | Frozen установленный Client | Использовать для actual installed readback; не редактировать |
| #1137 `work/client-v1-state-plane-single-writer-v1` | Единственный прямой successor frozen source | База этого среза; требует новой physical identity при будущей сборке Client |
| #1136 `work/chat-development-operating-system-v1` | Отдельная docs-lineage, 8 docs-only файлов | Использовать протоколы; не bulk-merge как product candidate |
| #1132, #1131, #1130, #1129, #1128, #1127 | Предки современной Client-линии | Evidence/history; повторное слияние не требуется по ancestry |
| #1122, #1123, #1125, #1126 | Недавние расходящиеся C5 donor-линии | Blob-сравнение выявляет изменения относительно frozen candidate; переносить только после consumer/test reconciliation |
| `analysis/metaengine-critical-audit-20261005` | Audit/roadmap donor со source-различиями | Не считать docs-only; исследовательский roadmap — proposal/evidence, не live authority |
| `work/r1-*fresh-project*`, #1117/#1118 | R1 recovery source/evidence в ancestry | Проверять независимую durability/restore, а не считать R1 закрытым по source |
| `physical/build-slsa-provenance-v1` | Отдельная physical producer lineage | Не ретрофитить её SLSA на #1135 installer |
| Остальные старые repair/RSI/ME2 ветки | Historical либо отдельные workstreams | Полный SHA/PR индекс сохранён; нет automatic merge/promotion |
| 6 UNRELATED heads | Независимые корни истории | Любой merge требует отдельного обоснования |

Для #1122/#1123/#1125/#1126 отдельно сравнены product files с frozen source. Отличие blob не доказывает потерю функции: текущая линия могла изменить или реконструировать реализацию. Оно запрещает объявлять эти ветки эквивалентными без проверки. Список конкретных файлов сохранён в donor-comparison JSON.

## 5. Что действительно проверено на установленной Windows-машине

В recovery backend найден client_id из прежнего handoff. Heartbeat свежий; runtime `native-electron-supervisor-v1`, CONTROL/armed, version и source совпадают с #1135. Development Plane READY, compute HEALTHY, transport identity ADMIN epoch 1. Process incarnation `process_c60a1e29-5a50-4d99-8e50-6a134a75575f`, started 04:15:56 UTC. Device id `719bf900-9e50-44ec-b13b-fd998f33ba95`.

Через официальный `h205f22_a2_browser_supervisor_issue_native_v1` выданы только диагностические actions; command/result/state tables напрямую не переписывались:

| Action | Command id | Issued → completed | Result |
| --- | --- | --- | --- |
| DEV_PLANE_STATUS | `6774ae91-c20d-4d94-8af8-108a0e058b3b` | 04:33:39.059 → 04:33:40.150 UTC, ~1.09 s | COMPLETED, READ_ONLY, READY, exact source #1135 |
| SELF_UPDATE_STATUS | `a055235e-6a52-46f0-8955-961c8335932e` | 04:34:57.952 → 04:34:59.612 UTC, ~1.66 s | COMPLETED, READ_ONLY, CURRENT, last_error=null |

Обе команды имеют `authority_effect=false`, receipt readback с тем же command id/client, terminal status COMPLETED, без Browser/page effect. Это actual user-machine transport E2E для stable status path. Это **не** installed signed qualification canary v30 и не rollback drill.

Наблюдаемые ограничения:

- Guardian owner/device/service proof=false; HOLD, pipe EPERM. Некоторые heartbeat projection показывают stale observation во время refresh. Fresh READY не наблюдался.
- Fleet: 4 BOUND_UNVERIFIED, 0 ACTIVE; transport proof=null. При CLOSED admission это ожидаемый gate, а не разрешение принудительно сделать ACTIVE.
- Cognitive delta: UNAVAILABLE / COGNITIVE_ROUTE_HTTP_501. Catalog readback подтверждает **0** функций `h205f22_a2_browser_cognitive_accept_v1`. Поэтому canary promotion сам по себе не добавит отсутствующий DB acceptor.
- Long poll работает через BOUNDED_DB_POLL; PostgreSQL NOTIFY wake отсутствует, realtime token incompatible. Это degradation ускорителя; durable queue остаётся authority.
- Meta snapshot found=false. В выбранной БД нет `metaengine_devos_roadmap_authority_h205f22` и `metaengine_audit_checkpoint_v1`; authority facts из Foundation здесь не подтверждаются.
- Development Plane имеет planning/verification capabilities, но `sandbox_backend_bound=false` и `verification_sandbox_execution=false`. READY не доказывает repo → edit → build/test → artifact.
- SELF_UPDATE_STATUS CURRENT не доказывает работоспособность future download/install/rollback. Старое DISCOVERY_ERROR сейчас не воспроизведено, но полноценный update cycle не выполнялся.
- Live screenshot/DOM пользовательского ME2 UI и actual installed-file SHA rehash не получены. CI package proof подтверждает intended boot path, но не заменяет отдельный UI readback на этой машине.

## 6. Приоритетные слабые места

| Приоритет | Проблема | Что надо закрыть | Acceptance |
| --- | --- | --- | --- |
| P0 перед useful work | Stable capability/source drift | Квалифицировать новую v30 связку; затем controlled promotion только по установленным gates | Signed canary health + installed-Electron request/lease/result + independent receipt + rollback drill |
| P0 | Recovery/authority split | Получить fresh original authority readback и согласовать runtime endpoint, schema lineage, baseline и epoch | Exact account/project routing и один воспроизводимый authority binding |
| P0 | Нет ACTIVE executable Meta plan | Подготовить reconciled R1/C1/C2 plan на проверенном alignment | Generation-fenced ACTIVE plan; никакого canonical promotion без evidence |
| P0 | Canonical R1/C1/C2 не доказаны | Пройти continuity quorum, admitted Linux worker, serial coding loop | Независимый durable restore и verified artifact, а не только schemas/tests |
| P1 | Cognitive acceptor отсутствует | Отдельный forward migration/rollout после schema review; сохранить full-state fallback | Signed bounded batch → exact durable ACK, restart/readback, negative replay/sequence tests |
| P1 | Guardian EPERM | Машинная диагностика ACL/service owner через packaged bootstrap, не ослаблять IPC trust boundary | Fresh owner+device+service READY, negative wrong-owner proof |
| P1 | Missing issuer RPC parity | Live native issuer имеет старый action allowlist; не знает ряда новых READ_ONLY actions | Forward schema/API convergence с exact action matrix и fail-closed negatives |
| P1 | Client single-writer не установлен | После квалификации выбрать новый candidate/source и fresh monotonic package identity | One-built new installer; real installed state writers readback |
| P1 | User state rollback не доказан | Проверить наличие сохранённого профиля и durable local state | Restorable state snapshot, exact installer pair; rollback binary отдельно от state |
| P1/process | OPEN backlog включает absorbed/history PR | Ввести explicit frontier/evidence labels и owner-reviewed retirement | Нет duplicated integration и потери historical evidence |
| P2 | Unsigned dev installer / SLSA gap | Новый signed/attested production producer при production release | Attestation привязана к тем же exact installer bytes |
| P2 | Actual user UI readback | Проверить ME2 primary visibility/boot and retired surface absence | Exact runtime observation, не только package CI |
| P2 | Docs body содержит разные epochs/status | Развести frozen facts и current snapshot в durable handoff | У каждого claim source, observed_at и evidence class |

HTTP 200 не является readiness verdict. Сейчас обе health routes дают 200, но stable явным образом отказывает в readiness; current canary также не даёт physical_dispatch_allowed. Переключение admission ради зелёного fleet нарушило бы смысл этих gates.

## 7. Выполненное продолжение разработки

Создана отдельная lineage **R83_V30_20261007** на базе #1137, без изменения frozen Client, Edge source, migrations и старого v27 manifest.

Добавлены:

- `coordination/convergence/R83_EDGE_CANARY_V30_SOURCE_QUALIFICATION_V1.json` — exact v30 backend, frozen installed-client subject, stable-v14 и byte-identical rollback-v12;
- `coordination/client-v1/r83-v30-source-qualification.mjs` — исполняемый source gate: candidate SHA/digest, Git ancestry, root и import blobs, complete direct import closure, отсутствие source/migration drift и deployment-input dirt;
- negative tests, которые отвергают wrong project/SHA/digest/installer, missing module, duplicate pins, disabled live gates, ложный live completion, promotion и effect flags;
- `.github/workflows/r83-edge-canary-v30-source-qualification-v1.yml` — read-only CI с checkout exact PR head, pinned actions и Node 24;
- этот audit и полные branch/PR/evidence индексы.

Выход gate всегда **STATIC_QUALIFIED_LIVE_GATES_OPEN**, `promotion_authorized=false`, `automatic_promotion_allowed=false`, `authority_effect=false`. Signed-health, installed-Electron, durable lease/result и rollback drill сохраняются обязательными. В manifest не записываются результаты live qualification.

Локальная проверка: **35/35 новых adversarial/source tests** и **50/50 inherited Edge/transport tests** прошли. Отдельно bounded-fetch regression на baseline прошёл вместе с nonce/single-writer: 13/13, включая реальные 10–11 секунд result-delivery deadline tests. Повторение этих 13 не является дополнительными независимыми 13 evidence cases поверх overlapping 50. Новый source workflow CI на commit этого отчёта должен быть проверен отдельно и записан в PR metadata, не переписыванием frozen source manifest.

Для source workflow приняты только конкретные необходимые practices из [GitHub pull_request head documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request) и [least-privilege GITHUB_TOKEN guidance](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token): exact head checkout, contents:read, no deployment credentials. Новый scheduler/evaluator/effect plane не добавлялся.

## 8. Следующий срез и критерии завершения

1. Зафиксировать exact-head SUCCESS нового v30 source gate. Исторический красный v27 сохраняется историческим evidence, не переименовывается.
2. Продолжить actual installed-user qualification: наблюдение ME2 UI/identity и canary-bound signed read-only request → lease/result. Stable status E2E этого аудита не переносить на canary.
3. Выполнить controlled rollback drill с внешним evidence до stable promotion. Не менять admission и не трогать исторический READY smoke task в процессе квалификации.
4. Reconcile Foundation authority с recovery runtime. До этого не придумывать «epoch 4» из старого номера и не выполнять blind UPDATE baseline/milestone.
5. Отдельным bounded forward schema slice закрыть missing cognitive acceptor/issuer parity. Не повторять весь historical migration set и не подменять отсутствие acceptor успешным ACK.
6. Основной product roadmap: **R1 continuity/restore quorum → C1 first real admitted Linux worker → C2 isolated repo/edit/build/test/immutable artifact + independent readback**. Client C4/C5 names фиксировать с namespace, чтобы не спутать с canonical compute C4/C5.

Статус завершения этого среза: export audit завершён, all-branch topology/PR inventory завершены, user runtime connection подтверждена двумя read-only commands, new source qualification реализована и локально проверена. Production promotion, admission reopening, new installer build, Windows Guardian repair, user-data restore drill и canonical R1/C1/C2 не выполнялись.

## 9. Durable handoff

```json
{
  "schema": "CHAT_HANDOFF_V1",
  "task": "2026-10-07 export + all-branch audit; installed runtime readback; new v30 source qualification",
  "source_base": "6aeea9f68fa91ef38f4d0aea4eddaf1e4d29c0f9",
  "branch": "work/r83-v30-installed-source-qualification-v1",
  "frozen_client": "be5e84a0524aece3f5ba1a5d84c09f38b05e4d8c",
  "package_version": "0.7.0-dev.37493000001.1",
  "runtime_project_ref": "jhriwwsryeqsvvvufkok",
  "original_authority_current_readback": "UNAVAILABLE_IN_THIS_CONNECTION",
  "source_qualification": "STATIC_QUALIFIED_LIVE_GATES_OPEN",
  "local_tests": {"new_gate": "35/35 PASS", "focused_inherited": "50/50 PASS"},
  "live_diagnostic_commands": "2 COMPLETED / READ_ONLY / authority_effect=false",
  "admission": "CLOSED / generation=28",
  "promotion_authorized": false,
  "next_safe_action": "exact-head CI readback; external canary-bound installed qualification and controlled rollback evidence"
}
```

Этот handoff — snapshot и маршрут восстановления. Перед следующим действием перечитать GitHub refs/PR/CI и live heartbeat/environment/leases; не переносить временные counts как постоянную authority.
