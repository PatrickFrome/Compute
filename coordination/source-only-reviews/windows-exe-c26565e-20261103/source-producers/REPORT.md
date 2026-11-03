# Packaging source producers и конкретные оставшиеся границы

Реализован работающий source-only producer полной идентичности отдельных
компонентов. Неизвестный Chromium revision больше не является постоянным
placeholder: установлен точный commit/tree, а для Node реально выполнен полный
replay всех 64 официальных patches с физическим readback. Единого Windows EXE
пока нет: полный build-input composition и безопасная PE normalization не
доказаны. Никакой receipt или success flag это не подменяет.

## Что установлено и выполнено

Из зафиксированного Electron `c542df1ecbc2c2978e8f53f8c7baf602404d166f`
получены и проверены точные DEPS, patch config, порядок и все bytes Node patches.
Electron tree: `328891d1f8b4d93d49c9f31332baf75fa726cb6e`. Final producer проверил
его полный физический checkout: 3 404 записи.

Chromium `152.0.7977.167` разрешён через официальный GitHub mirror в commit
`dd78960ccd8a03a2fe1f629543d27783885b78e9`. Raw commit-object пересчитан по Git
SHA1; он содержит tree `63b2edfe4c6ae23d2fd3424cde3e529db49f7068`.
Electron/Chromium DEPS совпали с существующими SHA256 pins. Chromium tree contents
и его полный postpatch checkout здесь не получены и не квалифицированы.

Node base `f14cd3aa7bf9ca8df2cc5b8bb14beb0f335b1d93`, tree
`409a26f676d83fa6e1b0bfdb1c10d6878845c071`, после всех 64 ordered patches даёт
полный tree `92f36398f6bacb44cbba33fea5b902898ac8ef9a`. Результат независимо
подтверждён `git am --keep-non-patch --keep-cr`. Проверены все 46 474 записи,
639 931 050 canonical raw bytes и шесть symlink targets. Все восемь старых
interface hashes также совпали; они больше не заменяют полную проверку Node.

Исходные Electron/Node HEAD, index, tree и source bytes не изменялись. Upstream
scripts/hooks, скачанный package code, компиляторы и Windows PE не запускались.

## Реализованный producer

`custom-electron-source-policy.py` проверяет raw commit/tree/blob objects,
применяет всю официальную серию в private Git index/object storage и сверяет
полный ожидаемый tree. Физические bytes/modes/links проверяются напрямую;
`assume-unchanged`, ignored extra files или чужой descendant не дают успеха.
Replacement refs, grafts, local includes/includeIf/worktreeConfig, filters и
promisor repositories запрещены; lazy fetch, Git environment redirection и
hooks отключены. Во время независимого review закрыты два config-composition
пропуска; before-fix и final regression logs сохранены.

Профиль явно `canonical-raw-git-blobs-v1`. Обычный upstream checkout переводит
два Node файла в CRLF по attributes. Producer не нормализует это молча:
`--canonical-output` создаёт новый проверенный raw export, `--physical-tree`
проверяет отдельный canonical export, `--derive-only` не квалифицирует physical
checkout. Windows representation остаётся NOT QUALIFIED.

CLI и конкретные следующие шаги: [SOURCE_PRODUCER.md](SOURCE_PRODUCER.md).
Этот command реально завершился PASS для Node/Electron, но его scope —
`COMPLETE_COMPONENT_GIT_TREES`, не весь DEPS/CIPD/hook/toolchain closure.
Полные Chromium/V8/BoringSSL replays ещё NOT RUN: для них нужны полные
preprovisioned objects, а не полученный metadata-only Chromium repository.

## PE этап

Добавлены lock/SRI-derived каталог source hashes и builtin-only collector:
52 resedit/pe-library CJS modules, package metadata и девять отдельно объявленных
builder/fuse reference files. Скачанный dependency code не выполняется.
Collector использует fixed config/lock/icon paths и не получает expected ASAR
из candidate bytes, произвольного path/callback или `verified:true`.

Добавлен строгий direct-layout precondition helper и отрицательные fixtures:
header overlap, entry point, imports, вторая executable section, mapped spans,
relocations, resources, fuses, checksum и overlay. В review исправлены BOM
hashing, mapped-header overlap, non-executable entry point и padding span.
Даже успешный structural audit возвращает HOLD: direct fields не доказывают
indirect loader-reference closure.

Production gate не изменён: только полное byte equality. Нормализованное PE
не допускается. [PE_PRODUCER.md](PE_PRODUCER.md) описывает точный следующий
интерфейс: retained expected-ASAR/appInfo/icon producer → verified source
closure → полный expected-image serializer по реальному builder order →
indirect loader/reference proof → whole-image compare → отдельная Windows
qualification. Нельзя отключать ASAR/fuses или вычитать целые PE ranges.

## Тесты

| Проверка | Результат |
| --- | --- |
| Source-policy models | 17 PASS |
| Source-build wrapper regressions | 24 PASS |
| Independent source negatives | 9 PASS |
| Actual final Node component producer | 64 patches, 46 474 physical entries PASS |
| Actual final Electron component producer | 3 404 physical entries PASS |
| New PE ingredients/preconditions с SRI-verified archive bytes как данными | 30 PASS |
| Existing production exact-byte gate | 41 PASS |
| New PE tests без установленных dependency sources/byte fixture | 25 PASS, 5 explicit skips |
| Independent final PE spotcheck | 6 PASS |
| Browser source checks | 292 PASS |
| Windows build, installation, real PE transform qualification | NOT RUN |

Группы пересекаются и не суммируются. Точные команды, before/after failures,
actual proofs, component inventories и raw logs — в `test-evidence.tar.gz`.
Source checkouts, canonical 640 MB source export и vendor byte fixture в архив
не включены. Фикстура сравнения dependency bytes воспроизводится из точных
SRI-matched source archives; без неё пять тестов явно SKIP, а не PASS.

## Что конкретно остаётся HOLD

1. **Gclient composition producer отсутствует.** Electron patch config содержит
   19 repositories. Нужен полный enabled Windows x64 DEPS/nested-root/gitlink
   set, exact boundary verification, CIPD/GCS memberships/digests, hooks и
   generated outputs, compiler/SDK/toolchain closure и удержание исходных
   inputs до build. Composed root не игнорируется ради зелёного результата.
   Builder теперь вызывает реальный component producer, затем останавливается
   до staging/GN/output на `gclient_deps_cipd_hook_closure_unavailable` либо
   раньше на точной незакрытой boundary/representation/object ошибке. Старая
   base-head-only receipt shape не выдаётся за binding настоящих postpatch
   commit IDs; следующий handoff должен включить complete component proof и
   composition, а не caller JSON.
2. **Expected-ASAR/metadata producer и PE serializer отсутствуют.** Реальный
   collector дал exit 1/HOLD: installed locked source bytes недоступны,
   immutable expected-ASAR, retained resolved metadata, exact serializer и
   indirect loader closure отсутствуют. Конкретные implementation/qualification
   steps приведены в PE_PRODUCER; текущий helper их не заменяет.
3. **Оставшиеся physical inputs не квалифицированы.** Windows toolchain/runtime
   distributions по-прежнему отсутствуют. Запросы official Electron headers
   tarball и SHASUMS получили CONNECT 403, bytes не получены; отказ не обходился.
   GitHub Git mirror был отдельным разрешённым public Git каналом для E/N и
   Chromium metadata. Pinned archive hashes не объявляются повторно проверенными.
4. Прежние protected release signer, detached installer sidecars, NSIS-purpose
   native custody, owner bridge и эквивалентный unsigned admission path этим
   source-only этапом не реализованы.

## Применение

`source-producers-incremental.patch` применяется к собственному review baseline
`a6d439952d06e7e0b1f5353de6859a060ccc78c2`.
SHA256: `56400f70cb63386115bd9a3d622f92a3e1b1f969819d260663e19219523685f1`.

Альтернатива — `metaengine-c26565e-producers-combined.patch` непосредственно
к проверенному archive tree `2dbe253e97379532f6f4b52ef7edf26109a9266d`.
SHA256: `343223cd8811e2f1502ae34140f70a6f1f0ce18de036b86ffd07ade862191988`.
Оба варианта проверены `git apply --check` и применением в отдельных чистых
worktrees; одинаковый итоговый tree — `000067a7f03f1541aa7a0b715842d73042d82e30`.
Не применять оба варианта поверх друг друга.

Ничего не устанавливалось, пользовательские ПК/БД/службы не менялись, новых
trusted roots и послаблений guards нет. Реализован настоящий scoped source
producer и проверяемые PE prerequisites; готовность Windows/client/release
не заявляется.
