# METAENGINE проверка первичной авторизации Codex

Дата: 2026-11-03 UTC. Два независимых потока GPT-6.1 с reasoning max проверили реализацию и регрессии. Исправлены два дефекта локального координатора. Сквозной production login Codex остаётся HOLD: producer подтверждённой авторизации отсутствует. Реальные Windows, провайдерский отзыв и native restart не проверялись.

## Проверенная исходная база

- Публичный Git: `PatrickFrome/Compute`, ветка `work/source-transfer-c26565e-20261103`, получен точный commit `accb28e72c87c059e780efb8e6681886b33e9b4f` штатным Git fetch.
- Соединены `coordination/source-transfer/c26565e/archive.part00`, `archive.part01`, `archive.part02` в этом порядке. SHA256 совпал: `4200e492828dbb857aaa737a7ce56d0aeda3c97c84f7743b1501ef2f229d3636`.
- По метаданным источник — `c26565e58ab92dcbcda9663c4d231bdf4a9a7ee6`. В ZIP нет `.git`; точная историческая commit identity не реконструировалась. Проверено полное дерево: `2dbe253e97379532f6f4b52ef7edf26109a9266d`.
- База изолированно распакована в `Compute/`; старые e6→cd→d790→b524→c265 patch поверх неё не применялись. Локальный технический baseline commit — `6779cc33f2fc2781f0054b9a92135d49a261871e`, не оригинальная история.
- `AGENTS.md` и `.agents/skills` отсутствуют в точном snapshot. Установки, изменения служб, пользовательских ПК и БД, новые доверенные корни и ослабление защиты не выполнялись.

## Исправления

1. `apps/metaengine-browser/src/native-coding-initial-selection-contract.mjs:112`: при наблюдаемом AUTHENTICATED аккаунте A выбор B теперь отклоняется до allocator и writeOnce. Раньше он записывался навсегда и confirm мог рекламировать `can_begin:true`, хотя следующий snapshot показывал DRIFTED, а BEGIN отказывал. До исправления регрессия получала `write:1`, теперь `write:0`. Предварительный выбор до login при AUTHENTICATION_REQUIRED по-прежнему допустим и не даёт BEGIN.
2. `apps/metaengine-browser/src/native-coding-initial-setup-main.mjs:95`: оба ожидающих Host readback выполняются перед соответствующим свежим `current()/assertInitialNativeSetupEnvironmentCurrent`. Отзыв или смена аккаунта во время readback блокирует последующую подготовку каталогов либо provider/BEGIN. Раньше auth-check предшествовал readback, после которого проверялись лишь локальная отмена и общий lifetime. Приоритет отказа изменён: неизвестный readback может остановить вызов до auth-observation. Дополнительных expensive reads не добавлено.

Добавлены три самостоятельных test-файла: `native-coding-initial-auth-selection.test.mjs` (3), `native-coding-initial-auth-dispatch-race.test.mjs` (8), `native-coding-initial-auth-restart.test.mjs` (4). Они используют реальные contract/controller модули и генерируемые in-memory owners, детерминированные async-ворота и счётчики эффектов. Не используются credentials, сеть, БД, настоящий Codex или native процессы.

Изменены ровно пять source/test файлов; общая production Main wiring и существующие тесты не изменены. Патч: `codex-initial-auth-c265.patch`, SHA256 `30ad950804fcb9326d6cdab42876c1309386a455480cd350f74e06295fbed95f`. Итоговый source tree: `81b533622571c1b6e7509cbcfe7fa3b59452a17d`, локальный commit `9f5f744d442ad60003a66dcd6acb24c4d8c5e4c2`.

## Результаты

Node v24.19.0; Python 3.12.14; Git 2.52.0. Полные команды, exit-коды, счётчики и логи находятся в `RESULTS.json` и `evidence/`.

| Проверка | Результат |
| --- | --- |
| Новые регрессии на исходной базе | 5 FAIL: чужой account persisted и четыре revoke/account-switch окна. Положительные контроли проходили. |
| Финальные 9 файлов initial setup | 51 PASS, 0 FAIL, 0 SKIP; из них 15 новых тестов |
| Guardian protocol, loaded-read, native-ticket contracts | 17 PASS, 0 FAIL |
| `node scripts/check-source.mjs` | 292 PASS на финальном состоянии |
| `verify-guardian-original-main-launch-source.py` | 81 PASS, 1 FAIL: `wire_route_authenticates_then_launches`; намеренный HOLD не изменялся |
| `verify-guardian-main-begin-model.py` | 9 PASS, также с `--sanitize` |
| `verify-guardian-main-owner-wait-model.py` | 13 PASS, также с `--sanitize` |
| `verify-guardian-requester-session-model.py` | 15 PASS, также с `--sanitize` |
| Финальный `verify-guardian-original-main-source.py` | 23 PASS, 0 FAIL, 5 NOT RUN; подтверждён итоговый tree и чистое рабочее дерево |
| Независимая повторная распаковка и применение patch | SHA архива и patch, исходный tree, `git apply --check`, итоговый tree: PASS |
| `git diff --check` | PASS |

Пять NOT RUN расширенного source-runner:

1. `w77-pinned-openssl-regression`: нет точно закреплённого extracted OpenSSL 3.5.9 с готовой static build.
2. `w77-boringssl-regression`: нет точно закреплённого public source и изолированной static crypto build.
3. `electron-source-interface`: нет точных Electron и Node-after-Electron-patches исходных файлов.
4. `official-electron-header-syntax`: нет проверенного официального архива headers и patched Node internal headers.
5. `win64-cross-builds`: нет существующего cross compiler; ничего не устанавливалось.

Внутри Node source regressions ещё один тест SKIP (не квалифицирован этим host). LeakSanitizer отключён на ptrace host. Windows execution, полный custom Electron build, production Main launch grant, production positive release и continuous code custody остаются NOT RUN/недоказанными. Модели с ASAN/UBSAN не заменяют Windows-квалификацию.

## Подтверждённые разрывы

| Область | Основание и предел результата |
| --- | --- |
| Первичная авторизация | `src/main.mjs:1310`: `readCodexAuth = async () => null`. `native-coding-initial-setup-composition.mjs:103` переводит это в AUTHENTICATION_REQUIRED/null. BEGIN остаётся закрытым; подтверждённого production login нет. |
| Конкретный аккаунт | Контракт проверяет совпадение строк account_id в текущих private facts и выбранной конфигурации. Источник подлинной идентичности Codex отсутствует. ChatGPT tab URL и наличие auth.json его не заменяют. |
| Конкретная сессия | `initial-selection-contract.mjs:81` допускает только state/account_id, а selection authentication содержит только provider/mode/account_id. Повторный login того же аккаунта, session generation, expiry и revocation generation не выражаются. SID/session/logon Windows — другая идентичность. |
| Отзыв после проверки | `current()` собирает async observations. Затем `native-coding-setup-owner-main.mjs:94` отдельно ожидает device-подпись; `open():27` проверяет device/host/lifetime, но не retained Codex auth. Исправлено конкретное ожидание readback; непрерывная авторизация до эффекта не доказана. |
| Provider и worker | `initialNativeSetupProviderChoices` и BEGIN input не несут authentication. `codex-cli-runner.mjs:208` получает codexHome и native lease, но не ожидаемый аккаунт, session generation или revocation capability. Hash каталогов/config и разрешение задачи не удостоверяют сессию Codex. |
| Restart | Новые тесты реконструируют контроллер над retained selection: snapshot read-only, отрицательные текущие факты запрещают BEGIN, валидные требуют explicit BEGIN. Они не доказывают реальный native restart или сохранение/отзыв у провайдера. Существующий AMBIGUOUS test блокирует blind retry. |
| Выбор до login | Предварительный confirm(A), затем настоящий login(B) даёт DRIFTED; новый confirm возвращает старую запись, decline запрещён, cancel при NOT_STARTED сохраняет её. Нет явного supersede/reset API. Это availability/recovery gap. Нельзя исправлять удалением истории неопределённых эффектов. |

Минимально необходимый интерфейс следующего этапа: producer из существующей доверенной CLI/package authority, который наблюдает настоящий выбранный app-owned CODEX_HOME, подтверждённый account/subject, непереносимую auth session generation и срок, и предоставляет удерживаемую границу применения/отзыва до исходного эффекта. После revoke либо restart старое разрешение должно оставаться недействительным или требовать явной повторной авторизации; неопределённый эффект не должен автоматически повторяться. Это требование, а не новый реализованный корень доверия. В этом patch producer не подменялся JSON, файлом credentials, URL или положительным флагом.

Первая установка и upgrade дополнительно по-прежнему требуют исходной enrolled Owner/native authority, pre-Main producer и проверяемого одноэкземплярного handoff, работающего Guardian challenge route, completion/recovery barrier и Windows process/pipe/Job/WTS/ACL qualification. Изменённые модули не восполняют эти объекты. Сохранённые Guardian source guards и модели не подтверждают их реальную Windows custody.

## Воспроизведение

В пакете Library находится исходный `metaengine-c26565e-source.zip`; публичный источник архива — три part-файла в указанном точном commit. Для новой изолированной копии:

```bash
python3 restore-and-check.py metaengine-c26565e-source.zip /absolute/new/directory codex-initial-auth-c265.patch
cd /absolute/new/directory/Compute
```

Helper не выполняет установки, сетевые операции, продуктовые тесты или изменения общей конфигурации. Он проверяет оба SHA, безопасные ZIP entries и modes, исходный tree, применимость patch и итоговый tree. Исходники и применённый patch остаются в новом каталоге.

Затем выполните команды из `RESULTS.json`. Все пути тестов относительны `Compute/`, кроме client source-check, который выполняется в `apps/metaengine-browser/`. Для расширенного verifier каждый раз требуется новый пустой evidence destination. Ожидаемый `wire_route_authenticates_then_launches` остаётся FAIL; не переводить его в PASS изменением ожидаемого результата.

Публичная ветка и draft PR содержат только этот аудит, применимый patch, helper и логи. Их база — source-transfer branch; patch предназначен для извлечённого c265 snapshot, а не для старых source-файлов Git transfer commit. Общие ветки не изменяются, merge и установка не выполняются.

Сохранение именно в целевой Space остаётся не выполнено: ранее полный список доступных Space был пуст. Результат сохранён через разрешённые Git и Library; это не заявляется как запись в целевую Space.
