# METAENGINE — поток 3 из четырёх рабочих потоков

Ты — отдельный рабочий поток разработки METAENGINE. Главный чат является пятым потоком и координатором интеграции. Выполни задачу ниже: исследуй, внеси необходимые исправления в своей ветке, проверь их и передай результат через GitHub. Не ограничивайся предложением плана.

**Репозиторий:** https://github.com/PatrickFrome/Compute

**Твоя задача:** https://github.com/PatrickFrome/Compute/issues/1357

**Координация и точный ANCHOR_SHA:** https://github.com/PatrickFrome/Compute/issues/1354

**Твоя ветка:** `work/preinstall-continuity-20261027`

**PR base:** `work/preinstall-closure-20261027`

Прочитай issue #1354 и возьми полный ANCHOR_SHA из её текущего закреплённого состояния. Он включает уже проверенные исправления поверх `58fadfb354375ba8af4bd9249a459b5b2a8d9f46`. Не используй старую локальную ветку вместо этой базы. Если ANCHOR_SHA или GitHub недоступен, сообщи точный блокер; не придумывай состояние репозитория. У каждого потока должен быть собственный worktree/checkout.

## Задача

Закрыть проверяемую цепочку useful goal → workers → независимый Critic → Host commit/checkpoint → successor → restart без повторения выполненных эффектов. Ветка: `work/preinstall-continuity-20261027`.

## Наблюдаемые факты

Общая база уже корректно сообщает REJECTED_BEFORE_DISPATCH и сохраняет terminal journal/no replay; admission/journal/soak regression дал 76 PASS. Это не доказывает автономное полезное выполнение и физическую непрерывность после перезапуска. Старые local CHECKPOINT и source CI не считать подтверждением нового установленного кандидата.

## Область

`src/client-native-coding-goal.mjs`, `src/autonomous-project-host.mjs`, `src/autonomous-project-journal.mjs`, `src/autonomous-project-task-runtime.mjs`, их тесты/фикстуры в `apps/metaengine-browser`; новый continuation acceptance harness. Общие startup, SQL runtime/ACL, package/workflow/seal файлы менять через запрос координатору; не захватывать soak/migration/UI области.

## Работа и приёмка

1. Найти самый короткий реальный вертикальный сценарий с проверяемым полезным результатом в disposable workspace и независимой оценкой Critic.
2. Связать goal/request/worker/Critic/checkpoint/successor identity и доказательства. Advisory skills не получают полномочия или evaluator credit без требуемых approved capsules.
3. Исправить доказанные разрывы; проверить отказ до dispatch, crash до/после записи эффекта, конфликт/дубликат successor и restart без replay.
4. Дать один воспроизводимый acceptance entrypoint, явный ledger с результатом/хешем и сохранением обязательного HOLD при неоднозначном эффекте.
5. Source/fixture proof и installed/physical proof отчитать отдельно. Финальную installed проверку привязать к выданному координатором installer; отсутствующие credentials/capsules назвать prerequisites, не подменять fake PASS.

Результат: PR и воспроизводимый сценарий непрерывности с отрицательными контролями и доказательством полезного результата.

## Общий протокол

Координация: #1354. База — точный ANCHOR_SHA из #1354, ветка интеграции `work/preinstall-closure-20261027`. Начните с чтения `docs/audits/preinstall-closure-20261027.md` и `coordination/operator-control/preinstall-five-streams-20261027.md` на этом SHA.

Создайте отдельный worktree/checkout и свою ветку. В этой issue запишите CLAIMED, базовый SHA, ветку и перечень файлов до изменений. Draft PR направляйте в интеграционную ветку; самостоятельно не сливайте PR. Общие entrypoints и файлы вне своей области меняются только после DEPENDENCY_REQUEST в #1354. Не меняйте существующие чужие рабочие каталоги.

Координатор владеет Browser package.json/package-lock.json, package reservation/version/history, closure manifest/seals, общими release/producer workflows и интеграционной веткой. Не пересобирайте и не используйте повторно `0.7.0-dev.1784381341133.1`. Финальный installer выпускается централизованно один раз для одного SHA; старый artifact не квалифицирует новые bytes.

Не устанавливайте Browser на пользовательский ПК; не трогайте его Owner/PGDATA/Guardian/registry. Физические тесты — только disposable Windows. Не ослабляйте RequireFreshInstall, не подменяйте доказательства фикстурами, не повторяйте неоднозначные внешние эффекты, не используйте старый uninstaller или широкое завершение процессов. Секреты не публиковать.

Отчёт в issue: STATUS (CLAIMED / IN_PROGRESS / BLOCKED / READY_FOR_REVIEW), BASE_SHA, HEAD_SHA, BRANCH, PR, изменённые файлы, точные команды и результаты, ссылки на runs/artifacts с SHA-256 где применимо, оставшиеся неизвестные и следующий шаг. Успехи тестов, работа installer и автономность — разные уровни доказательства. При внешнем блокере приложите воспроизводимые факты и безопасный следующий шаг; не объявляйте DONE без критерия приёмки.

## Начало работы

1. Прочитай координационную issue и указанные документы на точном ANCHOR_SHA.
2. Проверь `git status`, создай отдельную ветку/worktree и убедись, что HEAD совпадает с базой.
3. Напиши CLAIMED в своей issue: BASE_SHA, BRANCH и список планируемых файлов.
4. Выполняй работу по приёмке, сохраняя доказательства и явно отмечая внешние зависимости.
5. Открой draft PR в `work/preinstall-closure-20261027`; оставь ссылку, HEAD_SHA и отчёт в своей issue. Координатор выполняет интеграцию и закрывает задачу.

Отдельные чаты не обмениваются памятью автоматически. Все существенные решения, запросы к другим потокам и результаты должны быть в соответствующей GitHub issue/PR. Если у тебя нет права записи в GitHub, подготовь точный патч и Markdown-отчёт для передачи координатору; не утверждай, что PR или комментарий опубликован.
