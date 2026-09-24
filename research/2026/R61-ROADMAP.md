# R61 — IMPLEMENTATION ROADMAP (dependency-ordered DAG, P0–P9)

Раунд: R61 (2026-09-24). Правила: паритет — пол, не потолок (§26); никаких workstream'ов без верификации (§29: Contract→Implementation→Runtime→Test→E2E→Failure-Test→Evidence→Checkpoint); каждый этап = малый вертикальный slice, вписывающийся в раунд (канон R58–R60: 1–2 модуля + eval-прирост + смарт-мерж).

Дисциплина раунда (неизменна): шина 47/47 (расширение = осознанный PR к инварианту), non-bypass манифест пополняется, eval растёт (v25 61/61 → v26+), lint 0/0, секреты не печатаются, смарт-мерж в release через CI-гейты.

---

## DAG (blocked-by → enables)

```
P0-a exec/edit tools (TERMINAL_RUN, FILE_EDIT)
  ├─→ P0-b classifier tier (approvals 3-тир)
  ├─→ P0-c sandbox2 (Landlock+seccomp+net-allowlist)
  ├─→ P0-h mcp-client (mcp_call)
  ├─→ P0-i hooks (пользовательский lifecycle)
  └─→ P0-d durable execution (шаги = действия шины)
        └─→ P2 long-running (25ч+, plan-gate, wake)
P0-e ingress (webhooks-in + GitHub poller)
  └─→ P5 automations (cron+event→задачи, policy-маппинг)
P0-f swarm (planner→worker + handoff.doc)
  ├─→ P0-g plan mode (plans/*.md + build-gate)
  └─→ P3 fleet economics (планировщик-фронт, воркеры-дешёвые)
P0-j envspec (окружение задачи как данные)
  └─→ P2 builds (снапшоты env, форк тёплого)
P1 (36 гэпов) — параллелизуемые: skills SKILL.md, rules, subagent-флаги,
   semantic-index, compaction v2, agent-review v2, rest v2/SSE, CLI, роутер
P4 computer use: desktop-плоскость (VNC/CDP-десктоп) поверх browser-плоскости
P6 self-healing v2: диагностика→починка→verify→resume для envspec/exec
P7 RSI v2: eval-гейты сами предлагают патчи контрактов (уже есть зерно)
P8 self-update v2: обновление модулей daemon'а через durable-контур
P9 superiority: персист-память↔swarm, trace-first ревью, RLS state-plane для флота
```

## Слайсы по фазам

### P0 — Foundation (паритетный минимум harness) — ближайшие 2–3 раунда

| Slice | Контракт | Тест (вкл. failure) | Evidence | Checkpoint |
|---|---|---|---|---|
| exec.ts (TERMINAL_RUN) | exec.request→verdict | timeout-kill; env-утечка→гард | агент чинит тест: edit→run→green | eval v26, PR к шине 47→49 |
| edit.ts (FILE_EDIT) | edit.request{diff}→applied/rollback | кривой diff→отказ+rollback | hash-chain EDIT_APPLIED | тот же PR |
| classifier.ts | classify→allow/sandbox/ask/block | таймаут→ask (fail-closed) | распределение вердиктов на 20 командах | eval v26 |
| sandbox2.ts | sandbox.profile как данные | запись вне workspace→EACCES; сеть deny | ME2_SANDBOX=1 маркеры | eval v27 |
| ingress.ts | ingress.event→TASK_ENQUEUE | HMAC-неверный→401; дубль→skip | GitHub issue→задача сквозь гейт | eval v27 |
| durable.ts | durable.run + intent-log | kill на шаге k→resume k+1 | 6ч прогон, 2 рестарта, zero-loss | eval v28 |
| swarm.ts | handoff.doc v2 | planner-запись→отказ; worker-fail→переразбор | демо objective→2 задачи | eval v28 |
| planmode.ts | plan.item + build-gate | build из DRAFT→отказ | клик в /ui → PLAN_APPROVED | eval v28 |
| envspec.ts | envspec.v1 | failing setup→ENV_SETUP_FAILED | чистый worktree по spec <10 мин | eval v29 |
| mcpclient.ts | mcp_call{server,tool} | неавторизованный→отказ | dogfood: агент вызывает чужой MCP | eval v29 |
| hooks.ts | hook.def + exit-2=блок | хук не может ослабить non-bypass | демо-хук «запрет удаления» | eval v29 |

Каждый slice — один раунд максимум; параллелизуются пары (exec+edit) → (classifier+sandbox2) → (ingress+durable) → (swarm+planmode) → (envspec+mcpclient+hooks).

### P1 — Core Cursor Parity (параллельный трек, раунды параллельно P0)

skills SKILL.md-совместимость → rules.ts (glob) → subagent-флаги (tools/readonly/nesting) → semantic-index (вектора над codegraph) → compaction v2 (plan-state) → agent-review v2 (PR-диффы, auto-after-commit, BUGBOT-аналог) → rest v2 (идемпотентное создание агентов) + SSE-мост → CLI (bin/me2.ts: headless+JSON) → router.ts (2-модельный Cost/Quality по Compass-упрощению) → checkpoints (авто-снапшот+restore) → egress allowlist-движок.

### P2 — Advanced Agent Runtime
long-running 25ч+ (durable+plan-gate+wake-подписки), builds (снапшоты envspec), multi-repo envs, full Remote Control (write-канал /ui), artifacts-видео.

### P3 — Multi-Agent / Fleet
fleet economics (планировщик на сильной модели, воркеры на дешёвой — расчёт 8x-аналога на своих ценах), merge-umpire (нейтральный ревьюер конфликтов), Field Guide (index.md с авто-инъекцией и лимитом строк), parallel best-of-N по воркtree'ам.

### P4 — Computer Use / Browser
desktop-плоскость: X11/VNC-воркер (канон self-hosted computer-use Cursor) поверх песочницы; запись сессии → артефакт; remote-takeover из /ui (release back); browser-плоскость уже PARITY — расширять до enterprise origin-allowlist.

### P5 — Automation (event/schedule plane)
полный маппинг событий ingress→policy→objectives; исходящие webhooks (HMAC); Slack/Linear-поллеры; автоматизация триажа ошибок инструментов (канон harness-errors).

### P6 — Self-Healing v2
контур Environment Diagnosis → Repair → Verify → Resume: envspec-fail → диагностика (missing secret? сеть? deps?) → авто-починка (autoinstall-канон Cursor) → healthcheck → resume задачи; события только на переходах (канон self-audit).

### P7 — RSI v2
eval-гейты сами предлагают патчи: контракты/политики, чьи проверки стабильно падают при изменениях → задача сварм-агенту на предложение правки; человек утверждает (канон «UI не обязан быть read only», но изменения инвариантов — только через PR+CI).

### P8 — Self-Update v2
durable-контур обновляет модули daemon'а: manifest→download→verify→atomic→health-probe→rollback (канон уже E2E зелёный); расписания обновлений через P5.

### P9 — Beyond-Cursor (после паритета; только с evidence)
- Персистентная память × swarm:	Field Guide с каузальной памятью (R35-экономия) — corpus-negative у Cursor.
- Trace-first review: ревьюер читает hash-chain прогона, а не дифф — anti-reward-hack сильнее бенчмарков Cursor.
- State-plane для флота: RLS-gatedSupabase как общий мембранный стейт нескольких daemon'ов (fleet-of-daemons).
- Non-bypass шина как публичный стандарт: внешние агенты (Cursor CLI сам!) подключаются MCP-клиентом и наследуют наши инварианты.

## Verification Plan (как доказываем каждую capability)

1. Контракт в contract.ts (версионируемо) → 2. eval-проверка (позитив + минимум 2 негатива) → 3. живой прогон сквозь гейт :81 → 4. артефакт (скриншот/JSON в research/2026 или download/) → 5. события в hash-chain → 6. mirror-LIVE → 7. смарт-мерж PR (CI 3 гейта) → 8. запись в worklog (Task ID, evidence-пути).

## Benchmark Plan (MetaEngine vs Cursor, объективно)

Единый набор задач (канон §30), каждая фиксируется скриптом + артефактом:

| Категория | Задача-эталон | Метрики |
|---|---|---|
| simple coding | правка + тест одного модуля | completion, время, intervention |
| multi-file feature | фича в /ui через swarm | diff-корректность, ревью-вердикт |
| bug fixing | падающий eval → починка | время, итераций, rollback'ов |
| test generation | негативные тесты для exec.ts | покрытие, качество ассертов |
| debugging | диагностика утечки в bench | найдена причина? evidence? |
| browser interaction | заполнение формы в целевом сайте | success, actions,verify |
| computer use | (P4) сценарий на десктопе | success, запись |
| repo exploration | ответ на вопрос по кодовой базе | точность, токены |
| dependency repair | сломанная зависимость envspec | heal-время |
| CI repair | красный CI → зелёный | время, итераций |
| PR generation | ветка→PR→CI-гейт | end-to-end |
| long-running | 6ч+ durable прогон | zero-loss, resume-время |
| multi-agent | swarm на 2 воркерах | конфликты, handoff-полнота |
| autonomous recovery | kill -9 на середине | resume корректность |

Правило честности: победитель объявляется только по измерениям (время/успех/интервенция/артефакты); Cursor-сторона меряется их публично документированным поведением (CLI headless / cloud agents), ME2-сторона — своими скриптами с артефактами.

## Research → Build Loop (фиксация состояния, §31–32)

Каждый раунд после R61 открывается чтением: R61-PARITY-MATRIX.json (статусы) → выбор следующего незаблокированного slice'а DAG → implementation по шаблону P0 → evidence → worklog. Corpus `/tmp/r61-corpus` воспроизводим (`tool-results/r61/fetch-corpus.py`); при открытии web_search — обновить корпус и прогнать дифф-сверку источников (source registry).

## Source-of-Truth чекпойнты (что фиксировать после каждой стадии)

findings → sources → матрица (JSON) → гэпы → решения → implementation status → evidence → next actions. Всё уже в репо: матрица-JSON + треки + этот roadmap. Следующий Supervisor продолжает с матрицы, не переисследуя доказанное.
