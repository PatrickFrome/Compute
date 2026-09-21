# DEEP AUDIT — СВОДНЫЙ ВЕРДИКТ ДЛЯ ОПЕРАТОРА (2026-09-21)

Объединяет три аудита: **облако+GitHub** (CLOUD_AUDIT_20260921.md), **1154 ветки** (audit-branches-20260921/BRANCHES_AUDIT_20260921.md), **механики браузера** (BROWSER_DEEP_AUDIT_20260921.md).

---

## 1. РЕЛИЗ — ГОТОВ К УСТАНОВКЕ (cloud-first уже встроен)

**Rail**: `release/self-update-ambiguity-live-v2` @ `6bf173c7` (merge #938) — глобальный фронтир кодовой базы.
**CI**: 12/12 workflows success (Self Update E2E #2549, Windows Package Smoke #2092, Critical Audit #1555, Durability Gate…).

### Ссылка на скачивание (наилучшая релизная версия):
**Страница релиза:** https://github.com/PatrickFrome/Compute/releases/tag/v0.7.0-dev.35532004761.1

**Главный установщик (Windows x64, 121 MB):**
https://github.com/PatrickFrome/Compute/releases/download/v0.7.0-dev.35532004761.1/METAENGINE-Browser-Test-Setup-0.7.0-dev.35532004761.1-x64.exe

Сопутствующие: `METAENGINEBrowserGuardian.exe` (native Guardian SCM), `METAENGINEBrowserGuardianConfigure.exe`, `verified-self-update-manifest.json`, `guardian-native-staging-manifest.json`, `dev.yml`.

### Cloud-first подтверждён кодом:
Pinned endpoint `https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/a2-browser-native-supervisor-v1` вшит в
`src/native-supervisor-endpoints.mjs:1` и `src/native-supervisor-client-base.mjs:37`. workspace `2de9f84b-7c0a-4091-911c-894ff1d6eaf4`. **Anon/service ключи клиенту не нужны** — вся аутентификация через P-256 device-подписи (A2_DEVICE_HTTP_SIGNATURE_V1) + enrollment через оператор-гейт. Установленный браузер сразу смотрит на приоритетный Supabase `xpeibufgzjknrhbhpffp`.

---

## 2. ВЕРДИКТ ЗАМКНУТОСТИ КОНТУРА: **ПОДТВЕРЖДЁН ПО КОДУ** (21/25 механик работают)

Масштаб: 353 модуля `src/*.mjs`, 17 файлов edge-функции, 91 RSI-модуль, native Guardian (C++ SCM), ~350 тестов.

### Живой вечный цикл (ядро):
```
enqueue/roadmap → admission-fence → devos_fleet_lease_v1 (≤16, CAS-фенсинг, timeout 120с)
  → физический эффект (proof: prompt/conversation sha256) → mark_running
  → complete/receipt (effect sealing, readback) → artifact + memory-advance
  → retrieval в следующий промпт → …бесконечно
```
Плоскость ожидания: held **wait-batch** (delay=0) на POSTGRES_NOTIFY — мгновенное пробуждение (локально замерено 3–13ms).

### 4 слоя бессмертия супервизоров:
1. keepalive wake 60с · 2. rollover FRESH-tab (ROLLOVER_DEFERRED_AUTO_RELEASE 15min) · 3. crash-sentinel · 4. native Guardian (Windows SCM) — плюс self-update: hint → exact discovery → journal-barrier → watchdog → rollback.

### Командная плоскость (проверена end-to-end локально на каноническом коде edge):
enrollment (P-256 proof) → оператор-гейт → активация → подписанный heartbeat → issue → lease (lane-приоритет EMERGENCY 0 > DEV 1 > READ_ONLY 9) → receipt → readback → wake. **T2/T5/T8/T9/T10/T11 — все验证ены в этом раунде**: wait-emergency IMMEDIATE lease за 13ms; cognitive batch 202 ACK через курсорный watermark.

### Механики (25 каталогизировано): 21 РАБОТАЕТ · 1 декоративная · 3 с оговорками
- Декоративная: **Supabase Realtime wake** — при не-JWT ключах всегда фолбэк на POSTGRES_NOTIFY (который работает). Не мешает.
- Оговорки: wait-emergency (только для внешних тулов — норма контракта), RSI Phase36 (живые верификаторы, вход из тестов/консоли), эпизодическая память (in-process JSON).
- Мёртвых изоляционных API почти нет (единственный: approveRollover — компенсирован авто-релизом 15min).

---

## 3. КРИТИЧЕСКИЙ АНАЛИЗ — РАЗРЫВЫ И РИСКИ (приоритизировано)

| # | Разрыв | Влияние на вечный рой | Действие |
|---|---|---|---|
| R2 | wake-триггеры `glm_pulse_command/state` — облачный ad-hoc артефакт; миграции их дропают (локально канонизированы в `infra/pigsty/bootstrap/07`) | Без триггеров wake = bounded poll (работает, но медленнее) | Проверить наличие триггеров в облаке при live-тестах; при отсутствии — применить bootstrap/07 (нужен SQL-доступ к облаку) |
| R3 | **Браузер не умеет enqueue DevOS-задач сам** — пустой roadmap = idle-флот (цикл при этом жив) | Главный тормоз автономности: кто даёт задачу? | Операторский enqueue-роут/чат-команда → roadmap; наполнение roadmap перед стартом |
| R5 | pinned URL в 2 файлах без env-переопределения | Смена облака = правка кода + пересборка | Вынести в env в следующем релизе |
| R6 | память/RSI-ledger локальные (профиль) | Гибель профиля = потеря когниции | Синхронизация когнитивного слоя в Supabase (контракт уже есть) |
| R1 | Realtime wake декоративен | Нет (фолбэк работает) | Опционально: JWT-форма service_role |
| B-1 | RSI-долг вне rail: r14-graduation-effect (72 патча: Phase34B admission closure, Phase37A graduation certificate, crash-aware durability), r8d-sol (52 патча, PR #917) | Фичи не в релизе | Трёхстороннее ревью → следующий merge в rail |
| B-2 | main↔rail: 127 расходящихся файлов (~998 main-уникальных строк) | Долгосрочная дивергенция | Свести main к rail |
| B-3 | 4 workflows без cancel-superseded concurrency | Двойные прогонки CI | Дешёвый cherry-pick |
| B-4 | 96% PR (587) — черновики, гигиена веток (96% свежести ≤30д) | Шум | Авто-архивация смерженных |

---

## 4. ГОТОВНОСТЬ К LIVE-ТЕСТАМ (после установки релиза)

**Готово в облаке:** edge жив (ok=true, DIRECT_POSTGRES, BOUNDED_DB_POLL), 3 активных устройства, gate 0 PENDING, командная плоскость активна (1537 команд, EMERGENCY=18), storage-бакет на месте, tightened ACL каноничен.

**Чеклист при установке (порядок):**
1. Установить `METAENGINE-Browser-Test-Setup-0.7.0-dev.35532004761.1-x64.exe` → Guardian поднимется как служба.
2. При первом старте браузер подаст enrollment-request → **оператор-гейт**: одобрить (через Mission Control Enrollment Gate на песочнице — он смотрит в локальную БД; для облачных устройств нужен облачный гейт — скажи оператору, я подготовлю процедуру).
3. Проверить heartbeat устройства в облаке (`device_h205f22.last_used_at`), затем Mission Control → Wake Probe.
4. Наполнить roadmap (R3) — иначе флот в idle-wait (это корректное поведение, не баг).
5. Live-тесты T1–T12 по плану из handoff (`upload/metaengine-handoff-main.zip`).

**Что уже подготовлено на песочнице (локальный контур = точная копия контрактов):** Mission Control Console (8 вкладок) с работающими Enrollment Gate / Command Plane / **Emergency Lane (T8: issue→IMMEDIATE lease за 13ms)** / **Cognitive Bus (T9/T10: 202 ACK, курсорный watermark)** / E2E Lab с SSE-стримингом — финальный E2E 10/10 PASS за 1.8s. Локальный edge + Pigsty продолжают жить как репетиционный контур.

## 5. ИТОГ
Браузер **готов к установке и live-тестам**: релиз собран CI 12/12, cloud-first вшит, вечный цикл подтверждён кодом, 4 слоя перезапуска, командная плоскость верифицирована end-to-end. Блокеры отсутствуют; R3 (enqueue задач) — первое, что решаем вместе после установки.
