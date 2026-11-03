# METAENGINE pre Main source review and rejection hardening

Дата: 2026-11-03. **Production launch остаётся HOLD.** Найдены точные отсутствующие producers доверенного sender до создания Main и signer для launch-purpose. Реальный sender не объявлен реализованным. Внесено узкое усиление отказа в существующем native authorizer; новые authority, ключи, обходы native gate и публичные trusted-флаги не добавлены.

## Проверенная исходная база

Получен штатным Git-доступом commit [accb28e72c87c059e780efb8e6681886b33e9b4f](https://github.com/PatrickFrome/Compute/commit/accb28e72c87c059e780efb8e6681886b33e9b4f), ветка `work/source-transfer-c26565e-20261103`. Части `coordination/source-transfer/c26565e/archive.part00`, `archive.part01`, `archive.part02` соединены в этом порядке.

SHA256 архива: `4200e492828dbb857aaa737a7ce56d0aeda3c97c84f7743b1501ef2f229d3636` — совпал. Source revision: `c26565e58ab92dcbcda9663c4d231bdf4a9a7ee6`. После восстановления executable modes дерево точно совпало с `2dbe253e97379532f6f4b52ef7edf26109a9266d`. Это единый обновлённый снимок; четыре прежних патча повторно не применялись.

В проверенном архиве `AGENTS.md` и `.agents/skills` не найдены. Для работы создан отдельный локальный Git repository с восстановленной историей: baseline `ff93bb70084fb8026e5a775c4a0d8a97737b6b5f`; change commit `b0fc979cbc794653121b7760def56dcdabcc499a`. Эти локальные commits не являются оригинальной Git-историей проекта.

## Реальное изменение

`GuardianOriginalMainChallenge::revoke()` необратимо помечает challenge использованным, очищает match/nonce и связь с соединением. Общий reject в `GuardianNativeRootSession::authorizeOriginalMainLaunch` вызывает revoke для каждой причины отказа, включая malformed/oversized frame до consume. Раньше malformed frame возвращал ошибку до consume; повторный корректный frame мог использовать оставшийся challenge при отдельном вызове метода.

Это defense-in-depth для будущей композиции: сейчас production SCM route закрывает соединение с HOLD и не вызывает authorizer. Доказанного live bypass или работающего Main этот результат не означает.

Изменены ровно три файла:

- `apps/metaengine-browser/native/browser-guardian-scm/browser-guardian-original-main-challenge.hpp`
- `apps/metaengine-browser/native/browser-guardian-scm/browser-guardian-original-main-launch-session.inc.hpp`
- `apps/metaengine-browser/test/native/verify-guardian-original-main-authorization-model.py`

Patch: `guardian-pre-main-c26565e-rejection.patch`.
SHA256: `b9bb0df90967134914091e799c92ae256c791a4a1c375756997f8ef5c4c0583f`.
`git apply --check` и `git apply --index` выполнены на отдельной чистой копии baseline. Полученное дерево совпало с итоговым `6e32a721330a43821666d63f5980f59f61565850`.

## Production цепочка и точный обрыв

Все указанные ниже файлы относятся к проверенному c26565e snapshot. Native файлы расположены в `apps/metaengine-browser/native/browser-guardian-scm/`; JS — в `apps/metaengine-browser/src/`.

| Этап | Реальный код и состояние |
| --- | --- |
| Challenge issuer | `browser-guardian-scm-service.cpp:35–51`: CNG entropy, private arm, срок 30000 ms, связь с `&pipe`. BEGIN на строках 596–635 выдаёт challenge только после Owner/device/root/release checks на исходном соединении. Nonce является sequencing, не authority. |
| Точный dispatch break | `browser-guardian-scm-service.cpp:680–707`: `grant` на строке 691 остаётся пустым; строка 696 возвращает `ORIGINAL_MAIN_SENDER_COMPOSITION_UNVERIFIED`. Реальный `startOwned` call site существует на строке 275, но sender route до него не допущен. |
| Launch codec | `browser-guardian-original-main-launch-protocol.mjs:1–24`: только format/signing-material codec; production sender и signer отсутствуют. `ChallengeFromResponse` не удостоверяет службу. |
| Владелец существующего private key | `supervisor-device-identity.mjs:165–196`: чтение состояния и расшифровка через Electron safeStorage. Production constructor — `main.mjs:2685`. Native enrollment record хранит fingerprint и enrollment evidence, не private key. `ensure()` способен создать отсутствующий ключ и не подходит как existing-only bootstrap. |
| Existing-only путь | `main-entry.mjs:257`, `browser-guardian-replacement-maintenance.mjs:87,105`, `supervisor-device-identity.mjs:766–785`: replacement maintenance загружает существующую identity уже внутри Main после Electron ready. `guardianOwnerReadChallenge:834` имеет отдельный read-purpose; launch-purpose signer отсутствует. |
| Реальные service identity checks | `browser-guardian-connected-peer.cpp:309,330,355`: исходная pipe, удерживаемый service process/full birth/image, LocalSystem/session и SCM. Общий observe сохраняет `GUARDIAN_CONTINUOUS_LOADED_CODE_CUSTODY_REQUIRED` на строке 639. PID или snapshot JSON не дают launch authority. |
| Цикл reader custody | `browser-guardian-original-main-native-host.cpp:166–204` и `native/electron-original-main/guardian-electron-node-mount.cpp:95` требуют уже созданный original Main. `browser-guardian-original-main-debug-owner.cpp:505–574` выдаёт service-reader и TOKEN_QUERY только original child через его creation-owned pipe с kernel-object readback. Producer для отдельного pre-Main sender отсутствует. |

Два независимых reviewer потока подтвердили этот разрыв. Добавлять невыдаваемый capability type или JS sender с injected signer означало бы создать оболочку без production authority; такие изменения не сделаны.

## Минимальный недостающий production интерфейс

Нужен private native producer под существующей release authority, работающий до создания child Main. Он должен удерживать одно исходное authenticated Guardian соединение, исходные service process/token и SCM handles, signed package/current-policy scope, исходного пользователя и неизменяемый срок. Его реальный mount обязан предоставить existing enrolled key без экспорта, создания или ротации identity.

Единственная операция sender должна внутренне выполнить Owner-read → получить challenge от проверенного Guardian → повторить native fences → подписать только ORIGINAL_MAIN_LAUNCH через удерживаемую identity → начать ровно одну запись на той же pipe. Signer должен принимать непрозрачный connection-owned scope; JSON, PID, HANDLE number, caller nonce, `verified=true`, transport callback и заранее подписанный proof недопустимы как источник доверия.

После начала записи launch proof timeout, отмена, обрыв или потеря ответа означают UNKNOWN/HOLD, а не доказанное отсутствие эффекта. Автоматический повтор запрещён. Отзыв должен предшествовать cancel-and-join исходного OVERLAPPED; reconnect не восстанавливает authority. Receipt записи ответа не доказывает чтение клиентом.

## Проверки итогового кода

Новый runner извлекает фактический authorizer и использует реальные portable wire/challenge/grant классы. Windows identity, crypto verifier, RNG, clock и retained-root окружение в нём — явно синтетические stand-ins. Успешный calibration case не доказывает production issuer.

- Новый authorization runner: **22 synthetic PASS**, обычный запуск и ASAN/UBSAN.
- Mutation check: удаление reject-revoke только во временной копии метода воспроизводит malformed → valid regression, **EXPECTED FAIL exit 7**.
- Покрыты replay, другая pipe, expiry до/во время signature и финального root fence, cancellation, identity/tuple/signature/root/token/RNG failures, malformed/oversized frame, revoke до arm/после arm/после consume.
- Запуск proof transport, неопределённая запись и реальные Windows process/pipe/SCM не моделируются этим runner и не засчитаны как PASS.

| Обязательная проверка | Итог |
| --- | --- |
| verify-guardian-original-main-launch-source.py | 81 PASS, 1 ожидаемый FAIL `wire_route_authenticates_then_launches` |
| verify-guardian-main-begin-model.py, также --sanitize | по 9 PASS |
| verify-guardian-main-owner-wait-model.py, также --sanitize | по 13 PASS |
| verify-guardian-requester-session-model.py, также --sanitize | по 15 PASS |
| Три запрошенных Node suites | 17 PASS |
| node scripts/check-source.mjs | 292 PASS |
| verify-guardian-original-main-source.py | 23 PASS, 0 FAIL, 5 NOT RUN |
| Existing portable challenge tests, обычно и ASAN/UBSAN | PASS |
| git diff --check; clean-base patch application | PASS |

Ожидаемый launch-source FAIL сохранён: route требует реального sender, которого нет. Проверка не превращена в PASS изменением readiness требования или включением authorize.

Пять NOT RUN из полного source runner: pinned OpenSSL 3.5.9 static build, pinned BoringSSL static build, exact Electron/патченный Node source interface, official Electron headers, Win64 cross builds. Дополнительно Windows native pipe/process/SCM test — SKIP; full custom Electron build, production grant/release positive, continuous code custody и leak sanitizer — NOT RUN. Leak detection отключён на ptrace-host в существующих sanitizer runners.

**Windows NOT RUN.** Не квалифицированы настоящие SCM/process/full birth/pipe/Job/WTS/ACL, cancellation/join, crash/recovery, uncertain writes, файловая durability и срок challenge 30 секунд.

## Что сохраняет HOLD

Clean install: `ownerAndClientExact` в `browser-guardian-update-actuator.cpp:569` требует существующего protected Owner/device. `infra/client-state-runtime/fresh-provider-native-device-identity.mjs:9–18` требует ready packaged Electron и single-instance lock. `browser-guardian-enrollment-ticket-client.cpp:35–48` сохраняет LOCAL_OWNER_BRIDGE_REQUIRED. Bootstrap заканчивает COMPLETE_NOT_READY в `browser-guardian-machine-bootstrap.cpp:272`. Installation → first-owner → first-Main authority и single-instance handoff не реализованы этим патчем; W77 policy genesis не расширен до enrollment/Main permission.

Upgrade: existing identity loader не выдаёт launch-purpose и не создаёт trusted pre-Main scope. Replacement maintenance и signed compatibility observations не заменяют отдельный исходный upgrade/handoff путь. `runtime-recovery-process-adapter.mjs:131` сохраняет refusal. Existing durable barrier/completion/recovery и original worker/Job/I/O reconciliation также требуют отдельной реализации; PID absence не является основанием удалить запись или повторить эффект.

Существующие исходные владельцы не заменены: native root удерживает requester process и WTS token; SCM передаёт дубликаты исходных token/requester и signed namespace, effect owner удерживает callback, worker и Job/process. Этот patch новых handles не создаёт и не доказывает их Windows lifetime.

Установка, merge, изменение служб, установленного клиента и пользовательских БД не выполнялись. Доверенные корни и защитные проверки не ослаблены. Публикация ограничена собственной веткой с patch/отчётом/доказательствами; исходные общие ветки не изменены.

