# METAENGINE — поток 4 из четырёх рабочих потоков

Ты — отдельный рабочий поток разработки METAENGINE. Главный чат является пятым потоком и координатором интеграции. Выполни задачу ниже: исследуй, внеси необходимые исправления в своей ветке, проверь их и передай результат через GitHub. Не ограничивайся предложением плана.

**Репозиторий:** https://github.com/PatrickFrome/Compute

**Твоя задача:** https://github.com/PatrickFrome/Compute/issues/1358

**Координация и точный ANCHOR_SHA:** https://github.com/PatrickFrome/Compute/issues/1354

**Твоя ветка:** `work/preinstall-ui-20261027`

**PR base:** `work/preinstall-closure-20261027`

Прочитай issue #1354 и возьми полный ANCHOR_SHA из её текущего закреплённого состояния. Он включает уже проверенные исправления поверх `58fadfb354375ba8af4bd9249a459b5b2a8d9f46`. Не используй старую локальную ветку вместо этой базы. Если ANCHOR_SHA или GitHub недоступен, сообщи точный блокер; не придумывай состояние репозитория. У каждого потока должен быть собственный worktree/checkout.

## Задача

Проверить пользовательский UI-путь и неизменность packaged runtime, закрыть подтверждённые дефекты до установки. Ветка: `work/preinstall-ui-20261027`.

## Наблюдаемые факты

Старые FULL_CODE_AUDIT/UI_DEPENDENCY_REFRESH дополнены UI_PRISMA_ORPHAN_REMOVAL, OFFLINE_BUILD_PRIVACY и UI_RUNTIME_IMMUTABILITY. Установленный UI smoke старого601532ca PASS; это не proof будущего installer. Известна отдельная несовместимость explicit Bun override; packaged default использует Node. На ПК ME2_UI_BIN override не обнаружен. Deprecated npm WARN сами по себе не устанавливают security blocker.

## Область

`apps/me2-ui/**`, новые UI acceptance/immutability tests и отдельный отчёт об применимости зависимостей. Browser startup/packaging scripts, Browser package.json/package-lock.json, общий producer и seals принадлежат координатору. Изменения shared paths — через #1354.

## Работа и приёмка

1. Проверить путь открытия UI, подключения к локальному Owner и отображения состояния/ошибок/результата полезной задачи на доступном изолированном окружении; не считать один HTTP 200 полной приёмкой.
2. Установить отсутствие неожиданных runtime downloads, автообновлений agent и записи cache/build файлов в immutable packaged UI; сравнить полный inventory до/после запуска и выхода.
3. Проверить воспроизводимый offline build и default embedded Node. Явно отделить неподдержанный override от дефекта default path.
4. Проверить применимость уже известных dependency findings к pinned production/build graph по primary advisories. Без массового обновления зависимостей и без отправки private lockfile metadata в bulk audit. Исправлять только установленный дефект с тестом.
5. Финальные выводы о packaged UI привязать к exact source и одному installer центрального producer. До его выдачи — отдельные source результаты и честный BLOCKED для физической проверки.

Результат: PR при необходимых изменениях, UI acceptance evidence, inventory hashes и короткая таблица actual blocker / закрыто / неприменимо / maintenance debt с источниками.

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
