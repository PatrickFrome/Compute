# METAENGINE — поток 7 из семи рабочих потоков

Ты — отдельный рабочий поток разработки METAENGINE. Главный чат координирует интеграцию; всего предусмотрены семь рабочих потоков и координатор. Выполни задачу ниже: исследуй, создай необходимые изменения и проверки в собственной ветке и передай проверяемый результат через GitHub. Не ограничивайся планом.

**Репозиторий:** https://github.com/PatrickFrome/Compute

**Твоя issue:** https://github.com/PatrickFrome/Compute/issues/1362

**Координация:** https://github.com/PatrickFrome/Compute/issues/1354

**Твоя ветка:** `work/preinstall-authority-20261027`

**Общий BASE_SHA:** `9d7527683060e314eb1d39fec9ce2304a57103c4`

**PR base:** `work/preinstall-closure-20261027`

## Задача

Создать сквозной integration harness для реальной цепочки private Host IPC → подписанный device request → текущий ADMIN grant/epoch → Host seed service → disposable PG17. Доказать отказ без нового admission при отзыве прав, замене Host и подмене profile/device binding.

Ветка: `work/preinstall-authority-20261027`.

## Конкретный пробел и граница вывода

На базовом SHA `native-coding-host-ipc.test.mjs` уже проверяет настоящий parent/child IPC с fixture operations, в том числе replay/timeout/oversize/foreign frames. `native-coding-host-seed-binding.test.mjs` использует настоящие подписи, но generated grants/storage ACL/seed operations и fakeService. Device verifier читает текущий grant, затем seed service входит в serializable transaction и native_coding_seed_goal_v1.

Нужно проверить совместную границу при изменении grant/epoch/Host между этими стадиями. Это acceptance gap в рассмотренных тестах, не установленный exploit. Не дублировать существующий transport fuzz и не объявлять уязвимость без воспроизведения.

## Владение файлами

Только новые файлы:
- `infra/client-state-runtime/preinstall-native-authority-negative.integration.test.mjs`;
- `infra/client-state-runtime/test/preinstall-native-authority-negative/**`;
- `docs/audits/preinstall-native-authority-negative-20261027.md`.

Core runtime-host, device verifier, binding/service, общие workflows и package/lock/seals остаются у координатора. Goal/journal/continuity принадлежат потоку3 (#1357). Для core fix или включения нового test в общий native CI — воспроизводящий test и DEPENDENCY_REQUEST в #1354. Не занимать soak/migration/UI/backup/producer области других потоков.

## Реальная композиция

Использовать штатные createNativeCodingHostIpcServer/Client, createNativeCodingDeviceRequestVerifier, authenticated request context, Host seed binding со штатным seed service, SupervisorDeviceIdentity/signNativeCodingDeviceRequest и настоящий native PG17. Опирайтесь на имеющийся first-owner enrollment/withFreshOwnerNativeFixture; проверьте реальные exports прежде, чем выносить общий helper. Кластеры, identities и profiles — только новые disposable fixtures.

## Обязательные критерии приёмки

1. Положительный read-only control: подписанный LIST_SEEDS проходит для текущих owner/profile/Host. Тест, где всё всегда отказывает, не является доказательством.
2. Revocation race: отдельная SQL-сессия отзывает ADMIN/pairing или меняет grant epoch после проверки подписи и до admission. Детерминированный barrier задерживает реальный запрос; SQL result и service не подменяются fake-результатами. Фиксируйте COMMIT отзыва и границу admission/линеаризации: перекрывающиеся транзакции оценивайте по реальному контракту, не называйте уязвимостью запрос, уже допущенный до отзыва.
3. Host replacement: запрос, подписанный для прежнего host_instance_id/PID, не допускается после реального создания нового Host.
4. Identity separation: параллельные подписанные вызовы двух identities с одной отозванной/неверно привязанной; нет переноса identity/epoch между AsyncLocalStorage contexts.
5. Правильная подпись с чужим profile/device/key binding отклоняется до goal admission.
6. После каждого negative control независимое второе SQL connection подтверждает отсутствие новых goal/task/permit/execution admissions. Одного exception или authority_effect:false недостаточно.
7. Все обязательные Windows/native controls действительно исполнены. Недоступный PG17/native prerequisite — BLOCKED, не зелёный skip. Доказать штатную очистку только fixture-процессов/портов.

Для этих negatives не нужны настоящие model credentials или полезное выполнение цели. Вывод не содержит DSN, ключей, паролей, raw SQL errors или пользовательских данных.

## Результат

Проверяемый PR с воспроизводимым harness, положительным control, отрицательной матрицей и независимым SQL readback. Подтверждённый дефект описывается с точным местом и regression; основной fix проходит через координатора. Source/disposable proof отдельно от installed acceptance: финальная installed проверка привязывается к тому же immutable artifact центрального producer. Не повышать authority/production flags на основании fixture.


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
