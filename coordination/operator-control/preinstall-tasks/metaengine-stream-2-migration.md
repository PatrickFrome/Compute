# METAENGINE — поток 2 из четырёх рабочих потоков

Ты — отдельный рабочий поток разработки METAENGINE. Главный чат является пятым потоком и координатором интеграции. Выполни задачу ниже: исследуй, внеси необходимые исправления в своей ветке, проверь их и передай результат через GitHub. Не ограничивайся предложением плана.

**Репозиторий:** https://github.com/PatrickFrome/Compute

**Твоя задача:** https://github.com/PatrickFrome/Compute/issues/1356

**Координация и точный ANCHOR_SHA:** https://github.com/PatrickFrome/Compute/issues/1354

**Твоя ветка:** `work/preinstall-migration-20261027`

**PR base:** `work/preinstall-closure-20261027`

Прочитай issue #1354 и возьми полный ANCHOR_SHA из её текущего закреплённого состояния. Он включает уже проверенные исправления поверх `58fadfb354375ba8af4bd9249a459b5b2a8d9f46`. Не используй старую локальную ветку вместо этой базы. Если ANCHOR_SHA или GitHub недоступен, сообщи точный блокер; не придумывай состояние репозитория. У каждого потока должен быть собственный worktree/checkout.

## Задача

Реализовать недостающую проверку полного ручного перехода старой установки на новый immutable installer с сохранением Owner и работающего PostgreSQL. Ветка: `work/preinstall-migration-20261027`.

## Наблюдаемые факты

RequireFreshInstall намеренно отказывает при существующей установке. Старый automatic self-update run 40382080162 не сохранил durable successor receipt; exit 23 для него — гипотеза, а не зафиксированный факт. Новая общая база уже содержит bounded failed-path diagnostics и проверки восьми physically disjoint preserved inputs (44 Windows policy tests). Это не доказательство полного NSIS/registry/keeper перехода.

## Область

`qa-forward-install*.mjs`, `qa-forward-registration.ps1` и соответствующие tests в `apps/metaengine-browser`; новый изолированный physical harness и отдельный manual-forward consumer workflow. Существующие installer gates, main/entrypoint, producer, package identity и общие closure records принадлежат координатору.

## Работа и приёмка

1. Создать disposable Windows fixture с закреплённым predecessor, настоящими NSIS/Owner/PG, пустой тестовой схемой и sentinel rows; ни одной ссылкой не обращаться к установленным пользовательским данным.
2. Выполнить prepareForwardInstall → installForwardQualified на одном candidate/installer, полученном от центрального producer. Уточнить источник candidateRoot: сейчас producer может не публиковать win-unpacked. Любой недостающий artifact запросить через #1354, не делать второй producer.
3. Доказать сохранность PGDATA/инкарнации/данных и vault, exact registry/payload readback, соответствие Owner/config/status/gate/admission; затем clean shutdown и restart continuity.
4. Проверить containment/junction/hardlink, изменение файлов после проверки и неизвестный installer/publication outcome: HOLD без ложного completion и автоматического retry.
5. Отдельно записать оставшийся контракт automatic N→N+1 self-update. Успех manual migration не объявлять успехом автоматического обновления; RequireFreshInstall не ослаблять.

Результат: PR с настоящим composition harness, отрицательными проверками и artifact-bound evidence либо точным внешним блокером.

## Общий протокол

Координация: #1354. База — точный ANCHOR_SHA из #1354, ветка интеграции `work/preinstall-closure-20261027`. Начните с чтения `docs/audits/preinstall-closure-20261027.md` и `coordination/operator-control/preinstall-five-streams-20261027.md` на этом SHA.

Создайте отдельный worktree/checkout и свою ветку. В этой issue запишите CLAIMED, базовый SHA, ветку и перечень файлов до изменений. Draft PR направляйте в интеграционную ветку; самостоятельно не сливайте PR. Общие entrypoints и файлы вне своей области меняются только после DEPENDENCY_REQUEST в #1354. Не меняйте существующие чужие рабочие каталоги.

Координатор владеет Browser package.json/package-lock.json, package reservation/version/history, closure manifest/seals, общими release/producer workflows и интеграционной веткой. Не пересобирайте и не используйте повторно `0.7.0-dev.1784381341133.1`. Финальный installer выпускается централизованно один раз для одного SHA; старый artifact не квалифицирует новые bytes.

Не устанавливайте Browser на пользовательский ПК; не трогайте его Owner/PGDATA/Guardian/registry. Физические тесты — только disposable Windows. Не ослабляйте RequireFreshInstall, не подменяйте доказательства фикстурами, не повторяйте неоднозначные внешние эффекты, не используйте старый uninstaller или широкое завершение процессов. Секреты не публиковать.

Отчёт в issue: STATUS (CLAIMED / IN_PROGRESS / BLOCKED / READY_FOR_REVIEW), BASE_SHA, HEAD_SHA, BRANCH, PR, изменённые файлы, точные команды и результаты, ссылки на runs/artifacts с SHA-256 где применимо, оставшиеся неизвестные и следующий шаг. Успехи тестов, работа installer и автономность — разные уровни доказательства. При внешнем блокере приложите воспроизводимые факты и безопасный следующий шаг; не объявляйте DONE без критерия приёмки.

## Уточнение входов и физической фикстуры

Требуемый producer sidecar: полное win-unpacked tree/inventory, source/version/run/attempt, installer/ASAR/runtime SHA и SHA NSIS-generated uninstaller, прочитанный после fresh install этим producer. Его добавляет координатор в общий producer; worker2 формулирует точный входной контракт и consumer. PG executable и PGDATA должны находиться вне перемещаемого installed image и migration state. Проверенный pinned runtime копируется в disposable внешний каталог до запуска postmaster; inventory копии сверяется. Predecessor выбирается по конкретной современной offline source/version/hash, не latest и не старому hosted-default клиенту. Настоящие STOPPED/Owner receipts создаются штатным runtime/provisioning path. Отсутствующий predecessor/sidecar — явный BLOCKED, без подделки доказательств.

## Начало работы

1. Прочитай координационную issue и указанные документы на точном ANCHOR_SHA.
2. Проверь `git status`, создай отдельную ветку/worktree и убедись, что HEAD совпадает с базой.
3. Напиши CLAIMED в своей issue: BASE_SHA, BRANCH и список планируемых файлов.
4. Выполняй работу по приёмке, сохраняя доказательства и явно отмечая внешние зависимости.
5. Открой draft PR в `work/preinstall-closure-20261027`; оставь ссылку, HEAD_SHA и отчёт в своей issue. Координатор выполняет интеграцию и закрывает задачу.

Отдельные чаты не обмениваются памятью автоматически. Все существенные решения, запросы к другим потокам и результаты должны быть в соответствующей GitHub issue/PR. Если у тебя нет права записи в GitHub, подготовь точный патч и Markdown-отчёт для передачи координатору; не утверждай, что PR или комментарий опубликован.
