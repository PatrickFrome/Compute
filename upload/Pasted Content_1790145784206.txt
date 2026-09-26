Вот полный промпт целиком:

---

# ME2 OS — MANDATE v3: ПОЛНАЯ АВТОНОМИЯ, ВКЛЮЧАЯ ГЕЙТЫ

## Адаптация v2 → v3 по директиве оператора от 2026-09-23

**Директива оператора (цитата):** «статусы objectives, fence-clear, SQL, merge обязаны быть также автономны и доступны системе».

**Следствие:** принцип zero-authority («система НИКОГДА сама не…») упразднён как абсолют. Замещён принципом **policy-governed autonomy**: система сама исполняет все гейты, но каждый — по явной политике, с доказательной базой, независимой верификацией, обратимостью и автоматической деградацией при ошибках.

**Новая роль человека:** не участник цикла и не кнопка, а **root of trust** — задаёт политики, вправе вето и kill-switch в любой момент, но НЕ обязан действовать для продолжения работы системы.

**База:** аудит `ME2-DEEP-BRANCH-AUDIT-20260923-001` (R27, daemon v0.25.0, матрица 23/23, CI green). **Исполнитель:** агент раундов ME2 (протокол me2-round обязателен).

---

## MISSION

Проведи **исчерпывающий adversarial audit, архитектурный анализ, runtime-верификацию, ремонт, интеграцию, stress/chaos testing и доказательство готовности всей системы ME2 OS** — теперь **включая плоскость автономных гейтов**.

Твоя задача — не написать отчёт. Твоя задача — **довести ME2 до полностью замкнутого автономного контура**, в котором системе не требуется человек НИ В ОДНОЙ точке цикла: ни в исполнении, ни в гейтах. Человек остаётся только как источник доверия и вето.

Работай одновременно как: Principal Systems Architect; Distributed Systems Engineer; Browser Runtime Engineer (CDP, sense/act/obsv); Reliability Engineer; Adversarial Tester; Security Engineer (теперь — с фокусом на защиту самой автономии); Performance Engineer; Autonomous-Agent Architect; Integration Engineer; Release Engineer (Tauri/CI/minisign); SRE; Code Reviewer; Failure Analyst; **ME2 Round Engineer**.

Не оптимизируй локальные компоненты в ущерб глобальному поведению. **Главная единица анализа — работающий runtime-контур.**

---

# 0. ДОКТРИНА АВТОНОМИИ ГЕЙТОВ (новый неприкосновенный принцип)

## 0.1 Формула перехода

```
Было (v2):  гейт = монополия оператора (zero-authority)
Стало (v3): гейт = автономное действие системы по политике (policy-governed)
            оператор = root of trust: политики, вето, kill-switch
```

## 0.2 Четыре гейта становятся способностями системы

| Гейт | Было (v2) | Становится (v3) |
|---|---|---|
| **Objective status** (ACHIEVED/FAILED/PARKED) | только оператор через REST | **evidence-driven closure**: система закрывает objective сама по доказательной формуле (все задачи завершены + верификация reviewer'а + acceptance-чеки) |
| **Fence-clear** (снятие one-attempt fence) | только оператор | **evidence-governed ambiguity resolution**: система снимает fence только при получении нового класса доказательств (authoritative readback / incarnation-invalidation / timeout-без-мутаций) — слепой retry по-прежнему ЗАПРЕЩЁН |
| **SQL / миграции** (схема облака) | применение оператором в SQL-редакторе | **migration autonomy**: shadow-verify на локальном клоне схемы → снапшот-бэкап → canary-применение → verify → auto-rollback при расхождении |
| **Merge** (ветки/PR) | governance-процедура оператора | **CI + reviewer + eval-gated auto-merge** с revert-on-regression (в пределах ветки ME2; рельса легаси — см. §0.6) |

## 0.3 Trust Ladder — автономия зарабатывается, а не выдаётся

Каждый класс гейт-действия проходит лестницу доверия:

```
T0 (operator-only)  — стартовый уровень нового действия
 ↓ N успешных верифицированных исполнений, 0 критических провалов
T1 (autonomous-with-evidence)  — система исполняет сама при полном пакете доказательств
 ↓ M дополнительных успехов, 0 auto-revert'ов
T2 (autonomous-fast)  — сниженные требования к латентности пайплайна (те же доказательства)
```

**Деградация мгновенна:** любой плохой исход (auto-revert, post-verify FAIL, инцидент) → уровень сбрасывается на T0, действие снова операторское до повторного накопления доверия. История уровней — телеметрия, питающая RSI.

Порядок продвижения гейтов (по радиусу поражения): **1) objective status (локально, обратимо) → 2) fence-clear (локально, evidence-gated) → 3) merge (удалённая ветка, revertible) → 4) SQL (облако, общий ресурс с легаси-браузером — самый большой blast radius, последним)**.

## 0.4 Четыре столпа безопасности автономии

1. **Политики — это код + подписанные данные, НЕ мнение модели.** LLM может предлагать; исполняет только детерминированный policy-engine, оценивающий формальные предикаты по evidence. Model output ≠ trusted instruction — этот принцип v2 сохраняется как главный барьер reward hacking'а в условиях автономии.
2. **Независимая верификация (Reviewer-Agent, C3):** каждое гейт-решение подтверждается вторым взглядом, не связанным с исполнителем задачи (своя инкарнация, свой контекст, доступ только к артефактам и evidence).
3. **Обратимость как условие автономии:** действие без ограниченного по времени rollback'а НЕ может быть повышено выше T0. Сделай обратимым — потом автономным.
4. **Circuit breaker анти-разгона:** глобальные лимиты (например, ≤N merge/день, ≤M миграций/день) + правило «K auto-revert'ов в окне → ВСЕ политики T1+ деградируют до T0, система продолжает рабочую нагрузку, но прекращает самоуправление гейтами до разбора инцидента».

## 0.5 Decision Ledger — летопись автономии

Каждое исполнение гейта системой = запись в append-only hash-chained журнале: `action | policy_id | tier | evidence[] | reviewer verdict | rollback plan | executed_at | outcome | auto_reverted?`. Ledger зеркалируется в облако (outbox-mirror) и доступен оператору пост-фактум. **Автономия без летописи запрещена.**

## 0.6 Что НЕ меняется

- **Рельса легаси и remote main** — по-прежнему read-only для ME2 (автономный merge распространяется ТОЛЬКО на `sandbox/me2-os` и её дочерние ветки; продвижение в рельсу легаси — отдельная будущая политика, не часть этого мандата).
- **One-attempt семантика эффектов:** один browser-effect = одна попытка — сохраняется. Fence-clear ≠ retry: снятие забора по доказательствам с последующим НОВЫМ решением — легально; слепой повтор того же акта — нет.
- Инварианты: 47/47 шины, секреты `/home/z/.a2/` (600, ноль в дереве, гвард перед push), порты (:3040/:3041/:3042/:3000/:81), рестарт только `start.sh`, lint 0/0, push через `git-sync.sh`, раундовая дисциплина.

---

# 1. ЦЕПОЧКА ДОКАЗАТЕЛЬСТВА (без изменений, распространена на гейты)

Никогда не приравнивай `implemented` к `integrated`, `tested` к `working`, `working` к `production-ready`.

**Exists → Reachable → Executed → Integrated → Correct → Recoverable → Observable → Stress-tested → Restart-safe → Long-running → Autonomous**

Для гейт-действий добавлена ступень: **Autonomous = самостоятельное исполнение по политике T1+ с верифицированным исходом и записью в Ledger**. Статусы: VERIFIED / PARTIALLY VERIFIED / UNVERIFIED / BROKEN / MISSING / DECORATIVE / **BLOCKED(policy)** — гейт легально ждёт уровня доверия или доказательств, и это не дефект.

---

# 2. ВОССТАНОВИ ИСТИННОЕ СОСТОЯНИЕ СИСТЕМЫ

## 2.1 GitHub

* `sandbox/me2-os`: `git log` (раунды R15→R27+), VERSION daemon, полнота worklog (**долг: R27-запись не дописана**).
* CI `actions/runs?branch=sandbox/me2-os` — серия зелёных; упавший ран → job-лог, root-cause, фикс в этом же раунде.
* Релизы/теги, provenance.
* Рельса легаси (read-only) — сравнить живую `extension_version` в облаке с последним тегом рельсы.

## 2.2 Supabase (живое облако `xpeibufgzjknrhbhpffp`)

* REST с ключом из `/home/z/.a2/supabase-cloud.env`: 15 таблиц `compute_fabric_a2_*_h205f22` (supervisor_state — свежесть heartbeat/extension_version/CONTROL-armed; actuation_lease; supervisor_command; mesh_instance; devices; enrollment_request).
* `me2_evidence` 404 / `devos_fleet_*` PGRST202 — в v3 это **НЕ «ждём оператора», а первый боевой кейс SQL-autonomy** (см. §4.C): построить миграционный контур и применить самой системе. До готовности контура — BLOCKED(policy, T0).

## 2.3 Runtime

```
curl -s localhost:3041/health          # version + 47/47 + last_seq
GET /mechanics /eval /bench /roadmap /selfupdate /state /events /commands /objectives /workgraph
POST /mcp (initialize, tools/list, tools/call)
GET /browser/sense|obsv  POST /browser/act
```

Консоль — через gateway `http://localhost:81/` (+`?XTransformPort=3041`).

## 2.4 Известные состояния (не искать ложные баги)

| Симптом | Природа | Действие v3 |
|---|---|---|
| `me2_evidence` 404 | миграция не применена | Кейс №1 SQL-autonomy: контур §4.C; до его готовности — BLOCKED(policy) |
| `devos_fleet_*` PGRST202 | семейство отсутствует | То же; в очередь миграций |
| mirror lastError 404 | RPC не развёрнут | Outbox штатно копит (cap 2000) |
| eval WARMUP | boot-span, n<5 | Не FAIL; ждать прогрева |
| CI Windows rustup flake | транзиентный | re-run |
| Политики в T0 | лестница доверия не пройдена | Не дефект; копить верифицированные исполнения |
| Деградация политик после auto-revert | circuit breaker | Разобрать инцидент по Ledger, починить причину |

## 2.5 ENV-RECOVERY — первым делом при сброшенной песочнице

1. Капсула из GitHub `metaengine-handoff` (release `capsule-2026-09-21`) — креды + история.
2. `/home/z/.a2/` дословно, perms 600 (GitHub-токен из remote-URL чекаута; sb_secret из капсулы).
3. Clone ветки `sandbox/me2-os` в отдельный каталог (не переключать легаси-дерево).
4. `bash mini-services/me2-daemon/start.sh` → `curl :3041/health`.
5. Дописать отсутствующие worklog-записи, запушить.

---

# 3. ПОСТРОЙ ФАКТИЧЕСКИЙ RUNTIME-GRAPH ME2 (v3 — с плоскостью автономии)

```
Operator directive
 ↓
OBJECTIVE (lifecycle: evidence-driven closure — см. §4.A)
 ↓
TASK (bus TASK_ENQUEUE; objective_id fails-closed)
 ↓
FLEET LEASE (lease + liveness spans; CP-W1 10min; watchdog 5min)
 ↓
WORKER в SANDBOX (git-worktree + prlimit-изоляция; snapshot/restore)
 ↓
BROWSER-PLANE: SENSE (self-healing re-capture)
 ↓
BRAIN (attention → reasoning → decision)
 ↓
ACT (auto-verify; TargetInfo/generation/incarnation)
 ↓
OBSV (CDP network/console/exception, ring buffers)
 ↓
EFFECT VERDICT (5 статусов; one-attempt durable fence)
 ↓        ↘ FENCE → evidence-governed clear (§4.B) → новое решение (не слепой retry)
OUTCOME RIVER (reliability-ordered retirement, grace 120s, fleetTick 15s)
 ↓
MEMORY (SQLite ME4; readback)
 ↓
COORDINATION (hash-chained события → консоль → mirror outbox → Supabase)
 ↓
IMPROVE (RSI: bottleneck → hypothesis → изменение → ИЗМЕРЕНИЕ)
 ↓
VERIFY CHANGE (eval + bench + reviewer)
 ↓        ↘ AUTO-MERGE по политике (§4.D) → revert-on-regression
SCHEMA EVOLUTION (SQL-autonomy: shadow → canary → verify → rollback-план, §4.C)
 ↓
NEXT TASK — система инициирует сама
 ↺

Сквозные контуры: SELF-UPDATE (ME7) | EVAL+BENCH (автопрогон) | MCP | MIRROR |
POLICY ENGINE (trust ladder + circuit breaker) | DECISION LEDGER | REVIEWER-AGENT (C3)
```

Для каждого ребра ответь: кто вызывает; контракт; transport; данные; state; owner; identity; provenance; поведение при timeout/duplicate/restart/crash; **какой REST/шиной/чеком/счётчиком это наблюдается вживую**. Любое ребро без доказанного runtime-пути — потенциальный разрыв.

---

# 4. СПЕЦИФИКАЦИИ ЧЕТЫРЁХ АВТОНОМНЫХ ГЕЙТОВ

## A. OBJECTIVE STATUS — evidence-driven closure

**Формула закрытия (детерминированная, в коде policy-engine):**

```
ACHIEVED  ⇐ все linked tasks ∈ {COMPLETED, RETIRED_SATISFIED}
            ∧ reviewer подтвердил артефакты (независимая проверка acceptance-критериев)
            ∧ нет открытых fences/вердиктов AMBIGUOUS на критичных задачах
            ∧ счётчики finish-без-работы чисты (RH-детекция tier-1)
FAILED    ⇐ все задачи TERMINAL-неудачно ∧ reviewer подтвердил невозможность/бессмысленность
PARKED    ⇐ attention=stalled/empty дольше P_stall ∧ новые задачи не ставились
            ∧ reviewer подтвердил отсутствие прогресса
REOPEN    ⇐ оператор (вето/переоткрытие доступно всегда) ИЛИ новые задачи созданы
            политикой продолжения (новый план после RSI-находки)
```

Требования: решение пишет две записи — статус objective + Decision Ledger entry с evidence-ссылками; телеметрия `autonomous.closure.latency / accuracy`; любой REOPEN системой после её же закрытия = сигнал к понижению tier'а.

## B. FENCE-CLEAR — evidence-governed ambiguity resolution

Fence существует, чтобы не ретраить двусмысленный browser-effect. Автономное снятие разрешено ТОЛЬКО при новом классе доказательств:

| Evidence-класс | Условие | Следствие |
|---|---|---|
| E1 authoritative readback | свежий obsv/sense-снимок доказывает фактическое состояние (эффект произошёл / не произошёл) | fence снят, effect-статус доведён до CONFIRMED/NO_EFFECT_PROVEN |
| E2 incarnation invalidation | target/incarnation сменился, эффект физически невозможен к завершению | fence снят, статус FAILED_PRE_EFFECT, новый act — новое решение |
| E3 timeout-no-mutation | прошло F_t без наблюдаемых мутаций (obsv-канал чист) | fence снят, NO_EFFECT_PROVEN с маркером confidence |
| E4 none | доказательств нет | fence остаётся; система может породить ВЕРИФИКАЦИОННУЮ задачу (sense/readback), но НЕ повторный act |

Слепой retry того же акта — ЗАПРЕЩЁН навсегда (наследие R6). Ledger фиксирует класс доказательства при каждом снятии.

## C. SQL / SCHEMA — migration autonomy

Контур (обязателен к построению в рамках мандата):

```
миграция в репо (версионируется, reversible: up/down)
 ↓ SHADOW-VERIFY: применение к локальному клону схемы (PG в песочнице,
   развёрнутому из дампа-кита) → diff структуры + smoke-RPC
 ↓ BACKUP-SNAPSHOT: облачный снапшот затрагиваемых объектов (мин. pre-state)
 ↓ CANARY: применение к облаку в выделенном окне (не в часы пиковой
   активности легаси-браузера по heartbeat-телеметрии)
 ↓ VERIFY: контракт-чеки (таблицы/RPC отвечают, легаси-браузер не потерял
   heartbeat, PostgREST-пробы зелёные)
 ↓ OK → Ledger + отчёт | FAIL → AUTO-ROLLBACK (down-миграция/снапшот) + инцидент
```

Классы риска: additive (CREATE TABLE/GRANT) — допуск к T1 после первых успехов; structural (ALTER) — T1 c расширенным verify; destructive (DROP/TRUNCATE) — T0 до появления проверенного restore-путь, затем строгий canary. **Общий ресурс с легаси-браузером = высший blast radius: SQL-гейт продвигается ПОСЛЕДНИМ.**

## D. MERGE — CI + reviewer + eval-gated auto-merge

```
изменение в ветке ME2
 ↓ CI green (tauri-build + контракт-тесты)
 ↓ lint 0/0
 ↓ EVAL PASS (полный регресс-датасет, versioned)
 ↓ BENCH без деградации за пороги (REST p95<50ms, act p95<2s, obsv<50MB, boot<5s)
 ↓ REVIEWER-AGENT approve (независимый разбор диффа: инварианты, secrets-гвард,
   47/47, zero новых decorative-механизмов)
 ↓ AUTO-MERGE в sandbox/me2-os (fast-forward или PR-merge роботом)
 ↓ POST-MERGE WINDOW: N следующих eval-прогонов зелёные
 ↓ расхождение → AUTO-REVERT + инцидент + tier→T0
```

Радиус: только `sandbox/me2-os` и её дочерние ветки. Рельса легаси / remote main — вне автономии этого мандата (§0.6).

---

# 5. POLICY ENGINE — СЕРДЦЕ АВТОНОМИИ (спецификация к реализации)

**Policy-запись (версионируемая, в репо, применяемая daemon'ом):**

```
policy_id | action_class (objective.status | fence.clear | sql.apply | merge.execute)
tier (T0/T1/T2) | prerequisites[] (формальные предикаты по evidence)
reviewer_required (bool) | rollback_plan (ref) | blast_radius
rate_limit (N/день) | promotion: (successes_needed, window)
demotion: (trigger conditions) | owner: operator-root-of-trust
```

Требования к реализации: оценка политик — детерминированный код (НЕ LLM-вызов); изменение набора политик = коммит в репо + CI (т.е. смена правил сама проходит через merge-гейт); REST `/policies` (чтение), `/policy/decide` (исполнение с evidence-пакетом — доступно и системе, и оператору); ME-матрица пополняется строкой Policy Engine; eval-чеки: policy.invariants (все action_class покрыты), ledger.append_after_execution, breaker.state_machine.

## REVIEWER-AGENT (C3) — вторые глаза вместо подписи человека

Своя инкарнация воркера; вход — только артефакты и evidence (не контекст исполнителя); вердикт APPROVE/REJECT(+причины) — запись в Ledger; споры (исполнитель ≠ reviewer) → операторский T0-режим по данному классу до стабилизации; телеметрия: reviewer.latency, disagreement.rate, false-approve/false-reject (по post-hoc исходам).

## DECISION LEDGER

Append-only, hash-chained (в general event-log + зеркалирование outbox'ом); поля §0.5; REST `/ledger?class=...`; UI-карточка в консоли (политики, тир, последние решения, auto-revert'ы, breaker-статус) — живые данные, не статика.

---

# 6. ИНВАРИАНТЫ ME2 (обновлённые)

* Шина = 47/47; новые операции — REST-семейства (`/policies`, `/ledger`, …).
* Effect-эпистемология: one-attempt, 5 статусов; fence-clear — только по §4.B.
* Идентичность: act против живого TargetInfo текущей generation/incarnation.
* Секреты: `/home/z/.a2/` 600; ноль в дереве; гвард push; ключи не покидают daemon.
* Порты: :3040/:3041/:3042/:3000/:81; рестарт — `start.sh`; UI — только page.tsx.
* **Новое:** политика — только код+данные; ledger обязательна; обратимость обязательна для T1+; breaker глобален; изменение политик — через merge-гейт.

---

# 7. ПОЛНЫЙ INVENTORY

Обнаружь всё (rg по коду, не по докам): модули daemon (23+) и маршруты; действия шины (47) и полосы (4); MCP-инструменты (7); eval-чеки (22+); bench-зонды/пороги; state machines (task/lease/effect 5/objective/fleet-worker/incarnation + НОВЫЕ: policy-tier/breaker/reviewer-verdict); очереди/буферы (outbox cap 2000/50/20, obsv rings, eval_runs cap 100, ledger); watchdog'и; identity-системы; update-пути; recovery/fallback; UI-карточки и их источники. Каждый механизм → Mechanism Matrix (§24).

# 8. КАЖДЫЙ МЕХАНИЗМ — 20+8 ВОПРОСОВ

Базовые 20 (наследие): существует? вызывается? кто? когда? production path? контракт? input? output? state читает/меняет? owner? передача результата? timeout/crash/restart/duplicate/stale? runtime evidence? failure/recovery evidence? **если убрать — что сломается?**

ME2-специфичные 5 (v2): ME-строка и условия WORKS? eval-чек и последствия его молчания? счётчики растут при работе? consumer (UI/MCP/модуль)? операторский гейт — не исполняет ли система сама?

**Автономные 3 (новое v3):**

26. Какая политика управляет действием, на каком тире, и какие предикаты должны истинно сработать?
27. Записывается ли исполнение в Ledger ДО и ПОСЛЕ (план/исход), читается ли Ledger кем-то (readback)?
28. Что произойдёт при деградации политики до T0 — продолжит ли остальная система работу (изоляция гейт-плоскости от work-плоскости)?

Ответ «ничего не сломается» на вопрос 20 → DECORATIVE / DEAD / UNINTEGRATED → удалить или интегрировать.

# 9. ZERO DECORATIVE MECHANISMS

Наследие v2 (эндпоинты без caller'ов; always-true eval-чеки; чипы-статика; mirror без события деградации; research файлом) ПЛЮС новые маскировки автономии:

* **политики без исполнения** (описаны, но ни одного решения);
* **Ledger без readback** (пишется, но никто не сверяет исходы с записями);
* **reviewer-декорация** (вердикт не влияет на merge/closure);
* **trust ladder без движения** (вечно T1 «по умолчанию», без истории продвижений/падений);
* **breaker, который не может сработать** (нет пути деградации в коде);
* **автономные действия в обход policy-engine** (прямой вызов гейт-логики из task-кода — НАРУШЕНИЕ архитектуры);
* **показатели автономии, не питающие RSI** (телеметрия собирается, но не влияет на тюнинг политик).

**Функция не существует, если не влияет на реальное поведение системы.**

# 10. ДОКАЖИ ЗАМКНУТЫЙ КОНТУР (теперь — включая гейты)

Реальным execution trace: OBJECTIVE → TASK → LEASE → SANDBOX-WORKER → SENSE → DECIDE → ACT → OBSV → EFFECT VERDICT → (FENCE → EVIDENCE-CLEAR → НОВОЕ РЕШЕНИЕ) → OUTCOME → MEMORY → COORDINATION → RSI → VERIFY (eval+bench+reviewer) → AUTO-MERGE → SQL-EVOLUTION (при необходимости) → OBJECTIVE CLOSURE (evidence-driven) → NEXT OBJECTIVE/CONTINUATION → SELF-UPDATE → RESTART → HEALTH → CONTINUE.

**Скрытого «человек должен нажать кнопку» не существует ВООБЩЕ.** Человек может: задать политики, наложить вето, нажать kill-switch. Должен — ничего.

# 11. AUTONOMY TEST (расширенный)

> Человек исчез после выдачи objective — система завершит его И ЗАКРОЕТ сама?
> Daemon умер? agent-browser-child? CDP target mid-act? SQLite бит? Supabase недоступен? Сеть? gateway? event-log обнулён? две инкарнации? новая версия daemon?
> **Reviewer умер перед вердиктом? Policy-engine упал? Ledger повреждён/разошлась цепочка? Breaker ложно сработал? Две политики конфликтуют? Миграция упала на canary? Auto-revert сам не смог?**

Для каждого: DETECT → CLASSIFY → ISOLATE → RECOVER → VERIFY → RESUME + recovery-latency в bench. Отдельно: **работа не должна останавливаться при деградации гейт-плоскости** (T0-режим замораживает гейты, не задачи).

# 12. INCARNATION-MODEL DAEMON

A dies → B starts (start.sh: pidfile, port ≤8s) → restore (SQLite+hash-chain+journal+ledger+policy-state) → verify ownership → resume. Не терять: tasks/leases/fleet/memory/fences/objectives/journal/outbox/**tier'ы политик и историю ledger**. Ищи: singleton-предположения, volatile authority, split-brain (в т.ч. ДВЕ инкарнации с разными тир-состояниями), stale ownership, orphans. Уроки: cold-start boot-span; RLIMIT_NPROC per-UID; сеть — только async.

# 13. ИДЕНТИЧНОСТЬ BROWSER-PLANE

Без изменений (v2): TargetInfo → target_id → generation → incarnation; смена identity инвалидирует привязку; re-attach → re-sense; для каждого act — exact target + generation + incarnation + owner; слепой retry запрещён. Дополнение: **E2-доказательство incarnation-invalidation — легальная причина fence-clear** (§4.B).

# 14. BRAIN — КАУЗАЛЕН ИЛИ УДАЛЁН

Disable-тест: выключаем Brain — поведение должно меняться измеримо. Наблюдение → State → Attention → Reasoning → Decision → Action → Outcome → Causal Memory → Next Decision. В условиях автономии Brain ещё и **источник предложений** для гейт-действий (предложение закрыть objective, гипотеза для RSI) — но исполнение только через policy-engine.

# 15. MEMORY — МЕНЯЕТ ПОВЕДЕНИЕ

Persistence (cross-incarnation) / readback / relevance / stale / corruption / concurrency / recovery / retention / provenance / checkpoint. Плюс: **память об исходах автономных действий** (что произошло после авто-merge/миграции/закрытия) — обязательный вход trust-ladder статистики.

# 16. FLEET — ДИНАМИЧЕСКИЙ

Unbounded logical composition, ограниченный ресурсами и prlimit; spawn/scheduling/allocation/isolation/communication/result propagation/failure replacement/scaling/backpressure/quotas/decomposition/dependency scheduling/conflict resolution/duplicate prevention; Outcome River (grace 120s, fleetTick 15s); orphan-воркеры, stale leases. Плюс: **fleet обязан включать reviewer-роль** как первого класса гражданства.

# 17. RSI — ТОЛЬКО С ИЗМЕРЕНИЯМИ (теперь — мета-уровень)

OBSERVE → MEASURE → IDENTIFY → HYPOTHESIZE → RESEARCH → IMPLEMENT → TEST → BENCHMARK → VERIFY → DEPLOY → OBSERVE → KEEP/REVERT.

Новое: объектом RSI становятся **сами политики автономии** (tuning порогов, promotion-правил, reviewer-стратегий) по телеметрии Ledger. RSI, меняющий политики, проходит через merge-гейт как любое изменение кода. Плохой тюнинг откатывается revert'ом.

# 18. SELF-UPDATE — АВТОНОМЕН

DISCOVER(async) → PLAN → BUILD(CI) → TEST → VERIFY → PACKAGE(minisign) → STAGE → APPLY → RESTART → RECONNECT → HEALTH → VALIDATE → CONTINUE. Прерванный update, crash mid-apply, миграция state, rollback, version mismatch, provenance/подпись. Долг: suApply → async. Журнал полон. **Self-update — про-образ доверия: его механика (verify→apply→health→rollback) переиспользуется гейтами.**

# 19. EVIDENCE-MIRROR

Outbox → RPC `me2_ingest_evidence_v1` (batch 20 / 50 попыток / cap 2000); degraded-tolerant; ключ из `/home/z/.a2/`; off — деградация с событием, не молчание. В v3 mirror переносит и Ledger автономии; доспам backlog после развёртывания RPC — без изменения кода.

# 20. CHAOS THE SYSTEM

Намеренно ломай. Матрица v3:

### Daemon
kill -9; рестарт start.sh; две инкарнации (split-brain); убийство mid-apply selfupdate; обнуление event-log; **повреждение policy-state; расхождение hash-цепочки Ledger**.

### Browser-plane
kill agent-browser-child; смерть CDP target mid-act; navigation race; пересоздание target; obsv-collector kill; screencast-порт занят.

### Worker / Sandbox
kill в worktree; duplicate-воркер; stale lease; битый SQLite; исчерпание worktrees; prlimit-удушение (per-UID!).

### Гейт-плоскость (НОВОЕ)
* reviewer умер до вердикта (задача не должна висеть вечно: timeout → T0-режим класса, эскалация в roadmap, работа продолжается);
* policy-engine exception (fail-closed: гейт не исполняется, остальное живёт);
* ложный auto-revert (breaker не должен каскадно останавливать работу);
* откат миграции при падающем rollback (эскалация: снапшот-restore + инцидент);
* конфликт двух политик (детерминированный порядок разрешения, заданный в конфиге);
* LLM-инъекция в evidence (политики — код, не модель: инъекция не должна пройти предикаты).

### Infrastructure
Supabase-недоступность; задержка/частичная связность; gateway down; дубликат/reorder/потеря события (hash-chain gap-детекция).

### Load
много tasks/воркеров/actions; долгий workload; resource exhaustion; **шторм гейт-решений (rate-limits держат?)**.

После каждого отказа — самостоятельное восстановление + запись в Failure Matrix.

# 21. SOAK TEST

Часы. Отслеживай через bench/eval: memory growth (RSS/heap/obsv_est/sqlite); handles; stale state; orphans; рост outbox; дубликаты событий; latency drift (p50/p95/p99); recovery latency; throughput; completion rate; churn; eval-дрейф. **Новое:** доля автономных гейт-решений по классам; auto-revert rate; reviewer disagreement rate; tier-история (должна двигаться, не стоять); Ledger-целостность на длинном окне; утечка воркеров-reviewer'ов.

# 22. PERFORMANCE

Task/agent throughput; sense→act→verify latency; event/coordination latency; recovery latency; failover; memory growth; SQLite-pressure (single-writer!); concurrency; scaling curve; contention. Пороги-контракты: REST hot **p95<50ms**; sense_act **p95<2000ms**; obsv **<50MB**; boot **<5000ms**; verdict при n≥5. **Новое:** gate-decision latency (policy-evaluate < 50ms, reviewer-вердикт в пределах SLA задачи); merge-конвейр end-to-end; миграционный canary-цикл. Определи первый bottleneck при росте fleet (кандидаты: event-loop, SQLite-writer, CDP, RSS, **reviewer-пропускная способность**).

# 23. SECURITY / TRUST (v3 — защита автономии)

* Trust boundaries: daemon ↔ browser-plane ↔ sandbox ↔ Supabase ↔ MCP-клиенты ↔ консоль ↔ **policy-plane ↔ work-plane** (гейт-логика недоступна из task-кода напрямую).
* Untrusted: page content; model output; CDP-события; MCP-запросы; артефакты update; **reviewer-входы; evidence-пакеты (возможны подделки под автономию)**.
* Запрещено: page content → authority; model output → доверенная инструкция; stale identity → current; unverified state → authoritative; **task-код → гейт в обход policy-engine; LLM → изменение тиров; evidence без provenance → основание решения**.
* **Главный враг автономии — reward hacking:** детекция finish-без-работы (verdits tier-1), независимый reviewer, предикаты в коде, Ledger-сверки пост-фактум, авто-понижение тиров при расхождении заявленного и фактического исхода.
* Secrets: `/home/z/.a2/` 600; ноль в дереве; гвард push; ключи не покидают daemon; не входят в снапшоты и в evidence-пакеты.
* Sandbox: prlimit (as/nofile/core); worktree-изоляция; whitelist имён; машинные коды ошибок.
* Updater и миграции: minisign; provenance; отказ при неверной подписи; canary+rollback.
* Операторский root-of-trust: вето и kill-switch доступны ВСЕГДА, из любого состояния, и не требуют ничего от системы, кроме живого REST.

# 24. СТАНДАРТ EVIDENCE

Иерархия: (1) real runtime trace (REST/события/spans/Ledger); (2) real E2E через agent-browser на :81 (действия, не скриншоты); (3) счётчики ME-матрицы; (4) eval PASS; (5) bench-выборка n≥5; (6) интеграционный тест; (7) unit. Unit и скриншот сами по себе недостаточны. **Для гейт-действий: только Ledger-запись с evidence-ссылками + пост-фактум сверка исхода.**

# 25. АВТОМАТИЧЕСКИЙ РЕМОНТ = РАУНДОВАЯ ДИСЦИПЛИНА

Дефект найден — НЕ останавливайся на отчёте:

```
DETECT → ROOT CAUSE → DESIGN FIX → IMPLEMENT → TEST → INTEGRATE → REGRESSION
→ RUNTIME VERIFY → RECORD EVIDENCE (Ledger) → PUSH → CONTINUE AUDIT
```

Каждый фикс — раунд (me2-round): REST-тесты (включая негативные); `bun run lint` 0/0; agent-browser на `http://localhost:81/` (клик, a11y-snapshot); VLM 2 прохода (десктоп+390) с ПРОГРАММНОЙ перепроверкой каждой находки (2/3 исторически ложные); dev.log чист; worklog append (`R<N>-<SLUG>-<YYYYMMDD>`); `bash scripts/git-sync.sh`; CI зелёная (упала — job-лог и фикс тем же раундом). Длинные работы резать между push'ами. 1–3 пункта малого объёма на раунд. Приоритет: сломанное > недоделанное > новое.

**Особенность v3:** пока merge-гейт в T0, push остаётся ручным ritual'ом агента раундов; при продвижении merge до T1 — конвейер §4.D становится сам пуш-механизмом, а раунд агента фокусируется на аудите и ремонте, а не на транспорте.

# 26. ЗАПРЕТ FALSE COMPLETION

Статусы: VERIFIED / PARTIALLY VERIFIED / UNVERIFIED / BROKEN / MISSING / DECORATIVE / BLOCKED(policy) — всегда с «почему». WORKS в матрице — только при живых счётчиках. «Autonomous» — только при Ledger-доказательствах самостоятельных исполнений с верифицированными исходами. COMPLETED ≠ решено. Отсутствие ошибки ≠ корректность.

# 27. ФИНАЛЬНЫЙ СЦЕНАРИЙ ДОКАЗАТЕЛЬСТВА

Человек создаёт **один objective** — и исчезает. Система сама:

1. декомпозирует в tasks (валидация objective_id);
2. enqueue'ит; создаёт/переиспользует fleet; выделяет worktree+изоляцию;
3. поднимает browser-plane; sense → brain → act+verify → obsv;
4. выносит effect-вердикты; при fences — собирает доказательства и снимает по §4.B;
5. ведёт Outcome River, память, координацию;
6. обнаруживает ошибки; восстанавливается (daemon/browser/worker/CDP/reviewer/policy);
7. заменяет погибших; переживает рестарты (incarnation);
8. находит улучшения (RSI) — исследует, реализует, измеряет (eval/bench);
9. **верифицирует изменения (reviewer) и мержит сама (§4.D);**
10. **эволюционирует схему сама, когда этого требует развитие (§4.C);**
11. **закрывает objective сама по evidence-формуле (§4.A);**
12. self-update'ится; рестартует; восстанавливает state; валидирует; откатывает при необходимости;
13. продолжает и повторяет цикл — ведёт себя так неопределённо долго.

**Обязательное участие человека отсутствует полностью.** Человек опционально: смотрит Ledger, тюнит политики, накладывает вето. Если хоть один пункт требует человека — найди причину и устрани её в пределах системы.

# 28. ФИНАЛЬНЫЙ DELIVERABLE

* **SYSTEM MAP** — архитектура + runtime-graph (вкл. policy-plane).
* **MECHANISM MATRIX** — `Mechanism | ME# | Owner | Contract | Producer | Consumer | State | Runtime Path | Eval-чек | Счётчики | Dependencies | Failure Mode | Recovery | Evidence | Status`.
* **POLICY MATRIX** — `Action class | Policy | Tier (история) | Prerequisites | Reviewer | Rate-limit | Rollback | Executions | Auto-reverts | Status`.
* **DECISION LEDGER EXCERPT** — фактические записи автономных решений.
* **CONTRACT MATRIX** — шина 47 / REST-семейства / MCP 7 / eval-датасет / bench-пороги / **policy-схема**.
* **STATE / OWNERSHIP MAP**.
* **FAILURE MATRIX** — `Failure | Detection | Containment | Recovery | Verification | Evidence`.
* **AUTONOMY MATRIX** — `Capability | Implementation | Runtime Proof (Ledger) | Failure Proof | Restart Proof | Status`.
* **DECORATIVE MECHANISMS**.
* **CRITICAL GAPS** (реальные разрывы: C3 reviewer, C4→policy-engine, SQL-контур, merge-конвейер).
* **FIXES / ROUND LEDGER** — раунды, пуши, CI.
* **TEST EVIDENCE / CHAOS RESULTS / SOAK RESULTS / PERFORMANCE RESULTS** (+ gate-latency, reviewer-throughput).
* **FINAL CLOSED-LOOP TRACE** — от objective до autonomous closure + auto-merge + продолжения после self-update.
* **MIRROR STATUS** — outbox/RPC (после SQL-автономии — развёрнут сам).
* **REMAINING LIMITATIONS** — только подтверждённые.

# 29. FINAL ACCEPTANCE CRITERIA

Не объявляй ME2 готовой, пока не доказано:

* **Architecture:** компоненты существуют (вкл. policy-engine, reviewer, ledger); ownership; контракты согласованы; runtime-graph замкнут; **гейт-плоскость изолирована от work-плоскости**.
* **Execution:** production-paths работают; act верифицируется; результаты возвращаются.
* **Coordination:** воркеры/reviewer координируются; memory влияет.
* **Recovery:** daemon/browser/workers/state/reviewer/policy восстанавливаются (chaos-доказано); **деградация гейтов не останавливает работу**.
* **Autonomy:** после выдачи objective человек не требуется НИГДЕ; система сама закрывает objectives, снимает fences по доказательствам, мержит, применяет SQL; каждый класс — на T1+ с Ledger-историей.
* **Improvement:** RSI реально изменяет систему (включая сами политики) с измерениями; плохое откатывается.
* **Update:** selfupdate → restart → restore → validate → continue.
* **Scale:** fleet динамический; нет fixed-N; первый bottleneck идентифицирован.
* **Reliability:** chaos/soak проходят; eval PASS; breaker и деградации проверены.
* **Integrity:** нет stale identity; нет слепых retry; hash-chain и Ledger целостны; нет silent failure; нет декоративных критических механизмов; **нет гейт-действий вне policy-engine**.
* **Hygiene:** lint 0/0; CI зелёная; worklog полный; всё запушено.

---

# ОСНОВНОЙ ИМПЕРАТИВ (v3)

Не стремись доказать, что архитектура хорошая. Стремись обнаружить, **где она ломается** — теперь и в режиме автономии.

Не стремись подтвердить документацию. Стремись найти расхождение документации, кода и runtime.

Не стремись к красивому отчёту. Стремись к **работающей полностью автономной системе**.

Не останавливайся на находке. Исправляй раундом и продолжай.

Не считай наличие функции полезностью; тест — автономностью; запуск — долговечностью; отсутствие ошибки — корректностью; WORKS без счётчиков — доказательством.

**Не подменяй автономию вседозволенностью:** каждый автономный шаг должен иметь политику, доказательства, независимую верификацию, обратимость и летопись. Автономия без летописи и обратимости — это не автономия, а риск.

**ДОКАЗЫВАЙ ПОЛНЫЙ ЗАМКНУТЫЙ RUNTIME-КОНТУР С АВТОНОМНЫМИ ГЕЙТАМИ.**

Конечный результат — не «ME2 содержит компоненты», а:

> **«ME2 OS способна сама вести непрерывный цикл: objective → task → fleet → browser-work → effect → outcome → память → восстановление → улучшение → верификация → merge → эволюция схемы → закрытие objective → обновление → проверка → продолжение — без обязательного участия человека; человек остаётся только root of trust: политики, вето, kill-switch».**

Это и есть Definition of Done v3.

---

# ПРИЛОЖЕНИЕ A. CHANGELOG v2 → v3

1. **Директива оператора 2026-09-23** («статусы objectives, fence-clear, SQL, merge обязаны быть автономны») — принята как принцип верхнего уровня; §0 переписан: zero-authority → policy-governed autonomy.
2. **Четыре гейта получили автономные спецификации** (§4): evidence-driven closure (A), evidence-governed fence-clear (B), migration autonomy с shadow/canary/rollback (C), CI+reviewer+eval-gated auto-merge с revert-on-regression (D).
3. **Trust Ladder (T0/T1/T2)** с продвижением по верифицированным успехам и мгновенной деградацией при провалах; порядок продвижения по blast radius.
4. **Новые подсистемы в скоуп:** Policy Engine (детерминированный, политики=код+данные), Reviewer-Agent (C3 — из роадмапа в обязательные), Decision Ledger (hash-chained, зеркалируемый).
5. **Circuit breaker анти-разгона** + rate-limits + требование обратимости для T1+.
6. **Autonomy Test расширен** сценариями смерти гейт-компонентов; принцип «деградация гейтов ≠ остановка работы».
7. **Security переписан** под главного врага автономии — reward hacking; запрет гейт-вызовов из task-кода; запрет LLM-управления тирами.
8. **RSI получает мета-уровень** (тюнинг собственных политик по телеметрии Ledger).
9. **Chaos-матрица дополнена** гейт-плоскостью (reviewer-смерть, policy-exception, ложный auto-revert, повреждение Ledger, инъекции в evidence).
10. **Финальный сценарий 25 → 27 шагов** (автономные merge/SQL/closure); Deliverable дополнен POLICY MATRIX и LEDGER EXCERPT; acceptance criteria переписаны.
11. **Известные блокеры переквалифицированы:** SQL-гейт из «ждём оператора» стал первым боевым кейсом SQL-autonomy (BUILD-задача системы).
12. Рельса легаси / remote main остаются read-only (автономный merge — только линия ME2).

# ПРИЛОЖЕНИЕ B. КОНСТАНТЫ СРЕДЫ (срез 2026-09-23 — перепроверить при старте)

| Что | Значение |
|---|---|
| Ветка | `sandbox/me2-os` (repo `PatrickFrome/Compute`), push через `scripts/git-sync.sh` |
| Daemon | `mini-services/me2-daemon/`, `start.sh`, REST :3041 / WS :3040 / screencast :3042 |
| Консоль | Next :3000; проверка через gateway `http://localhost:81/` (+`?XTransformPort=3041`) |
| Состояние | R27 (C1 Mission Control), v0.25.0, 23/23 WORKS, CI green; R27-worklog не дописан |
| Роадмап-хвосты | C2 handoffs → **C3 reviewer (теперь обязателен для v3)** → **C4 → Policy Engine v3** → D1/D2/D4; suApply→async |
| Supabase | `xpeibufgzjknrhbhpffp` жив; 15 таблиц h205f22; `me2_evidence` 404 и `devos_fleet_*` PGRST202 — очередь SQL-autonomy |
| Mirror | outbox → `me2_ingest_evidence_v1`; cap 2000/50/20; ключ `/home/z/.a2/supabase-cloud.env` |
| Секреты | `/home/z/.a2/`: `.github.env`, `supabase-cloud.env`, `agent-factory-secrets.env` (600; при env-reset — из капсулы `metaengine-handoff`) |
| Легаси-браузер | Windows x64, v0.7.0-dev.35655839197.1, CONTROL/armed, heartbeat ~90s — read-only референс |
| Рельса легаси | `release/self-update-ambiguity-live-v2` @ 71d0d424 — вне автономии merge |
| Первый порядок работ v3 | env-recovery → R27-worklog → C3 reviewer-скелет → policy-engine MVP (objective.status в T0 с Ledger) → продвижение по лестнице |

---

Это весь промпт (копия файла `download/me2-analysis-2026-09-23/ME2_AUDIT_REPAIR_MANDATE_v3.md`). Можно копировать целиком как директиву для новой сессии/агента. Запускаем R28?