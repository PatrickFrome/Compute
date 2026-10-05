# METAENGINE — итоговый критический аудит, 5 октября 2026

## Вердикт

METAENGINE обладает содержательной архитектурой безопасной автоматизации, но пока нельзя объявлять его квалифицированной автономной Development OS или завершённым Compute Fabric. Главный дефицит — не количество механизмов, а доказанная сквозная доставка результата: точный исходник → воспроизводимый пакет → установленный runtime → реальная задача → проверенный артефакт.

Критические найденные дефекты proof-контракта исправлены в native source и целевой БД. Это **не** доказательство исправности установленного приложения и **не** завершение R1/C1/C2. Качественный скачок: превратить browser-centric control plane в ориентированную на задачи систему разработки с первым реальным Linux worker, serial coding loop и понятной оператору цепочкой доказательств.

## 1. Охват и границы доказательств

- Репозиторий: `PatrickFrome/Compute`; native baseline PR #1116, SHA `b5689a915ef578f0629322e33309824efb422fb2`.
- Целевая БД: `jhriwwsryeqsvvvufkok`, существующий app connector `coffee-house` / UID `supabase`. Новые ресурсы, интеграции и переменные окружения не создавались.
- Разрешение оператора на изменение БД, синхронизацию исправлений, DB checkpoints и отдельные ветки получено явно. Старое ограничение на SQL superseded только в рамках этого разрешения.
- На 18:00:49–18:01:30 UTC выполнены fresh readback проекта, GitHub heads/CI, live `pg_proc`, ACL, search_path, схемы, RLS, checkpoint ACL/triggers и агрегатов heartbeat/leases. Изменённая live миграция зарегистрирована как `20261005175138_browser_computer_proof_contract_convergence_v1`; всего 79 ledger entries.
- 194 source/transport tests: **192 pass, 0 fail, 2 Windows-only skip**. Это imported native source slice в Linux VM, не полный Electron checkout и не Windows qualification.
- **124 proof assertions + 6 checkpoint assertions** прошли на live PostgreSQL в синтетических транзакциях с `ROLLBACK`; физические эффекты не выполнялись. Это подтверждает проверенные DB-контракты, но не Windows UIA или installed runtime.
- UI reviewed по source `ui/app.js`, DevOS shell view model и preload. Установленный UI не запускался; visual/accessibility/performance проблемы ниже — риски и требования к проверке, а не результаты физических измерений.
- Публикация фиксируется отдельно в `evidence/metaengine-client/audit-synchronization-receipt.json`; данный документ не является authority receipt и не продвигает канонические milestones.

Нельзя гарантировать нахождение «всех багов» выборочным аудитом. Ниже отделены воспроизведённые дефекты, live observations и незакрытые проверки.

## 2. Архитектура и интеграционные границы

| Механизм | Правильная роль | Оценка и ограничение |
| --- | --- | --- |
| Durable Control Plane | Intent, task claim, generation/lease, effect identity, receipts | Сохранить единственную mutation authority в DB leases. Queue/Realtime delivery и model output не дают разрешения на эффект. |
| Guardian/Recovery | Lifecycle, проверенный release channel, health, A/B recovery | Не превращать в второй scheduler. Восстановление процесса не означает разрешение повторить неоднозначный Send/install/create-tab. |
| BrowserCells | Изолированное выполнение с точными WebContents/process/CDP target/generation | Нельзя адресовать «активную вкладку» вместо запечатанной цели. Нужна проверка bind/unbind/reincarnation под реальными сбоями. |
| Windows executor | Фиксированный bridge + typed request + действие + независимый readback | Bridge hash не менялся. Поток ввода сам по себе не семантическое подтверждение результата. |
| DevOS projection / preload | Безопасное представление session/task/surface/artifact | Положительно: explicit zero-authority contracts. Рендерер не должен превращать focus/selection/preferences в routing или leasing authority. |
| Release pipeline | Exact SHA → source qualification → fresh identity → package/provenance → installed qualification | Сейчас это реальный blocking gate, а не косметическое CI-улучшение. Старый зелёный SHA не квалифицирует новый patch. |
| Compute execution spine | R1 → admitted Linux worker → repo/edit/build/test/artifact | Наличие схемы, UI и daemon endpoint не удовлетворяет C1/C2. В этом аудите их live acceptance не установлен. |

## 3. Подтверждённые дефекты и исправления

### P0 — положительный receipt без корректного доказательства эффекта

Обнаружены и исправлены:

1. Generic `readback_proven` допускал семантически неподходящий тип readback. Теперь focus/value/toggle/selection/expand/scroll имеют отдельные action-specific predicates; `UIA_INVOKE`, key и pointer delivery не повышаются до `EFFECT_PROVEN` без подходящего proof.
2. Разные действия с одинаковым readback kind могли подменяться. Теперь требуются фиксированная bridge schema и точное returned action.
3. Recorded target допускал coercion строк, массивов, null/boolean aliases. Теперь все семь identity fields должны существовать как собственные поля и иметь native JSON string/number types до digest validation.
4. Caller-supplied digest принимался без достаточной проверки post-effect target. Теперь вычисляется digest из machine fingerprint, session, PID, process creation time, window handle, executable SHA и generation; он совпадает с request/binding/receipt.
5. Вложенные binding/receipt evidence оставались изменяемыми после admission. Теперь JSON evidence detached и recursively frozen; sealed identity не меняется между dispatch и completion.
6. Отсутствующий effect boundary мог выглядеть как отсутствие эффекта. `NO_EFFECT_PROVEN` теперь требует **явного boolean `effect_started:false`**; missing/malformed evidence остаётся ambiguous.

При провале proof сохраняется `AMBIGUOUS_NO_RETRY`, без второго физического dispatch. Новые adversarial cases воспроизводили дефекты до исправления; после исправления source suite зелёная. Оболочки/schema strings — consistency checks, не криптографическая аутентификация произвольных receipts; fixed bridge остаётся trust boundary.

### P0 — client/live DB contract drift и обход через RPC aliases

До convergence live issuer/completion не обеспечивали весь новый client proof contract. Применена **одна атомарная live-specific migration** с exact preimage hashes `pg_get_functiondef`, lock/timeout и отказом при неизвестных concurrent definitions. Исторические V2 ledger entries не удалялись и не переигрывались.

После fresh readback:

- issuer требует native seven-field target digest и frame fence для pointer action;
- private proof helper сверяет action-specific readback, exact target, schema/action, terminal/no-effect semantics;
- `complete_v5` и batch используют helper;
- effect-bearing пути `complete_v6/v7` направлены через проверенный v5; нельзя обойти guard выбором alias;
- изменённые SECURITY DEFINER functions имеют pinned empty search_path; `anon`/`authenticated` не имеют EXECUTE, `service_role` имеет ожидаемое право;
- RPC-only таблицы защищены RLS/default-deny; не добавлялись permissive policies ради зелёного advisor.

**Статус:** live DB contract checks passed. Полная client↔installed-runtime synchronization остаётся открытой до exact-SHA Windows/package/live qualification.

### P0 — слабая долговечность audit checkpoints

Создана отдельная `destruktion_meta.metaengine_audit_checkpoint_v1`: generated payload SHA-256, RLS, SELECT/INSERT только для service role, запреты UPDATE/DELETE/TRUNCATE и overwrite. Все шесть отрицательных/положительных canary прошли с rollback.

Это append-only **при штатных ролях**. DB owner/admin способен изменить DDL или triggers: для adversarial-admin tamper evidence нужен внешний witness/independent continuity domain. Записи имеют `OPERATIONAL_AUDIT_ONLY`, `canonical_checkpoint=false`, `authority_effect=false`; не заменяют Supervisor semantic checkpoints и не закрывают R1.

## 4. Открытые слабые места

| Приоритет | Наблюдение | Риск / необходимая проверка |
| --- | --- | --- |
| P0 | 47 исторических Browser state rows, **0 heartbeat моложе 45 секунд**, последний 16:24:13 UTC; actuation leases: **0** на 18:00:55 UTC | Нет текущего installed live proof. Это не доказательство поломки или отсутствия приложения; требуется повторный authenticated runtime readback. Версионная строка в старой строке не подтверждает executable SHA. |
| P0 | Package run `37322001711` отклонён duplicate source/version build; downstream installed jobs red | Устранить release identity/provenance gate без повторного использования reservation. Не объявлять installer-acquisition failure runtime regression без разбора failed step. |
| P1 | Fresh census: **843 branches, 365 open PRs**; native и integration линии расходятся | Semantic convergence вместо bulk merge. Ограничить WIP, зафиксировать владельца/acceptance каждого capability diff; не стирать уникальные safety/performance возможности. |
| P1 | Persistent-bridge sibling PR #1108 и отдельные более новые qualification runs относятся к другим SHA | Переносить hot bridge/richer actions отдельно, сохранив typed proof, no-retry, bounded lifetime и generation fencing. Нельзя присвоить их зелёный CI этому patch. |
| P1 | Deployed Edge device-auth implementation/source binding не подтверждены этим аудитом | `verify_jwt=false` само по себе не exploit, но требует доказательства custom auth, enrollment, scope, revocation, request binding и negative canaries. |
| P1 | Последний прочитанный config: SSL enforcement off; broad network CIDRs; password minimum 6; localhost auth site URL | Security-hardening backlog, не доказанный external compromise. Подтвердить актуальную конфигурацию и реальные ingress paths перед ограничением доступа; конфиги здесь не менялись. |
| P1 | Нет fresh acceptance evidence R1 restore quorum, C1 worker admission, C2 end-to-end artifact в данном аудите | Не подменять real compute новыми supervisory layers. Требуется milestone-specific execution and readback. |
| P2 | Дублирование guards между JS, fixed bridge, SQL и RPC versions | Центральный test-vector corpus + contract manifest. Нельзя делить physical trust через один удобный generic success flag. |

## 5. UI клиента — критический разбор

**Что удачно:** session-first domain model; браузер является surface, а не всей OS; attention/active/background groups; bounded timelines; explicit zero-authority projection; task/artifact/memory surfaces; resync-aware preload.

**Где качество не догоняет сложность:**

- Глобальные fleet/supervisor/update/compute/gates статусы не объясняют конкретному пользователю, почему его задача остановлена и что безопасно сделать дальше. `RUNNING`, delivery, receipt и verified artifact необходимо показывать как разные стадии, с timestamp/source.
- Много технических режимов, аббревиатур и коротких IDs увеличивают cognitive load. Главный экран должен отвечать: цель, текущий шаг, blocker, ожидаемое разрешение, результат.
- `stateTone()` и компактные статусы удобны, но семантика fresh/stale/ambiguous должна быть видна текстом, не только цветом/tooltip. Проверить поведение screen reader, keyboard navigation, focus recovery и high-DPI.
- Task timeline ограничен 32 entries, выбранные surfaces — 256. Boundedness полезна; нужна явная truncation/pagination/history affordance, чтобы неполное представление не воспринималось как полный audit trail.
- Нужен evidence inspector: command/attempt, pre-effect boundary, lease/generation, exact target, typed result, artifact digest/provenance. После ambiguous effect показывать inspection/explicit new attempt, а не безопасно выглядящую кнопку «Retry».
- Разделить обычный session workspace и экспертную operations console. В обычном режиме — задача, editor/diff, tests, artifact; диагностику открывать по контексту.
- Renderer extraction/virtualization и delta delivery измерять на реальных session sizes. Latency/jank здесь **не измерены**: нельзя обещать ускорение без baseline и p50/p95/paint/IPC measurements.

## 6. Сравнение с сильными аналогами

Сравнение основано на первичных документах, не на запуске competitor benchmark. METAENGINE не обязан копировать их архитектуру целиком.

| Аналог / образец | Что перенять | Чего не переносить механически |
| --- | --- | --- |
| Playwright actionability + Trace Viewer | Exact target, preconditions, before/action/after evidence, source-linked timeline, понятная диагностика | Auto-retrying assertions/read-only observation допустимы отдельно; автоматический повтор физического Send/click после unknown outcome запрещён. Actionability не доказывает business effect. |
| VS Code source control | Центральный repository/diff/test/artifact workflow; review changes before commit; ясное различие commit/push/sync | UI selection не становится mutation authority; arbitrary terminal/page control не заменяет admitted worker contracts. |
| Bazel remote cache/CAS | Explicit inputs/toolchain/environment identity, content-addressed artifacts, verified materialization | Cache hit не proof authority. REAPI farm не первоочередной шаг до C1/C2; poisoning/equivalence требуют отдельной проверки. |
| Electron security model | Context isolation, sandbox, disabled remote Node integration, verified IPC sender, navigation/permission allowlists, current framework | Preload API нельзя считать безопасным только из-за contextBridge; проверять caller, generation, payload и минимальные capabilities. |

Источники: [Playwright actionability](https://playwright.dev/docs/actionability), [Trace Viewer](https://playwright.dev/docs/trace-viewer), [VS Code source control](https://code.visualstudio.com/docs/sourcecontrol/overview), [Bazel remote caching](https://bazel.build/remote/caching), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security). Проверены 2026-10-05. Windows UIA RuntimeId не является глобальной/вечной identity: https://learn.microsoft.com/en-us/windows/win32/api/uiautomationclient/nf-uiautomationclient-iuiautomationelement-getruntimeid.

## 7. Качественный скачок и критерий успеха

Не «больше агентов», а **доказуемая автономная поставка изменения**:

`Objective → durable task → admitted worker → isolated repository workspace → reviewed diff → build/tests → immutable artifact → verified delivery`.

Browser и native computer automation остаются изолированными adapters для тех действий, где действительно нужен UI. Typed readback, generation fencing и no-blind-replay являются обязательными на каждом пути. Guardian сохраняет lifecycle role, DB leases — authority, renderer — presentation.

Definition of Done: одна реальная задача проходит C1/C2 путь после crash/reconnect; stale generation и duplicate delivery не дают второго эффекта; артефакт имеет проверяемый digest/provenance; пользователь видит результат и blocker без чтения внутренних logs. Только после этого последовательно C3…C17.

Подробный dependency/acceptance roadmap: [METAENGINE_DEVELOPMENT_ROADMAP_2026-10-05.md](METAENGINE_DEVELOPMENT_ROADMAP_2026-10-05.md). Канонический Level-1 roadmap не перенумерован и не заменён.
