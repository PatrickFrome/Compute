# Ревью 1436 системный каталог receipt и PE

Все три замечания подтверждены. В исходном patch #1436 проверка provenance и сравнение PE были недостаточными; переход Vault/PostgreSQL на фиксированный OS rail добавил ограничение совместимости. Дополнение исправляет обнаруженные пропуски отказа и сохраняет неподтверждённые возможности в HOLD. Windows build, установка и runtime qualification не выполнялись.

## Системный каталог Windows

В native Guardian есть четыре внутренних вызова `GetSystemDirectoryW`, используемых для проверки DLL closure и исходных объектов. Нет экспортированного JavaScript/standalone Node resolver, который можно безопасно вызвать для Vault и PostgreSQL до обычного Main. Переменные среды, `PATH`, проверка существования каталога и совпадение со строкой `C:\Windows` не являются доказательством настоящего OS root.

Другой системный диск остаётся **HOLD**. Поддержка не реализована через environment override. Согласие среды с фиксированной политикой C также не выдается за native root proof; подменённая среда не позволяет надёжно определить настоящий диск. Для поддержки нужен приватный zero-argument producer в существующей аутентифицированной native-композиции с удержанием исходного OS scope. Arbitrary path/callback/JSON не заменяет такой producer.

Дополнительно выявлен порядок эффектов: в #1436 Vault уже открывал новый файл, а PostgreSQL уже мог вызвать `pg_ctl start` до отказа в inventory. Теперь проверка root/context выполняется до файлового доступа, создания ключа, port probe и запуска PG. Приватные immutable snapshots удерживаются до защиты ключа и до claim/verify/stop PostgreSQL.

Отдельная оценка: [SYSTEM_ROOT_REVIEW.txt](SYSTEM_ROOT_REVIEW.txt). Inert full-function regressions: исходный #1436 — 2 ожидаемых FAIL, исправление — 2 PASS; независимый before/after probe — 8 PASS. Runtime suite: 12 PASS, 4 Windows-only skips. Перенесённый source closure: 1 PASS. Ни один такой тест не доказывает реальные Windows ACL или поддержку D-диска.

## Источники и package receipt

Ранее ancestry и ограниченный набор хешей допускали изменённые descendant checkout вне проверяемых файлов; receipt записывал locked origins, а JS-gate игнорировал `upstream_checkout_heads`. Это не подтверждало зафиксированные компоненты. Старый код воспроизведён на настоящих временных Git-репозиториях: 12 отрицательных source-policy subcases не получали требуемого отказа; девять некорректных receipt-head cases проходили старый gate.

Теперь Electron/Node/V8/BoringSSL требуют exact locked HEAD и clean tracked/untracked checkout. Receipt producer и gate требуют полный точный набор четырёх observed heads. Равенство данных самого receipt означает лишь согласованность деклараций, а не независимую аутентификацию источников.

Полного immutable Chromium commit/tree pin в текущем policy нет: tag и хеш одного DEPS этого не заменяют. Полный postpatch identity Node или проверенный полный replay также не установлены. Поэтому production verifier, создание receipt и публикация distribution явно возвращают `chromium_full_source_identity_unavailable` до staging/build/output. Нет флага обхода. Положительные synthetic receipt/staging models подменяют только этот недоступный prerequisite внутри теста и не квалифицируют production build.

Отдельная оценка: [RECEIPT_REVIEW.txt](RECEIPT_REVIEW.txt). Итог: Python 24 PASS; metadata subgroup 10 PASS; combined package-gate suite 41 PASS.

## PE и реальные преобразования electron builder

`.text` и наличие строки binding не доказывают полную идентичность кода. Новые fixtures сохраняют `.text`, меняя entry point, image base, imports, DLL/thunk, другую executable section, permissions, resources, data, checksum и certificate/overlay bytes. Все 11 новых отрицательных регрессий падают на #1436 и проходят после исправления. Независимый probe подтвердил 13 ожиданий, включая отказ всех десяти исходных ложных совпадений и успешное сравнение byte-identical control.

Теперь сравниваются полные буферы через `Buffer.equals`, а digest охватывает каждый байт образа. Поле результата — `pe_image_sha256`; изменение вызывает `packaged_exe_transform_unqualified_hold`. Marker остаётся только sanity check. Ни одна `.rsrc`, header, certificate или overlay область не исключается.

Исследованы исходники точной lockfile-версии app-builder-lib 26.15.7: пять source-архивов совпали с SHA512 SRI lockfile, семь builder source-map correspondences совпали с официальным release tag. Это соответствие lockfile, не замена release authority. Реальный [порядок builder](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.15.7/packages/app-builder-lib/src/platformPackager.ts#L320-L356): ASAR integrity resource до user `afterPack`, затем built-in fuses, product-resource edits и optional signing. Built-in fuses используют вложенный 1.8.0, финальный hook — top-level 2.1.3. Подробные первичные ссылки и SRI приведены в [PE_REVIEW.txt](PE_REVIEW.txt).

**Обычная текущая упаковка намеренно остаётся HOLD**, включая легитимные resource/fuse/signing edits. Их точная безопасная нормализация не реализована. ASAR integrity/fuses и release/native signature guards не отключались для получения совпадения. Будущий transform verifier должен независимо получать доверенные ASAR/config/icon/version inputs, воспроизводить точные pinned transforms и сравнивать весь ожидаемый образ, сохраняя проверку остальных полей. Кандидат не должен определять собственную ожидаемую идентичность.

## Применение и тесты

`review-1436-followup.patch` применяется **после** исходного patch #1436 к дереву `219e5e2b468154fd3e6a1c1f34c8cdea81d5628f`. SHA256: `c0d5f40d673da70e48b18694d460ce8de45bde578efee6df258ad68c29d26a3b`.

Альтернатива: `metaengine-c26565e-reviewed-combined.patch` применяется непосредственно к исходному проверенному архивному дереву `2dbe253e97379532f6f4b52ef7edf26109a9266d`. SHA256: `a191a50436c12cd3dd1f9e3c2bf37fa76c8abb2ef187fabcfdf0d892ef138183`. **Не применять оба варианта поверх друг друга.**

Оба пути проверены `git apply --check` и физическим применением в отдельных worktrees; одинаковое итоговое дерево: `a6d439952d06e7e0b1f5353de6859a060ccc78c2`. Whitespace checks прошли. Итоговая Browser source-проверка — 292 PASS.

```sh
node --test apps/metaengine-browser/test/custom-electron-package-gate.test.mjs
python3 -B apps/metaengine-browser/test/test_custom_electron_source_build.py
(cd infra/client-state-runtime && node --test local-vault-key.test.mjs owned-postgres-process.test.mjs)
(cd apps/metaengine-browser && node scripts/check-source.mjs)
```

Точные before/after команды, исходные snapshots, probe scripts и raw logs находятся в `followup-test-evidence.tar.gz`. Vendor source-архивы и временные synthetic distribution directories исключены; `pe-source-correspondence.json` сохраняет SRI/hashes/официальные source correspondences. Предыдущие обязательные Guardian результаты доступны в исходном отчёте #1436; native launch-код этим дополнением не менялся.

Границы сохраняются: нет Windows build/установки/БД/служб/нового trust root/ослабления release guards. Настоящий OS-root producer, полные source identities, квалифицированная PE-transform policy и прежние signer/NSIS/owner-custody prerequisites остаются блокерами. Результат — исправленные отказы и воспроизводимое source-only review, не готовый установщик.
