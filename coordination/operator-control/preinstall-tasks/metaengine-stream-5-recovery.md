# METAENGINE — поток 5 из семи рабочих потоков

Ты — отдельный рабочий поток разработки METAENGINE. Главный чат координирует интеграцию; всего предусмотрены семь рабочих потоков и координатор. Выполни задачу ниже: исследуй, создай необходимые изменения и проверки в собственной ветке и передай проверяемый результат через GitHub. Не ограничивайся планом.

**Репозиторий:** https://github.com/PatrickFrome/Compute

**Твоя issue:** https://github.com/PatrickFrome/Compute/issues/1360

**Координация:** https://github.com/PatrickFrome/Compute/issues/1354

**Твоя ветка:** `work/preinstall-recovery-20261027`

**Общий BASE_SHA:** `9d7527683060e314eb1d39fec9ce2304a57103c4`

**PR base:** `work/preinstall-closure-20261027`

## Задача

Добавить физическую квалификацию recovery bundle на двух новых disposable PostgreSQL 17-кластерах: logical dump, отдельно защищённый vault key и manifest. Доказать восстановление содержимого, состояния sequence и расшифрование fixture-значения после cold restart.

Ветка: `work/preinstall-recovery-20261027`.

## Почему это отдельный незакрытый шаг

На базовом SHA `disposable-pg17-logical-restore.integration.test.mjs` восстанавливает одну тестовую таблицу с тремя строками. Dump executor использует `--no-owner --no-acl`; файл `rollback-preserved.bin` является тестовым маркером. Этот сценарий не доказывает recovery внешнего `client-vault.key`, зашифрованного содержимого, sequence state и прав доступа. Это пробел доказательства, а не установленная потеря данных.

## Владение файлами

Предпочтительно новые файлы:
- `infra/client-state-runtime/test/disposable-recovery-bundle.mjs`;
- `infra/client-state-runtime/disposable-recovery-bundle.integration.test.mjs`;
- `.github/workflows/client-disposable-recovery-bundle.yml`;
- при необходимости узкий test validator и отчёт `docs/audits/preinstall-stream5-recovery-20261027.md`.

Использовать существующие `owned-postgres-process.mjs`, `local-vault-key.mjs`, backup effect fence, dump executor и backup/restore gates без изменения их authority. Изменения в них сначала согласовать через DEPENDENCY_REQUEST. Не менять migration files потока2, autonomous host потока3, UI потока4 и producer потока6.

## Работа и критерии приёмки

1. Использовать закреплённые PG17 binaries, новые каталоги и loopback ports. Создать fixture-данные Unicode/null/binary, нетривиальную sequence и зашифрованное значение через существующий vault mechanism.
2. Сделать custom-format dump однократно через имеющийся effect fence. Отдельно сохранить только созданный для fixture key; проверить настоящую Windows DACL, целостность manifest и hashes. Не печатать key, пароль, plaintext или SQL rows.
3. Восстановить во второй физически отдельный PG17 с другим system_identifier/PID/PGDATA/port. Независимо сравнить содержимое и sequence; доказать расшифрование.
4. Штатно остановить второй PG, снова запустить и повторить readback. Подтвердить неизменность исходного кластера и key, остановку обоих postmasters и освобождение портов.
5. Отрицательные случаи: усечённый/подменённый dump; отсутствующий/подменённый key; неверный manifest; restore в source PGDATA/port; junction/hardlink; потерянный ACK после backup; одинаковое количество строк при изменённом содержимом; неизвестный cleanup. Ошибка/неизвестность не превращаются в PASS и не запускают автоматический retry.
6. Явно описать предел `--no-owner --no-acl`. Если проверяется восстановление ACL, делать это отдельно и подтверждать SQL readback; не считать их перенесёнными dump автоматически.

## Граница результата

PASS означает только физически проверенный механизм recovery на disposable данных. Сохраняются `installed_owner_touched=false`, `installed_backup_verified=false`, `upgrade_authorized=false`, `production_authorized=false`, `automatic_retry_allowed=false`. Не выставлять physical_restore_proven в production gate по synthetic fixture. Реальный backup пользовательского Keeper и его независимая проверка остаются отдельным входом перед установкой.

Результат: проверяемый PR, воспроизводимый Windows entrypoint, положительные/отрицательные доказательства и очищенный от секретов receipt.

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

1. Прочитай #1354 и свою issue; проверь новые комментарии и зависимости. Общая исходная точка остаётся указанным полным SHA, даже если документация или ветка интеграции уже продвинулась.
2. Проверь доступ к репозиторию и чистоту выбранного checkout. Создай отдельный worktree/ветку от BASE_SHA; не переключай и не очищай чужой рабочий каталог.
3. Напиши CLAIMED в своей issue и перечисли планируемые файлы. При отсутствии доступа сообщи конкретный блокер, не придумывая состояние репозитория.
4. Выполняй работу, публикуй существенные результаты/блокеры и открой draft PR в интеграционную ветку. Сообщи HEAD_SHA, команды и доказательства, не скрывай SKIP или недостающие prerequisites.
5. Оставь READY_FOR_REVIEW только с проверяемым результатом; source-ready и physical/installed-qualified указывай отдельно. Интеграцию, package producer и закрытие задачи выполняет координатор.
