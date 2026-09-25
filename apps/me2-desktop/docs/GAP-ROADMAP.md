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
| 1a | self-update: **activation/handoff/qualification** | ❌ | — | запуск staged-установщика, квалификация после перезапуска, отккат |
| 2 | Guardian (+ native SCM-служба) | ❌ | — | watchdog-паритет: перезапуск падшего клиента извне; SCM — отдельный трек |
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

## Очередь (backlog по приоритету)

1. **R79 (текущий)**: CI package-proof npm ci → зелёный gate; #3 nonce-ACK; #7 epoch-fence.
2. **R80**: #1a activation/handoff/qualification — staged-обновление должно уметь применить себя (spawn установщика при выходе + qualification-флаг в journal после перезапуска) без Guardian.
3. **R81**: #2 Guardian-parity лайт — внешнезапускаемый watchdog (bun-скрипт) с тем же journal-контрактом; native SCM — за кадром до решения оператора.
4. **R82**: #8 brain-адаптер + #4 native-supervisor client — только после стабилизации #1a/#2.
5. **Решение оператора**: PR `me2/r78-desktop-from-scratch` в `release/self-update-ambiguity-live-v2` или параллельная линия — после зелёного gate на 3+ прогонах.

## Инварианты roadmap

- Никаких зависимостей сверх `socket.io-client` (runtime) — принцип R78 подтверждён аудитом.
- Каждая механика = чистые решения + тонкая electron-обвязка; тесты `node --test` без фреймворков.
- Контракты: `me2-daemon-contract.v1`, `me2.desktop-update-manifest.v1`, `me2.ui-bundle-manifest.v1` — не ломать.
- Порт-карта неизменна: 3040/3041/3042/3043/3000/8137.
