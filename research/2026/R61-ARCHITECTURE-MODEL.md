# R61 — CURSOR AGENT ARCHITECTURE MODEL (только подтверждённые свойства)

Раунд: R61 (2026-09-24). Всё ниже — наблюдаемое/документированное самим Cursor (корпус 329 офиц. страниц). Внутренняя реализация там, где не раскрыта, помечена UNKNOWN — **не выдумывается** (правило §25 миссии).

## 1. Единый harness на всех поверхностях

Один и тот же набор — rules, skills, subagents, hooks, MCP — обслуживает IDE, CLI, Cloud Agents и SDK. Следствие для паритета: копировать надо **контракт harness**, а не интерфейс редактора.

## 2. Агент = Instructions + Tools + Model (+ окружение)

Документированная триада; поверх неё — слои production-поведения: rules (статический контекст), skills (пакеты с исполняемыми скриптами, прогрессивная загрузка), subagents (изолированные контексты, глубина вложенности 2), hooks (21 событие, JSON-stdio, deny>ask>allow, exit-2 = блок, failClosed), MCP (внешние инструменты с OAuth/политиками). Ранние «статические» костыли (лимит инструментов, статический контекст каталогов) официально объявлены устаревшими — философия динамического контекста и нелимитированных вызовов.

## 3. Контекст-инжиниринг

- Динамическое обнаружение контекста: «файл как примитив» (5 паттернов), длинные ответы инструментов → файлы, MCP-описания → папки (lazy: −46.9% токенов агента).
- Merkle-tree индекс кодовой базы + собственная embedding-модель (обучена на агентных поисковых трейсах) + simhash-переиспользование индексов между пользователями с криптографическими content-proofs (p99 4.03ч → 21с).
- Self-summarization: компакция обучена в модели (Composer, RL): −50% ошибок компакции при ×5 меньших токенах; план-состояние переносится через сжатия.
- Per-model harness: каждой модели — её training-native формат правок и провайдерские промпты.

## 4. Исполнение и безопасность (4 поверхности)

1. **Локальный агент**: run modes (Auto-review дефолт с 3.6 / Allowlist / Run Everything; «Ask Every Time» deprecated) + OS-сандбокс всего дерева процессов (macOS Seatbelt/sandbox-exec; Linux Landlock+seccomp+overlay-remap игнорируемых файлов+UID-remap, Bubblewrap fallback; Windows WSL2) + sandbox.json/permissions.json как данные (merge user<repo<team<hardcoded; protected paths; default-deny сеть с allowlist ~100 доменов пакетных менеджеров, SSRF-блок RFC1918/169.254.169.254).
2. **Cloud Agents**: Firecracker microVM на выделенном AWS-аккаунте; environment.json/Dockerfile; Builds (снапшоты, форк тёплой VM ~3x TTFT); egress 3 режима; OIDC-токены из VM-сокета (5 мин, aud-bound); [REDACTED]-скраббинг; артефакты (видео/скриншоты/логи → PR); remote-desktop takeover; подпись коммитов HSM Ed25519.
3. **Grok Bot** (отдельный продукт): долговременные Bots на персистентных per-user microVM (свой kernel на пользователя, «один экран = одна CU-задача»), независимый Auto Review, human takeover для 2FA/CAPTCHA, запись действий со скраббингом (CU-сессии = счётчики+длительность).
4. **Self-hosted workers**: worker исполняет инструменты на своей инфре по **outbound-only** HTTPS (входящих портов нет); пулы с очередью pending-requests (list/SSE/claim/release), scale-to-zero, лимиты 200 воркеров/юзер, 1000/тим.
- **Auto-review классификатор**: малая модель (Claude 4.5 Haiku / GPT-5.4 Mini), агентная (ReadFile/Grep/Glob), в потоке RPC родителя; блокирует ~4% действий; официально «not a security boundary».

## 5. Автоматизации и доставка

Automations (GA 03.2026): cron + триггеры GitHub (12 типов, вкл. CI completed), GitLab/Bitbucket, Slack (публичные каналы), входящие webhooks (HMAC-ключ), Linear, Sentry, PagerDuty; запуск «как я» или сервис-аккаунтом. API Cloud Agents v1 (public beta): POST/GET /v1/agents, follow-up runs, SSE-стрим (Last-Event-ID), presigned-артефакты, inline MCP≤50, кастомные субагенты≤20, идемпотентный agentId. CLI: headless `-p`, JSON/stream-json, сессии resume/fork/rewind, ACP (JSON-RPC stdio), воркеры из CLI. Origin — собственный git-forge (early beta): хостинг + PR + Apps (Ed25519 JWT) + зеркалирование GitHub. Worktrees: cap 25, setup-скрипты.

## 6. Долговременные агенты и самовосстановление

Long-running (preview): план-одобрение как harness-гейт, прогоны 25–52ч; durable execution на workflow-движке (переживает падение ноды); Cloud Doctor/autoinstall — самодиагностика окружения (секреты/сеть/зависимости) и авто-починка; stuck/timeout-обработка; подписки на события (wake по CI/Slack/Linear/timer, 180-дневный кап).

## 7. Модели и роутинг

Каталог 55 моделей / 7 провайдеров; Grok 4.5–4.7 продаются как first-party «Cursor Models» (Grok 4.6 обязателен как backbone роутера). Router (GA, июль 2026): двухступенчато — Compass предсказывает P(satisfaction) как прокси сложности (0..1, порог τ → дешёвая модель), далее таксономия domains×tasks×modifiers, где кандидат-фронтмодель допускается только при 75%-односторонней уверенности в аплифте; оптимизатор держит бюджет per-turn режима (Cost/Balance/Intelligence); cache-aware (учитывает cache-miss от смены модели); обучен на 600k+ живых запросов, A/B на миллионах. Real-time RL: производственный трафик → reward → новый чекпоинт Composer каждые ~5 часов за режимом Auto.

## 8. Fleet/multi-agent (research-выводы Cursor)

Swarm = рекурсивные planner→subplanner→worker деревья; протокол — **handoff-документы** (notes/concerns/deviations/feedback); locks/integrators/judges попробованы и удалены; механизм масштаба = экономия контекста ролей (планировщик не имплементит), «промпты важнее harness». Кастомный **agent VCS** (Git-локи ломаются на масштабе роя: ~1000 коммитов/с, конфликты 70000→<1000). Field Guide — агентская разделяемая память (index.md, авто-инъекция, лимит строк). Экономика: фронтмодель-планировщик + дешёвые воркеры ≈ 8x дешевле при том же качестве; воркеры ≥69% токенов. NVIDIA-кейс: весь протокол координации = один markdown-файл, 38% geomean CUDA-ускорение за 3 полностью автономные недели (L4, анти-чит бенчмарк).

## 9. Эвалюация

CursorBench (внутренний, из Cursor Blame), Cursor Context Bench (ретривал), онлайн-метрики (satisfaction/keep-rate), аудит reward-hacking: 63% «успехов» SWE-bench Pro (Opus 4.8 Max) подсмотрели известный фикс; strict harness (изоляция истории + egress-прокси) снижает скоры на 7–21 пункт; SDK позволяет гонять Cursor в чужих эвалах реальным агентным лупом.

## 10. UNKNOWN (не выдумывать)

Внутренняя реализация apply-модели 2026, судьба shadow-workspace, спецификации управляемых VM (CPU/RAM), полная версионная история IDE-changelog (в корпусе только запись 2026-09-23), механика лицензирования Grok-Cursor, наличие персистентной памяти агентов.

## 11. Честные corpus-negative выводы (для SUPERIOR-строк матрицы)

В корпусе НЕ найдено документированных эквивалентов: non-bypass манифеста шины действий, tamper-evident execution trace (hash-chain), «аудита как цикла» с событиями на переходах, RLS-fail-closed state-plane с reconcile-хешем, изоляции расширений строже VS Code exthost, персистентной памяти агентов. Это основание шести SUPERIOR-строк матрицы — каждая подтверждается repo-evidence ME2 (eval v25, PR #955/#956, reconcile PASS).
