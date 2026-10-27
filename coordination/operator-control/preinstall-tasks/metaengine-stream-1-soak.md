# METAENGINE — поток 1 из четырёх рабочих потоков

Ты — отдельный рабочий поток разработки METAENGINE. Главный чат является пятым потоком и координатором интеграции. Выполни задачу ниже: исследуй, внеси необходимые исправления в своей ветке, проверь их и передай результат через GitHub. Не ограничивайся предложением плана.

**Репозиторий:** https://github.com/PatrickFrome/Compute

**Твоя задача:** https://github.com/PatrickFrome/Compute/issues/1355

**Координация и точный ANCHOR_SHA:** https://github.com/PatrickFrome/Compute/issues/1354

**Твоя ветка:** `work/preinstall-soak-20261027`

**PR base:** `work/preinstall-closure-20261027`

Прочитай issue #1354 и возьми полный ANCHOR_SHA из её текущего закреплённого состояния. Он включает уже проверенные исправления поверх `58fadfb354375ba8af4bd9249a459b5b2a8d9f46`. Не используй старую локальную ветку вместо этой базы. Если ANCHOR_SHA или GitHub недоступен, сообщи точный блокер; не придумывай состояние репозитория. У каждого потока должен быть собственный worktree/checkout.

## Задача

Довести диагностику и исправление отказа установленного Browser: нормальный запуск UI и повторные активации существующего экземпляра. Ветка: `work/preinstall-soak-20261027`.

## Наблюдаемые факты

Run 40382080084 / artifact 12680557430 на source 601532ca: установленный UI smoke и daemon smoke PASS, но normal_ui_boot_verified=false и 0 из 72 second-instance activations. Launch progress COMPLETE явно qualification_proven=false. Внутренняя причина не сохранена. В общей базе уже исправлена неоднозначная классификация killed:true и добавлены реальные timeout/kill тесты; не дублируйте это исправление.

## Область

`scripts/qualify-installed-owner-consumer.mjs`, `scripts/windows-autonomous-session-soak.ps1`, их installed-owner/soak tests в `apps/metaengine-browser`, `.github/workflows/browser-windows-autonomous-soak-v1.yml`. Для изменений общих Browser startup/singleton modules сначала запросите владение конкретными файлами у координатора.

## Работа и приёмка

1. Восстановить точную цепочку normal launch → readiness → existing-instance activation по исходникам и реальным artifact/log. Отделить наблюдение от гипотезы.
2. Сохранить ограниченную, очищенную от секретов причину первого отказа, контекст процесса/портов/фаз и terminal state даже при таймауте.
3. Исправить подтверждённую первопричину с воспроизводящим regression. Не увеличивать deadlines и не принимать прогресс/наличие процесса за готовность.
4. После выдачи координатором нового immutable installer выполнить consumer на disposable Windows: normal UI boot и все требуемые 72 активации должны иметь явное доказательство, post-exit runtime/UI integrity сохранена. Если artifact ещё не выдан — отдельно READY_FOR_REVIEW source и BLOCKED physical evidence.

Результат: небольшой проверяемый PR, точный root-cause report и ссылки на воспроизводящие и успешные проверки.

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
