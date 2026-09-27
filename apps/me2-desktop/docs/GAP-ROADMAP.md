# METAENGINE Desktop — Gap Closure Roadmap (R79+)

Живая матрица закрытия gap между legacy-клиентом `apps/metaengine-browser`
(~110k LOC, 376 файлов) и новым клиентом `apps/me2-desktop` (zero-based, R78).
Источник анализа: R78-1a аудит (TOP-8 must-carry) + `research/2026/R78-DESKTOP-RESEARCH.md`.

**Курсор** = что закрыто сейчас. Каждый раунд ME2 обязан: (а) сдвинуть ≥1 строку
матрицы, (б) bump версии клиента, (в) зелёный suite `node --test`, (г) push ветки.

## Матрица gap (TOP-8 must-carry)

| # | Механизм (legacy) | Статус | Раунд | Что осталось |
|---|---|---|---|---|
| 1 | self-update стек: staged poll → verify → download → journal | ✅ закрыто | R78 | — (staged-updater + verified-manifest, exact-sha) |
| 1a | self-update: **activation/handoff/qualification** | ✅ закрыто | **R80** | — (activator.mjs: detached-spawn установщика при выходе (`/S`), qualification-окно 30с после перезапуска, TTL 10мин, честные rolled_back/stale/id_mismatch в journal; IPC me2:update-apply + preload-мост) |
| 2 | Guardian (+ native SCM-служба) | 🔄 parity-лайт | **R81** | guardian-contract.mjs + scripts/guardian.mjs: внешний watchdog, beacon-контракт (atomic pid/boot_id/ts), clean-exit никогда не воюется, backoff 15с→120с, cap 8/ч из журнала → честный give_up; native SCM — за кадром до решения оператора |
| 3 | single-instance: nonce-ACK + resurrection | ✅ закрыто | **R79** | — (instance-nonce.mjs: verify TTL/hex/future, ACK журналируется; second-instance → restore+focus) |
| 4 | native-supervisor client | ❌ | — | клиент к нативному супервизору (порт/протокол legacy) |
| 5 | me2-плоскость: daemon-host, ui-host, ui-gateway, fleet-tabs | ✅ закрыто | R78 | интеграционный smoke Xvfb пройден (evidence/) |
| 6 | browser-policy / TabRegistry шелл | 🔄 частично | R78 | policy deny-by-default + роли есть; живой TabRegistry-твин не нужен (TAB_ROLES — минимум) |
| 7 | keepalive / epoch-fence | ✅ закрыто | **R79** | — (epoch-fence.mjs: boot-эпоха из /health, re-adopt при смене, backoff 15с→120с) |
| 8 | brain-персистентность | ❌ | — | адаптер к brain-модулю daemon'а (персистентный контекст агентов) |

## Раунд-журнал

| Раунд | Версия | Сдвиг матрицы | Верификация |
|---|---|---|---|
| R78 | 0.8.0-dev.0.1 | #1, #5, #6-частично | 38/38 unit; pack 69.6MiB node_modules=true; Xvfb smoke-boot; verify-installed-bundle OK |
| **R79** | 0.8.1-dev.0.1 | **#3, #7 закрыты; CI package-proof fix (npm ci)** | suite 60+ тестов; см. worklog R79 |
| **R80** | 0.8.2-dev.0.1 | **#1a закрыт — курсор 5.5/8** | suite **86/86 GREEN** (node --test, Node 24); check-syntax 34 файла; см. worklog R80-DESKTOP-1A |
| **R81** | 0.8.3-dev.0.1 | **#2 → parity-лайт — курсор 6/8** | suite node --test GREEN (+guardian); check-syntax; см. worklog R81-DESKTOP-GUARDIAN |

## Очередь (backlog по приоритету)

1. **R79**: ✅ CI package-proof npm ci → зелёный gate; #3 nonce-ACK; #7 epoch-fence — закрыто.
2. **R80**: ✅ #1a activation/handoff/qualification — закрыто (activator.mjs, 86/86, курсор 5.5/8).
3. **R81 (текущий)**: ✅ #2 Guardian-parity лайт — внешний watchdog (scripts/guardian.mjs) + beacon-контракт (guardian-contract.mjs) с тем же journal-контрактом; native SCM — за кадром до решения оператора.
4. **R82**: #8 brain-адаптер + #4 native-supervisor client — только после стабилизации #2 (живой прогон guardian на dev-стенде ≥ 1 недели).
5. **Решение оператора**: PR `me2/r78-desktop-from-scratch` в `release/self-update-ambiguity-live-v2` или параллельная линия — после зелёного gate на 3+ прогонах (сейчас: 2/3 зелёных, R79 + R80).

## Инварианты roadmap

- Никаких зависимостей сверх `socket.io-client` (runtime) — принцип R78 подтверждён аудитом.
- Каждая механика = чистые решения + тонкая electron-обвязка; тесты `node --test` без фреймворков.
- Контракты: `me2-daemon-contract.v1`, `me2.desktop-update-manifest.v1`, `me2.ui-bundle-manifest.v1` — не ломать.
- Порт-карта неизменна: 3040/3041/3042/3043/3000/8137.
