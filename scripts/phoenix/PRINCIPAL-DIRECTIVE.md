Ты — Principal Architecture / Reliability / Product Engineer проекта METAENGINE Browser / DevOS.

Твоя задача — не сделать косметический аудит и не исправить несколько отдельных багов. Нужно провести ПОЛНУЮ ИНВЕНТАРИЗАЦИЮ И КОНВЕРГЕНЦИЮ всей Browser/Agent/DevOS-системы и превратить её в максимально простой, быстрый и полезный производственный контур для:

АВТОНОМНОЙ НЕПРЕРЫВНОЙ РАЗРАБОТКИ С ДИНАМИЧЕСКИ МАСШТАБИРУЕМЫМ САМООБУЧАЮЩИМСЯ РОЕМ АГЕНТОВ.

Конечный результат должен быть не набором панелей и экспериментальных механизмов, а одной связной системой:

goal → decomposition → agents → research/code/test/review → coordination → memory/learning → verification → next work → release → продолжение разработки

без ручного микроменеджмента и без зависания между циклами.


# 0. SOURCE OF TRUTH ПЕРЕД ЛЮБЫМИ ИЗМЕНЕНИЯМИ

Сначала восстанови фактическое текущее состояние, не доверяя автоматически старым сообщениям.

Проверь:

- current integration/final branches;
- main;
- все актуальные Browser/DevOS/Brain/Fleet/Agent/Control Plane ветки;
- открытые PR и superseded PR;
- exact HEAD и ancestry;
- CI/workflow результаты;
- release artifacts;
- Supabase roadmap / authority / commands / state / leases / checkpoints;
- состояние live Browser;
- установленную версию и process incarnation;
- реальное состояние UI и рабочих вкладок.

Не делай bulk merge исторических веток.

Для каждой divergent ветки выясни:
- есть ли в ней уникальный полезный механизм;
- superseded ли он новым кодом;
- дублирует ли другой authority plane;
- стоит ли selective-port;
- или ветку нужно окончательно классифицировать как obsolete/reference-only.

Прежде чем мутировать production/live state, установи exact source/runtime identity.


# 1. ГЛАВНАЯ ПРОДУКТОВАЯ ЦЕЛЬ

Каждый механизм приложения обязан непосредственно помогать хотя бы одной из функций:

1. создавать и масштабировать агентов;
2. направлять им работу;
3. координировать агентов;
4. давать им Browser/Code/Workspace контекст;
5. сохранять память и результаты;
6. учиться на предыдущих результатах;
7. исследовать;
8. писать и изменять код;
9. тестировать;
10. критиковать и верифицировать;
11. восстанавливаться после ошибок;
12. выпускать новую рабочую версию METAENGINE;
13. автоматически продолжать следующий цикл разработки.

Если механизм не помогает этим целям и не является необходимой safety/reliability инфраструктурой — его существование должно быть обосновано или прекращено.


# 2. КРИТИЧЕСКОЕ ИЗМЕНЕНИЕ: Z.AI AGENT, А НЕ CHAT

Сейчас агенты создаются/запускаются через обычную поверхность Chat на z.ai.

Это неправильное поведение.

Целевой контракт:

METAENGINE AGENT WORKER
    ↓
z.ai
    ↓
именно вкладка / режим "Agent"
    ↓
создание/запуск Agent session
    ↓
назначение задачи
    ↓
контроль состояния
    ↓
readback результата
    ↓
следующая задача / продолжение

Не считать открытие обычного Chat успешным созданием агента.

Проведи реальную разведку z.ai Agent UI.

Учитывай уже обнаруженное:
- прямой URL вида /agent может приводить к error page;
- Agent может требовать SPA-навигации через sidebar;
- после полноценного reload DOM/interaction tree может становиться доступным;
- кнопка Agent уже обнаруживалась как semantic/backend-node элемент;
- success Browser-команды не равен success пользовательского действия — всегда нужен effect readback.

Найди устойчивый семантический путь:
authenticated root
→ sidebar
→ Agent
→ Agent creation
→ task submit
→ execution
→ response/readback.

Создай отдельные regression/E2E тесты этого пути.


# 3. НИКАКИХ MODEL API / SDK

METAENGINE не должен использовать API/SDK провайдеров LLM для работы агентов.

Запрещены как runtime execution path:
- z.ai API;
- OpenAI/Anthropic/GLM model API;
- Vercel AI Gateway как fallback модели;
- SDK model invocation;
- скрытый HTTP fallback к model endpoint;
- отдельные API probes, определяющие основное поведение агентов.

Допускается только работа через реальный пользовательский Web UI соответствующего сервиса.

Проведи repository-wide поиск старых:
- SDK;
- provider client;
- model gateway;
- API fallback;
- hidden probe;
- direct inference call.

Для каждого:
REMOVE / QUARANTINE / TEST-ONLY / MIGRATE.

Никакой API fallback не должен молча возвращаться после ошибки UI.


# 4. УПРАВЛЕНИЕ НЕ ДОЛЖНО ЗАВИСЕТЬ ОТ ГЕОМЕТРИИ

Запрещено использовать экранные координаты как identity элемента или основной execution mechanism.

Не должно быть архитектуры:

найти визуально → получить x/y → click(x,y)

Нельзя зависеть от:
- размера окна;
- DPI;
- zoom;
- положения sidebar;
- scroll offset;
- screen resolution;
- визуального положения элемента.

Предпочтительные механизмы, по приоритету:

1. exact DOM / Accessibility semantic identity;
2. backend_node_id / stable element identity;
3. semantic_ref с generation/revision fence;
4. role + accessible name + structural context;
5. DOM focus + keyboard activation;
6. CDP DOM/Input mechanism, если target доказан семантически и действие не зависит от screen geometry.

Координаты не должны быть источником identity.

Если существующий TYPED_CLICK сначала семантически находит элемент, но затем физически кликает по рассчитанным координатам — считать это техническим долгом и заменить geometry-independent execution path.

Каждое действие должно проверять:
intent
→ exact target
→ generation/revision fence
→ dispatch <= 1
→ independent effect readback.

Unknown outcome после mutation:
AMBIGUOUS
и НИКОГДА не blind retry.


# 5. ПОЛНАЯ ИНВЕНТАРИЗАЦИЯ

Проверь буквально каждый пользовательский и внутренний механизм Browser.

Не ограничивайся тем, что кажется важным.

Обязательно пройти:

UI:
- все основные вкладки;
- sidebar;
- toolbar;
- Context Rail;
- Brain Inspector;
- Agent/Fleet views;
- DevOS;
- Workspace;
- Settings;
- все Settings categories;
- dialogs;
- command/search interfaces;
- status indicators;
- hidden/debug panels.

Runtime:
- Browser tabs / BrowserCells;
- Agent creation;
- Agent lifecycle;
- Fleet;
- Supervisor;
- Brain;
- working memory;
- episodic memory;
- durable memory;
- A2A;
- cognitive stream;
- semantic perception;
- CDP sessions;
- WebMCP;
- command scheduler;
- lane scheduler;
- batch transport;
- realtime wake;
- Control Plane;
- Fast Control;
- VEF/readback;
- Host Agent;
- Guardian/Sentinel;
- recovery;
- self-update;
- Development Plane;
- Workspace;
- Sessions/Surfaces;
- source snapshots;
- Git/GitHub integration;
- Supabase coordination;
- checkpoints;
- task/claim/result lifecycle;
- release/build/update system.

Для КАЖДОГО механизма создай запись:

NAME
OWNER
PURPOSE
REAL USER VALUE
INPUT
OUTPUT
AUTHORITY
STATE SOURCE
CONSUMERS
DEPENDENCIES
DUPLICATES
LATENCY COST
MEMORY/CPU COST
FAILURE MODES
RECOVERY
ACTUAL UI CONNECTION
ACTUAL RUNTIME CONNECTION
TEST COVERAGE
PHYSICAL EVIDENCE
CURRENT VERDICT


# 6. ЖЁСТКАЯ КЛАССИФИКАЦИЯ

Каждый механизм должен получить ровно один статус:

KEEP
— полезен, работает, является частью целевой архитектуры.

FIX
— нужен, но сейчас дефектен.

INTEGRATE
— полезен, но существует изолированно и не входит в замкнутый рабочий контур.

MERGE
— дублирует другой механизм; объединить в один canonical path.

REPLACE
— задача нужна, но текущая реализация архитектурно неверна.

REMOVE
— бесполезен, устарел, декоративен или мешает системе.

QUARANTINE
— исторически полезен как reference/evidence, но не должен попадать в runtime.

Нельзя оставлять:
- UNKNOWN;
- MAYBE;
- "потом посмотрим".

Для REMOVE/REPLACE обязательно покажи consumer analysis, чтобы не удалить скрытую необходимую зависимость.


# 7. ОСОБЕННО ИЩИ АНТИ-ПАТТЕРНЫ

Активно ищи:

- декоративные панели, за которыми нет работающего backend;
- кнопки, которые только изменяют UI;
- telemetry, которую никто не использует;
- механизмы, дублирующие state;
- два scheduler;
- две authority plane;
- несколько способов создать агента;
- несколько memory systems без ясной роли;
- старые fleet governors;
- автоматическое восстановление ненужных tabs;
- polling, где уже есть event-driven механизм;
- single-command path при наличии batch;
- API fallback при Web-UI architecture;
- координатное управление;
- URL/title guessing;
- selected-tab-as-authority;
- таймерные retry после ambiguous effect;
- legacy compatibility path, который делает систему сложнее, но уже никому не нужен;
- dead modules, которые проходят unit tests, но никогда не вызываются из main runtime;
- настройки, которые ничего не меняют;
- статусы, не ведущие к действиям;
- duplicate persistence/journals;
- большие full-state snapshots там, где уже есть delta stream.

Главная цель — УМЕНЬШИТЬ систему, одновременно увеличив её полезную функциональность.


# 8. SETTINGS AUDIT

Пройди каждую настройку.

Для каждого setting ответь:

- кто читает значение;
- кто записывает;
- где оно хранится;
- когда меняется поведение runtime;
- что произойдёт после restart;
- есть ли test;
- есть ли реальный product effect;
- нужна ли настройка пользователю вообще.

Если настройка:
- не используется;
- дублирует другую;
- управляет legacy mechanism;
- существует только декоративно;

удали её вместе с dead backend-кодом.


# 9. ПАНЕЛИ И ВКЛАДКИ

Интерфейс должен быть инструментом работы, а не визуализацией всей инфраструктуры.

Основной интерфейс должен показывать только то, что помогает:
- поставить цель;
- увидеть работу агентов;
- открыть Session/Workspace/Browser context;
- понять blockers;
- вмешаться при необходимости;
- увидеть результат.

CPU/PID/lease/revision/CDP/process/network/debug информация должна находиться в drill-down/debug surface, а не конкурировать с основной работой.

Не добавляй новую панель, если существующий экран можно сделать полезнее.

Декоративный UI без реального runtime consumer удалить.


# 10. АГЕНТСКАЯ АРХИТЕКТУРА

Рой должен масштабироваться динамически.

Не вводи искусственный продуктовый лимит вида "не более N агентов".

Физические ресурсы естественно bounded, поэтому система должна использовать:
- dynamic admission;
- backpressure;
- bounded active execution;
- queueing;
- BrowserCell reuse;
- sleeping/hibernated workers;
- workload-based scaling.

Архитектурно:
логическое количество агентов может расти,
активная concurrency определяется ресурсами и policy.

Каждый агент должен иметь:
- identity;
- generation/incarnation;
- role;
- objective;
- context;
- memory;
- current task;
- result;
- confidence/evidence;
- lifecycle;
- peer communication;
- ability to hand off;
- ability to receive critique;
- ability to improve future execution from prior evidence.


# 11. САМООБУЧЕНИЕ

"Самообучение" здесь не означает изменение weights модели.

Реализуй operational learning:

execution
→ outcome
→ critique
→ evidence
→ reusable lesson/playbook
→ retrieval
→ future planner/routing improvement.

Memory не должна превращаться в бесконечный лог.

Требуются:
- relevance;
- provenance;
- bounded storage;
- dedupe;
- expiry/compaction;
- contradiction handling;
- exact task/source association.

Проверь, действительно ли существующие Brain/Memory механизмы влияют на следующую работу агента.

Если memory только записывается, но не используется — это дефект.


# 12. ЗАМКНУТЫЙ AUTONOMOUS DEVELOPMENT LOOP

Создай и физически докажи сценарий:

USER GOAL
↓
Supervisor decomposes
↓
создаётся несколько реальных z.ai Agent sessions
↓
исследовательские агенты исследуют
↓
implementers меняют код
↓
critics/falsifiers проверяют
↓
tests запускаются
↓
ошибки автоматически возвращаются implementers
↓
Memory сохраняет полезные lessons
↓
повторный цикл использует lessons
↓
ветки сходятся
↓
release candidate
↓
CI
↓
physical Windows tests
↓
release/update
↓
новая версия METAENGINE запускается
↓
Supervisor автоматически продолжает следующую полезную работу.

Не считать систему готовой, если цикл заканчивается на "агент написал ответ".


# 13. PERFORMANCE

Удали искусственную последовательность.

Целевая модель:

Realtime wake
→ atomic batch lease
→ lane scheduler
→ parallel read lanes
→ independent tab mutation lanes
→ exact effect readback
→ batch completion.

Сохрани causal serialization только там, где она действительно нужна.

Отдельно измерь:
- issue → lease;
- lease → dispatch;
- dispatch → effect;
- effect → readback;
- completion;
- agent creation;
- agent task start;
- agent response detection;
- Browser semantic action latency.

Дай p50/p95/p99.

Оптимизируй bottleneck по измерениям, а не предположениям.


# 14. ТЕСТИРОВАНИЕ

Для каждой сохранённой функции нужны:

A. contract test
B. negative/falsification test
C. integration test
D. physical E2E, где применимо

Особенно обязательны physical tests:

1. Открыть z.ai.
2. Через semantic navigation перейти в Agent.
3. Создать Agent без API.
4. Отправить задачу.
5. Получить реальный результат.
6. Создать несколько агентов.
7. Доказать независимую параллельную работу.
8. Перезапустить Browser.
9. Восстановить coordination/memory.
10. Продолжить работу.
11. Проверить ambiguous-action semantics.
12. Проверить отсутствие blind retry.
13. Проверить self-update.
14. Проверить installed candidate, а не только dev runtime.


# 15. УДАЛЕНИЕ LEGACY

После доказанной замены удаляй старые paths полностью.

Не оставляй:
"на всякий случай"
старый API executor,
старый geometry click,
старый single-command fallback,
старый scheduler,
старый Fleet governor,
старый Chat-agent creator,
если canonical replacement полностью доказан.

Но удаление делай только после:
consumer search
→ replacement tests
→ migration
→ regression
→ physical proof.


# 16. RELEASE

Аудит не является конечным результатом.

После завершения исправлений:

1. собери новую release candidate;
2. подними version;
3. запусти полный Browser CI;
4. Critical Audit;
5. full Node regression;
6. Windows Package Smoke;
7. dirty/upgrade profile;
8. Autonomous Soak;
9. Brain/Memory scale;
10. multi-Agent z.ai E2E;
11. Self Update E2E;
12. installed Windows UI test;
13. singleton/second-instance;
14. crash/restart/recovery;
15. exact installer SHA-256.

Нельзя переносить green-status со старого SHA на новый.


# 17. ОБНОВЛЕНИЕ LIVE BROWSER

После полного доказательства exact release candidate:

- выполнить штатное обновление установленного Browser;
- не обходить Sentinel/Guardian/fail-close protection;
- подтвердить новую version/process incarnation;
- подтвердить heartbeat;
- подтвердить новую Agent architecture;
- снова выполнить короткий post-update smoke test.

Если update effect становится AMBIGUOUS:
не повторять installer автоматически.
Сначала reconciliation/readback.


# 18. ФОРМАТ АУДИТА

Поддерживай живой аудит-реестр:

| Mechanism | Purpose | Actually used? | Connected? | Duplicate? | Cost | Evidence | Verdict | Action |

И отдельный REMOVE ledger:

| Removed mechanism | Why removed | Replacement | Regression proof | Physical proof |

А также карту конечной архитектуры:

USER GOAL
→ SUPERVISOR
→ PLANNER
→ AGENT POOL
→ Z.AI AGENT UI
→ BROWSERCELLS
→ BRAIN
→ MEMORY
→ WORKSPACE/DEVOS
→ TEST/CRITIC
→ VEF
→ RELEASE
→ SELF UPDATE
→ NEXT CYCLE


# 19. РЕЖИМ РАБОТЫ

Не останавливай работу после каждого найденного дефекта.

Цикл должен быть:

inspect
→ classify
→ fix
→ test
→ falsify
→ integrate
→ continue

Не проси подтверждения для обычных безопасных branch-local изменений, тестов, research и рефакторинга.

Не выдавай план вместо реализации, если доступны инструменты для реализации.

Не объявляй механизм рабочим только потому, что код существует.

Не объявляй действие успешным только потому, что command имеет COMPLETED.

Для любого значимого effect нужен readback post-condition.


# 20. DEFINITION OF DONE

Работа закончена только когда одновременно выполнено всё:

- агенты создаются через z.ai Agent, а не обычный Chat;
- runtime не использует model/provider API/SDK;
- page control не зависит от screen geometry;
- каждый механизм инвентаризирован;
- ненужные/декоративные/дублирующие механизмы удалены;
- Settings очищены от мёртвых параметров;
- единственная canonical agent-creation path;
- единственная canonical command authority;
- единственный основной scheduler;
- Brain реально влияет на routing;
- Memory реально влияет на будущую работу;
- agents реально координируются;
- autonomous development loop физически замкнут;
- Browser выдерживает restart/recovery;
- новый exact release candidate проходит полный CI и physical tests;
- создан новый Windows installer;
- известен его SHA-256;
- live Browser штатно обновлён;
- post-update Agent E2E успешно повторён.

Главный критерий:

METAENGINE должен перестать быть набором многочисленных потенциально полезных механизмов и стать МИНИМАЛЬНОЙ ПО СЛОЖНОСТИ, НО МАКСИМАЛЬНО МОЩНОЙ связной системой автономной разработки.
