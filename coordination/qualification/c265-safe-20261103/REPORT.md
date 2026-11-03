# METAENGINE c265 source only qualification

Статус полной квалификации: **HOLD / INCOMPLETE**. Переносимые проверки выполнены; реальная установка, upgrade, Windows native ACL/SCM/pipe/Job/WTS, физическое восстановление PostgreSQL и первое реальное задание не выполнялись. Продуктовая authority, подписи и защитные условия не изменялись.

## Проверенная исходная база

Получен точный публичный transfer commit `accb28e72c87c059e780efb8e6681886b33e9b4f` в ветке `work/source-transfer-c26565e-20261103` репозитория PatrickFrome/Compute. [Части архива и README](https://github.com/PatrickFrome/Compute/tree/accb28e72c87c059e780efb8e6681886b33e9b4f/coordination/source-transfer/c26565e).

`archive.part00`, `archive.part01`, `archive.part02` соединены в этом порядке. Фактический SHA256 `4200e492828dbb857aaa737a7ce56d0aeda3c97c84f7743b1501ef2f229d3636` совпал. ZIP проверен на выход пути и symlinks; распакован отдельно. Фактическое исходное Git tree `2dbe253e97379532f6f4b52ef7edf26109a9266d` совпало. Это цельный снимок c26565e58ab92dcbcda9663c4d231bdf4a9a7ee6; прежние четыре патча **не применялись**.

В исходниках отсутствуют `.agents/skills`, `AGENTS.md` и `SKILL.md` (проверено рекурсивно). Для source-runner создан локальный восстановленный commit `42419989870759b3b9033b3bb39bea8b0b68b26d`; он не выдаётся за оригинальную историю или source revision.

Среда: Linux x86_64, Node v24.19.0, Python 3.12.14, g++ Debian 14.2.0. Инструменты не устанавливались. Прежний блокер Library не повторялся и не обходился: использован новый явно разрешённый Git-маршрут.

## Изменения

- `native-coding-initial-setup-main.test.mjs`: вместо проверки только UI флага добавлены поведенческие отказы BEGIN при утрате auth, смене account/ADMIN/path/HEAD до и во время pending root preparation; no-selection, ACL preparation rejection, HOLD/AMBIGUOUS и сохранение selection IDs после restart. Существующий controller/валидаторы настоящие, effect boundaries явно моделируются.
- `qa-disposable-image-restore.test.mjs`: шесть негативных случаев сохранности existing receipt/prepared/quarantine, linked installed/snapshot и concurrent installed image. Только созданные временные файлы; UNKNOWN не превращается в rollback/replay.
- `safe-install-qualification.mjs`: Linux-only runner с фиксированным списком тестов, без arbitrary argv/globs/DB selectors. У каждого child отдельный disposable profile/temp и минимальный env без credentials, NODE hooks, PG selectors и sanitizer overrides. Caller env не изменяется. Выходные evidence создаются в новом каталоге, файлы — `wx`. Runner — не OS sandbox; запускаются только проверенные source/fixture suites.
- `safe-install-qualification.test.mjs`: ограничения argv/allowlist/environment, фактический child с hostile fixture env, отсутствие перезаписи evidence и ложного PASS по exit0/skips/TODO/cancel/missing summary.

Производственные файлы, root trust, release-signature verification, native gates и HOLD не менялись.

## Новый переносимый прогон

Команда из корня Compute:

```bash
node apps/metaengine-browser/test/safe-install-qualification.mjs --run
```

Runner создаёт новый каталог и печатает его путь в JSON; `--list` печатает план без запуска. Произвольные output/test/command аргументы отвергаются. Независимый root-прогон: **210 PASS, 0 FAIL, 2 Windows SKIP, 0 CANCEL, 0 TODO**, exit 0.

| Suite | PASS | FAIL | SKIP |
| --- | ---: | ---: | ---: |
| install-upgrade-model | 90 | 0 | 0 |
| disposable-image-restore | 10 | 0 | 0 |
| database-restore-guards | 65 | 0 | 0 |
| acl-contract | 7 | 0 | 2 |
| auth-first-task-admission-model | 38 | 0 | 0 |

Два SKIP: `Win32 real ACL protects fresh private directory and verifies inheriting config and copied Vault`; `Win32 DACL protection can repeat on existing private state without changing owner or group`. Их статус — Windows NOT RUN, не PASS. Физическая чистая установка/upgrade, native auth и Main launch, реальный PostgreSQL restore и первое реальное задание — отдельные NOT RUN. DB receipts/JSON и injected readbacks остаются неавторитетными; `production_qualified=false`.

Ограничение reporter: два ожидаемых ACL skip сверяются по количеству, а не по именам; фактические имена проверены в сохранённом TAP выше. Отдельных selftest для `cancelled:1` и поведенческого отказа на Windows нет; соответствующие guards присутствуют и проверены чтением кода.

Новые selftests и restore-тесты отдельно: `node --test --test-concurrency=1 --test-reporter=tap apps/metaengine-browser/test/safe-install-qualification.test.mjs apps/metaengine-browser/test/qa-disposable-image-restore.test.mjs` — 17 PASS, 0 FAIL/SKIP/CANCEL. Initial setup файл отдельно — 24 PASS, 0 FAIL/SKIP/CANCEL. Это пересекающиеся прогоны; числа не суммируются в общий счёт.

## Обязательные проверки

Все команды выполнялись из Compute, кроме syntax из apps/metaengine-browser. Полные команды и exit codes — `mandatory-command-results.json`, stdout — соответствующие logs.

| Проверка | Результат |
| --- | --- |
| verify-guardian-original-main-launch-source.py | 81 PASS / **1 FAIL**, exit 1 |
| verify-guardian-main-begin-model.py | 9 PASS; повтор с --sanitize 9 PASS |
| verify-guardian-main-owner-wait-model.py | 13 PASS; повтор с --sanitize 13 PASS |
| verify-guardian-requester-session-model.py | 15 PASS; повтор с --sanitize 15 PASS |
| original-main-launch-protocol + owner-loaded-read + native-ticket-enrollment-contract | 17 PASS, 0 FAIL/SKIP |
| node scripts/check-source.mjs | source_checks_passed:292 |
| verify-guardian-original-main-source.py --repo <Compute> --out <new-empty-dir> | 23 PASS / 0 FAIL / 5 NOT RUN, exit 0 |

Единственный FAIL `wire_route_authenticates_then_launches` сохранён: маршрут по-прежнему удерживается в `ORIGINAL_MAIN_SENDER_COMPOSITION_UNVERIFIED`; при отсутствии armed connection — `ORIGINAL_MAIN_SERVER_CHALLENGE_REQUIRED`. Этот сигнал не превращён в ожидаемый PASS и не скрыт runner. Native enrollment остаётся `LOCAL_OWNER_BRIDGE_REQUIRED`. Source-runner выполнен на чистом проверенном исходном tree; последующий patch меняет только четыре тестовых файла. ASAN/UBSAN модели прошли; leak sanitizer отдельно NOT RUN (runner отключает его на ptrace host).

Пять NOT RUN source-runner:

- `w77-pinned-openssl-regression`: Provide the acquired+extracted pinned OpenSSL 3.5.9 source with a completed static build.
- `w77-boringssl-regression`: Provide the exact pinned public source and its isolated static crypto build.
- `electron-source-interface`: Provide exact Electron and Node-after-Electron-patches source files.
- `official-electron-header-syntax`: Provide verified official Electron header archive and patched Node internal headers.
- `win64-cross-builds`: No existing cross compiler supplied; this runner never installs one.

Дополнительно NOT RUN: Windows execution, full custom Electron build, production Main launch grant, production release positive; loaded runtime code attestation и continuous code custody не доказаны. Системная libcrypto регрессия не подменяет pinned production OpenSSL/BoringSSL.

## Исходные удерживаемые объекты и оставшиеся границы

В production source launchSession дублирует из удерживаемых session objects исходные WTS user token и requester process (ограниченные права), сверяет PID/birth/SID/session и переносит исходный signed installed namespace. SCM удерживает RAII handles, original replacement callback, active loaded policy, original debug worker, Main process/thread, Job, entry pipe и retained image/file owners. Чтение состояния защищено mutex; source close ждёт исходный worker, затем освобождает coverage/pipe/package/policy/process/token/requester. Это анализ исходников и portable models, а не доказательство physical join на Windows.

Отдельно остаются: подлинная pre-Main sender composition и первый owner/native bridge; независимый original upgrade путь с сохранением данных; completion/recovery после durable barrier и неизвестного результата; реальная Windows долговечность записи/ACL/handle/WTS/Job гонки, logoff/cancel/timeout и измерение challenge deadline. После crash/неизвестной записи нельзя автоматически повторять effect или удалять barrier лишь по отсутствию PID. DISPATCHED/initial fence reply не доказывает client read, готовность UI или continuous code custody.

## Применимость патча

`metaengine-c265-safe-qualification.patch`: SHA256 **51b99155b63320ecf2950ff4de542d257fa7c864d2cbba0730416c9838322b1c**, 30830 bytes. Четыре файла, 419 insertions / 7 deletions. На отдельном чистом worktree исходной базы выполнены:

```bash
git apply --check --index metaengine-c265-safe-qualification.patch
git apply --index metaengine-c265-safe-qualification.patch
git write-tree
```

Обе операции exit 0. Tree после применения `74ac1ed259ccb6b8695a9ebf194e29bc0cb2c368` точно совпал с финальным рабочим index. `git diff --cached --check` прошёл. Контрольное tree `2dbe...` относится к базе **до** этого patch.

Patch распространяется как самостоятельный reviewable артефакт относительно c265 в `coordination/qualification/c265-safe-20261103/`; он не накладывается автоматически на другое дерево удалённой ветки. Общие ветки не изменялись; merge, установщик, службы и пользовательская БД не запускались.
