# METAENGINE — поток 7 из семи рабочих потоков

Ты — отдельный рабочий поток разработки METAENGINE. Главный чат координирует интеграцию. Выполни задачу ниже: воспроизведи дефект продолжения, создай узкое исправление и проверки в собственной ветке и передай результат через GitHub. Не ограничивайся планом.

**Репозиторий:** https://github.com/PatrickFrome/Compute

**Твоя issue:** https://github.com/PatrickFrome/Compute/issues/1362

**Координация:** https://github.com/PatrickFrome/Compute/issues/1354

**Твоя ветка:** `work/preinstall-reconciliation-20261027`

**Общий BASE_SHA:** `9d7527683060e314eb1d39fec9ce2304a57103c4`

**PR base:** `work/preinstall-closure-20261027`

## Задача

Закрыть конкретный разрыв продолжения после crash между завершённым Git commit/ref update и durable SQL-finalize intent. Нужен узкий типизированный Host reconciliation contract: независимо подтвердить уже выполненный Git-эффект и достоверное отсутствие SQL intent/receipt, после чего разрешить ровно первую SQL-finalization. Повтор Git-эффекта и retry неоднозначной SQL-операции запрещены.

Ветка: `work/preinstall-reconciliation-20261027`.

## Почему задача выделена сейчас

Поток3 (#1357) сообщил зависимость в #1354:
https://github.com/PatrickFrome/Compute/issues/1354#issuecomment-6428977762

На базовом SHA READ_FINISH_CHECKPOINT при отсутствии SQL record/intent возвращает PENDING_COMMIT с git_readback.state=COMMITTED, если Git уже завершён. Observer в `native-coding-project-commits.mjs` допускает первый FINISH только при физическом NOT_ATTEMPTED и сохраняет READBACK_REQUIRED для COMMITTED. Это корректный HOLD по текущему контракту, но незакрытая граница автоматического продолжения.

Host FINISH сейчас проверяет Git receipt и сохраняет intent до SQL-эффекта. Не расширять NOT_ATTEMPTED до общего разрешения повторять действия. Сначала независимо воспроизведите точный crash interval и проверьте имеющиеся COMMIT/READ/RECONCILE API.

## Делегированное владение

- `apps/metaengine-browser/src/native-coding-project-commits.mjs`;
- `infra/client-state-runtime/native-coding-host-commit-service.mjs`;
- их соответствующие focused tests;
- новые явно названные checkpoint-reconciliation fixture/integration tests;
- отчёт `docs/audits/preinstall-git-sql-reconciliation-20261027.md`.

Поток3 сохраняет свои четыре source modules (client-native-coding-goal, autonomous-project-host/journal/task-runtime) и useful-work harness. Не изменяйте их параллельно: опубликуйте API/receipt contract в #1357 и #1354.

Если требуется дополнительная операция private Host capability/IPC, сначала укажите точные общие allowlist/wiring files и минимальный diff через DEPENDENCY_REQUEST в #1354. Координатор владеет общими entrypoints/SQL migrations/producer/package/seals; не расширять публичный RPC или полномочия транспорта.

## Работа и критерии приёмки

1. Реальный disposable Git repository и дочерний процесс: остановить процесс после сохранения Git receipt и изменения ref, но до SQL-finalize intent. Зафиксировать неизменные checkpoint/profile/operator/workspace/ref/index pins.
2. При restart независимо прочитать commit object/tree, exact ref и index, protected Git intent/receipt и актуальную Host/operator authority. Не принимать receipt JSON сам по себе за физическое readback.
3. Доказать одновременно отсутствие защищённого SQL intent и authoritative SQL commit/receipt. Ошибка чтения, unknown journal, чужой/изменённый путь или неопределённый SQL outcome означают HOLD. Существующий intent, даже при отсутствии SQL row, не является разрешением повторить write.
4. Реализовать отдельный узкий переход к первой SQL-finalization. Durable intent появляется до этой SQL-операции; observer READ остаётся read-only. Допустимый SQL effect не должен повторять update-ref/commit или использовать общую retry-политику.
5. Доказать ровно одну SQL-finalization и не более одного successor; после restart ни одного дополнительного update-ref. Проверить crash и потерянный ACK до/после intent, конкурентные observer/Host запросы, повтор selector и второй restart.
6. Отрицательные controls: unknown/existing SQL intent, чужой ref, изменённые Git bytes/index/worktree, несовпавшие checkpoint/operator/Host pins, несовпавший SQL receipt, conflicting successor. Все сохраняют HOLD и нулевой повтор физического эффекта.
7. Положительный control должен реально проходить: zero-effect fake/fail-all implementation не считается исправлением. Source/component fixture и native disposable PG17 proof отчитать отдельно; Windows/installed proof не выводится из Linux fixture.

## Граница результата

Не повышать production/installed authority flags, не удалять fence для устранения HOLD и не превращать неизвестный результат в NOT_ATTEMPTED. Физическую qualification выполнять на disposable процессах/Git/PG, не на пользовательском Owner или рабочем репозитории.

Результат: независимое воспроизведение, узкий PR, versioned typed reconciliation contract и negative/real-crash evidence. Передать потоку3 точную операцию/receipt и условия безопасного вызова; его end-to-end useful-goal acceptance остаётся отдельной задачей.


## Общая база и координация

Репозиторий: https://github.com/PatrickFrome/Compute . Штаб: #1354.
**BASE_SHA / ANCHOR_SHA: `9d7527683060e314eb1d39fec9ce2304a57103c4`.**
PR base: `work/preinstall-closure-20261027`. Это расширение до семи рабочих потоков и одного координатора. Четыре предыдущих задания #1355–#1358 и их база сохраняются.

Работайте в отдельном worktree/checkout. До правок опубликуйте CLAIMED в своей issue: BASE_SHA, ветка, планируемые файлы. Выполняйте работу до проверяемого результата и открывайте draft PR в интеграционную ветку. Самостоятельно PR не сливайте. Вне своей области оставляйте DEPENDENCY_REQUEST в #1354 с точным путём, изменением и критерием приёмки; продолжайте независимую часть работы.

Прочитайте на базовом SHA `docs/audits/preinstall-closure-20261027.md` и исходный `coordination/operator-control/preinstall-five-streams-20261027.md`; актуальное расширение и исключения владения указаны в #1354 и этой issue. Число «пять» в первом документе описывает первую волну.

Координатор сохраняет владение Browser package.json/package-lock.json, версиями, reservation/history, closure manifest/seals, интеграцией и итоговой приёмкой. Версия `0.7.0-dev.1784381341133.1` уже потреблена; её нельзя пересобирать. Все installed consumers получают один immutable installer одного producer. Профильные тесты рабочей ветки и окончательный source seal после интеграции — разные проверки: worker не отключает seal и не меняет общий manifest ради зелёного CI.

Пользовательские Browser, Owner, PostgreSQL, Guardian и registry не являются тестовой средой. Физические проверки — только на disposable Windows и новых fixture-данных. Не ослабляйте RequireFreshInstall; не используйте старый uninstaller, широкие process kill, поддельные receipts или автоматический retry неоднозначного эффекта. Не публикуйте ключи, пароли, raw payloads или содержимое пользовательских данных.

## Формат результата

В issue фиксируйте STATUS (CLAIMED / IN_PROGRESS / BLOCKED / READY_FOR_REVIEW), BASE_SHA, HEAD_SHA, BRANCH, PR, FILES, точные команды, PASS/FAIL/SKIP, ссылки на CI/artifacts, source/version/run/attempt и hashes где применимо. Разделяйте наблюдения и гипотезы. Указывайте оставшиеся неизвестные и следующий безопасный шаг. DONE/ACCEPTED ставит координатор после приёмки.

Между чатами нет автоматического обмена памятью: решения и зависимости передаются через GitHub. Если доступа к записи нет, подготовьте патч и Markdown-отчёт координатору; не утверждайте, что issue comment или PR опубликованы.

## Первые действия

1. Прочитай #1354, #1357 и #1362, включая свежие комментарии. Опубликуй CLAIMED с BASE_SHA, BRANCH и точными файлами; проверь, что их не занял другой поток.
2. Создай отдельный worktree/checkout от указанного SHA. Не переключай, не очищай и не изменяй чужой рабочий каталог.
3. Независимо воспроизведи crash gap и текущий безопасный HOLD. Зафиксируй узкий контракт перехода до правок общего IPC/wiring.
4. Реализуй и проверь свою часть; открой draft PR в интеграционную ветку. Передай потоку3 конкретные API/receipts через GitHub и явно назови оставшиеся physical prerequisites.
5. READY_FOR_REVIEW сопровождается HEAD_SHA, точными командами, результатами и отрицательными controls. Координатор выполняет интеграцию, source seal и итоговую приёмку.
