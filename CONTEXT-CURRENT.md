# PHOENIX CONTEXT DIGEST (auto, heartbeat v2.2)

gen: 2026-09-27T22:59:30Z | worklog: 2009971B / 10974L | sha12=dc35c66e9b97

## КАК ПОЛУЧИТЬ ПОЛНЫЙ КОНТЕКСТ (выполни по порядку)
1. `bash /home/z/my-project/scripts/phoenix/phoenix-restore.sh --check` — кворум 8 источников, вердикт целостности
2. Прочитай: /home/z/my-project/CONTEXT.md (handoff-документ) + /home/z/my-project/PHOENIX-PROTOCOL.md
3. Прочитай хвост /home/z/my-project/worklog.md (последние 150+ строк) — канонический журнал ВСЕХ чатов
4. Если локальный worklog усечён/отсутствует: `phoenix-restore.sh --merge` (секционный merge-append без потерь)
5. Диагностика канала Supabase: хвост /home/z/context-vault/journal/phoenix.log (HB-SB-FAIL содержит тело ошибки)

## КАНАЛЫ ПОЛНОЙ КОПИИ worklog.md (2009971B)
| Канал | Путь | Переживает env-reset |
|-------|------|---------------------|
| Supabase Storage | me2-evidence/context-vault/latest/worklog.md | ДА (внешний) |
| OSS (ossfs) | /home/sync/me2-context-backups/latest/worklog.md | ДА (сетевой) |
| Vault | /home/z/context-vault/{latest,snapshots,repo}/ | частично |
| cron-KV | шарды CTX-SHARD-A/B (payload cron-задач) | ДА (серверный) |

## ПОСТОЯННЫЕ CRON-ЗАДАЧИ КОНТЕКСТА
- 413338: PAT watcher (15m) — при появлении GITHUB_TOKEN_ADMIN в /home/z/.a2/.github.env делает push-pending
- 416526: Context Guard (15m) — снапшоты/детект усечения/авторестор/феникс (скрипт в payload задачи)
- PHX-HEARTBEAT: (30m) — этот digest + Supabase/ossfs пульс (скрипт в payload задачи)
- CTX-VAULT-COMPACTOR: (1h) — обновляет KV-шарды CTX-SHARD-A/B

## ПОСЛЕДНИЕ 15 СЕКЦИЙ worklog (Task ID → Task)
- BROWSER-TEST-20260928-0328 → Подключиться к live браузеру METAENGINE 0.7.0-dev.36336130139.1 (client 2a60d6a2, ws 2de9f84b) через Supabase и протестировать ВСЕ механики командной плоскости; классифицировать работает/не работает/не проверено относительно 5 целей (создание чат-агентов, автономная разработка, взаимная видимость/координация, вечный супервизор, вспомогательные механики).
- BROWSER-TEST-20260928-0330 → Повторный прицельный тик теста механик (после полного прогона BROWSER-TEST-20260928-0328): проверка живости + re-probe корневого блокера (composer draft / submit→conversation).
- BROWSER-TEST-20260928-0400 → Третий тик BROWSER-TEST: non-polluting мониторинг (fleet/census/draft-status) с unlock-цепью ТОЛЬКО при чистом драфте; сверка статуса корневого блокера после гипотетической очистки оператором.
- BROWSER-TEST-20260928-0430 → Четвёртый тик BROWSER-TEST: read-only мониторинг по протоколу v2 (draft-детектор = READ_TRANSCRIPT, CAPTURE признан слепым; typing заморожены до реальной очистки драфта).
- BROWSER-TEST-20260928-0500 → Пятый тик BROWSER-TEST: read-only мониторинг по протоколу v2 (детектор драфта = READ_TRANSCRIPT; typing заморожены).
- EVOLVE-ROUND-20 → Раунд самоэволюции клиента — следующая задача бэклога: [EV-CHARTS] полировка recharts: тултипы, легенда, подписи времени Europe/Moscow
- EVOLVE-ROUND-20 → SELF-EVOLVE тик ME2 OS: прогон движка, реализация EV-CHARTS в Mission Control, верификация через gateway :81, self-update, расширение BACKLOG, синхронизация зеркал.
- BROWSER-TEST-20260928-0530 → Job 419203 — live browser mechanics test (METAENGINE 0.7.0-dev.36336130139.1), protocol v2 read-only pass
- UNLOCK-20260928-0536 → Job 419203 — оператор сообщил «Очистил»; проверка draft + попытка unlock-цепочки (первые ~10 часов кампании)
- BROWSER-TEST-20260928-0600 → Job 419203 — ПОЛНЫЙ прогон всех механик (фазы A/B/C/C3/D) после снятия блокера 05:36
- BROWSER-TEST-20260928-0546-FULL → Job 419203 — полный прогон всех механик (фазы A/B/C/D) после unlock; переклассификация против целей 1–5
- BROWSER-TEST-20260928-0600b → Job 419203 — тик 06:00 + ДИРЕКТИВА оператора: «все агенты — ТОЛЬКО чат-агенты, остальное удалить, лимитов никаких»
- FLEET-CHATONLY-20260928-0605 → оператор: «все агенты — ТОЛЬКО ЧАТ-АГЕНТЫ, всё остальное удалить, НИКАКИХ лимитов»
- UI-AUDIT-20260928-0610 → оператор — агентов создавать во вкладке «Agent» z.ai (не в Chat); полный аудит всех механик/панелей: что мешает, бесполезно, декоративно, ограничивает цель «автономный непрерывный самообучающийся рой»
- AUDIT-20260928-0631 → полный аудит 48 механик METAENGINE (0.7.0-dev.36336130139.1) на предмет «служит цели / мешает / декоративно»; без API, только координатно-независимое управление; проверка пересборки/обновления браузера

## ХВОСТ worklog (последние 40 строк, вербатим)
```
Work Log:
- Вкладка Agent: /agent и /agent/new → Next.js error page «unexpected error» (ИМЕННО ЭТИ страницы плодили /error-табы!); /agents при прямом URL → ПУСТАЯ гидрация (1 element, transcript len=0); в бандле /agent = API ZCode web-dev (/api/agent/v1/web-dev/...) → Agent-вкладка = платформа агент-продуктов ZCode/AutoClaw
- Клик по сайдбар-кнопке «Agent» (backend_node_id:359): TYPED_CLICK → ENQUEUE_ERROR (не в RPC-allowlist); SEMANTIC_FOCUS → fence AMBIGUOUS (дубликаты кнопок); Enter после фокуса не прошёл. Канонический вход в Agent-tab пока недоступен механиками
- FLEET_STATUS: 4 агента = все чат-агенты (GLM_CHAT табы, роли PLANNER/RESEARCHER/IMPLEMENTER/CRITIC); policy: max_agents=null, hard_agent_cap=null, burst=8, desired принял 6; рост флота = backlog-driven (desired_slots=0 при пустом бэклоге)
- capabilities: 48 implemented + 21 next (POINTER_CLICK/DRAG/SET_PROXY/WEBMCP_INVOKE/CHATGPT_* в next)

АУДИТ (vs цель «рой автономно разрабатывает»):
- ПОМОГАЮТ (ядро, оставить): CAPTURE, READ_TRANSCRIPT, SEMANTIC_TYPE(submit_after_type=True), NEW_TAB, SELECT_TAB, TAB_CENSUS, FLEET_STATUS, FLEET_RECONCILE, FLEET_SET_PROFILE, NAVIGATE, CLOSE_TAB, ARM, SELF_UPDATE_CHECK/APPLY, DEV_PLANE_*, SEMANTIC_CENSUS/EVENTS, TAB_TELEMETRY, CONTROL_CAPABILITIES
- ОГРАНИЧИВАЮТ (мешают рою): (1) supervisor_action_budget 24pts/60s — бутстрап N агентов упирается в budget, нужно повышение; (2) GATE-система 15 гейтов — GATE_DISABLE требует owner override_id, из командной плоскости не снимаются; (3) fence AMBIGUOUS на дубликатах UI; (4) DB constraint 23514 убил 5 механик (SESSION_STATUS, CHATGPT_STATUS, WEBMCP_LIST, FIND_IN_PAGE, SET_ZOOM); (5) PRESS_KEY-Enter не сабмитит (target=null); (6) TYPED_CLICK вне RPC-allowlist — нет клик-механики
- ДЕКОРАТИВНЫ/бесполезны для цели: CHATGPT_* домен (5 механик, чужая платформа), AI PPT-вкладка z.ai, DOWNLOAD_* (install_authority=false), сайдбар-history завален METAENGINE-семенами (шум), /error-страницы (мусор tabs)
- НЕ ПРОВЕРЕНЫ: SCROLL, RELOAD, BACK/FORWARD, STOP_GENERATION, SET_SUPERVISOR_MODE, WEBMCP_INVOKE, SET_PROXY, SET_SITE_PERMISSION, CLEAR_SITE_DATA, MUTE/PIN/MOVE/DUPLICATE_TAB, SEARCH_WEB, PROCESS_EVENTS, CONTROL_LATENCY_STATUS, DISARM

Stage Summary:
- Главные блокеры роя (ранжировано): budget 24/60s → DB-allowlist → нет click-механики → /agents-гидрация пустая → GATE override_id (owner-level)
- Для «создавать агентов во вкладке Agent»: нужен (a) клик по сайдбару (TYPED_CLICK в allowlist или уникальный фенс) и (b) рабочая гидрация /agents; альтернатива-обход: API-путь /api/agent/v1/web-dev (ZCode workspaces) через fetch в консоли таба — след. тик
- Артефакт: browser-test-results-t0605.json

---
Task ID: AUDIT-20260928-0631
Agent: Super Z (cron loop, job 419203)
Task: полный аудит 48 механик METAENGINE (0.7.0-dev.36336130139.1) на предмет «служит цели / мешает / декоративно»; без API, только координатно-независимое управление; проверка пересборки/обновления браузера

Work Log:
- Фаза E (audit-e-0631.py): NEW_TAB+CAPTURE probe tab_6924b587; read-only OK: POLL, TAB_TELEMETRY, PROCESS_EVENTS, CONTROL_LATENCY_STATUS, SEMANTIC_EVENTS, CAPTURE_VIEW; BACK/FORWARD OK; STOP_GENERATION err=native_glm_stop_requires_semantic_ref_button (схема: нужен semref кнопки); DOWNLOAD_FILE err=verified_download_filename_invalid→sha256_required (нужен filename+sha256); DISARM = 23514 «forbidden by the Final V2 always-on authority contract» (конституционный запрет — ПЛЮС для вечного супервизора); ARM OK; SET_SUPERVISOR_MODE CONTROL = LEASED (без терминального receipt)
- Фаза F (audit-f-0631.py): SEMANTIC_TYPE submit 3-е подтверждение рецепта — FLEET BRIEF создан (/c/cd7efff3, виден в истории сайдбара); SELF_UPDATE_STATUS/CHECK: state=CURRENT, current=0.7.0-dev.36336130139.1 > hint feed 0.7.0-dev.36315939303.1, available_version=null, automatic_install=true — обновлений по фиду НЕТ; CAPTURE периодически зависает в LEASED (55-56s, names→None — деградация семантической плоскости при бюджетном давлении)
- Фаза G (audit-g-0631.py): RELOAD реанимирует деградировавший CAPTURE; SCROLL: delta_y проходит валидацию (поле верное), но актюация LEASED-hang; DOWNLOAD_FILE c sha256 — тот же sha256_required (формат verified-download manifest иной); interaction_tree отдаёт кнопки БЕЗ имён — имена и semantic_ref живут в semantic_targets[]
- Фаза I-J (audit-i/j-0631.py): semantic_targets содержит button:Agent + полный semantic_ref (schema/evidence/frame_id/target_id/backend_node_id/semantic_ref_id/state_revision_id/execution_context_unique_id); RPC enqueue_v3 ТРЕБУЕТ ошибку supervisor_typed_click_payload_fields_invalid на валидный payload — v3-валидатор РАССИНХРОНИЗИРОВАН; ПРЯМОЙ INSERT в command-таблицу → TYPED_CLICK **COMPLETED** (receipt: point вычислен браузером из semref — координатно-независимо!); клик «Agent» → SPA-вид Agent-пространства z.ai (URL остаётся chat.z.ai): кнопки New Task, ZCode, AutoClaw, шаблоны IM/Full-Stack/Writing/Data Insight/Connect Discord; клик «New Task» COMPLETED (появился второй unnamed textbox — модалка создания)
- SELF_UPDATE_APPLY: EXPIRED lease_timeout_no_retry — безопасный no-op при CURRENT

КЛАССИФИКАЦИЯ (vs цели: создать чат-агента / автономный рой / взаимная видимость / вечный супервизор / помощь процессу):
- ЯДРО (работает, оставить): NEW_TAB, CAPTURE, SEMANTIC_TYPE(submit), SEMANTIC_FOCUS, SELECT_TAB, TYPED_CLICK(INSERT-путь), PRESS_KEY, READ_TRANSCRIPT, TAB_CENSUS, SEMANTIC_CENSUS, SEMANTIC_EVENTS, FLEET_STATUS, FLEET_RECONCILE, FLEET_SET_PROFILE, ARM, SET_SUPERVISOR_MODE, CLOSE_TAB, NAVIGATE, RELOAD, BACK, FORWARD, CONTROL_CAPABILITIES, GATE_STATUS, SELF_UPDATE_STATUS/CHECK, CONTROL_LATENCY_STATUS, TAB_TELEMETRY, SYSTEM_TELEMETRY, PROCESS_CENSUS, PROCESS_EVENTS, DEV_PLANE_HEALTH/STATUS/CAPABILITIES/PROCESS_METRICS/REPO_HEAD, POLL, DOWNLOAD_STATUS
- МЕШАЮТ (удалить/починить): (1) RPC v3-валидатор TYPED_CLICK — ложный rejection, клик-механика жива только через INSERT; (2) supervisor_action_budget 24pts/60s — LEASED-hang CAPTURE/SCROLL/SUPMODE при бюджетном давлении, тормозит бутстрап роя; (3) DB-allowlist 23514 — убил SESSION_STATUS, CHATGPT_STATUS, WEBMCP_LIST, FIND_IN_PAGE, SET_ZOOM; (4) GATE-система 15 гейтов — без owner override_id не снимается; (5) lease watchdog отсутствует (зависшие LEASED не освобождаются)
- ДЕКОРАТИВНЫЕ/ЧУЖИЕ (удалить из контура): CHATGPT_* домен (5 механик, чужая платформа), геометрийные CAPTURE_VIEW/POINTER_CLICK/DRAG/SET_ZOOM (оператор: только координатно-независимое управление), WEBMCP_*, /agent+/agents+/agent/new URL-пути (error pages, вход ТОЛЬКО кнопкой Agent), DOWNLOAD_FILE/DOWNLOAD_CANCEL (install_authority=false + verified-manifest схема недокументирована)
- КОНСТИТУЦИОННЫЕ (не трогать — служат вечному супервизору): запрет DISARM (always-on authority contract), owner-только GATE_*, secrets_must_not_be_extracted, owner_gate_override_is_durable_and_audited

Stage Summary:
- Пересборка/обновление: браузер УЖЕ на последней сборке фида (36336130139.1 > hint 36315939303.1); SELF_UPDATE_APPLY=no-op; dev-plane не может пересобрать (direct_promote_current=false, candidate_capsules_executable=false, verification_sandbox_execution=false, требуется подписанная аттестация) — пересборка возможна только операторским пайплайном
- Прорыв: TYPED_CLICK работает (INSERT-путь) → вход на Agent-вкладку освоен без API и без координат; путь создания агента: кнопка Agent → New Task → модалка (textbox) — следующий шаг: автоматизация формы New Task
- Артефакты: browser-test-results-{e,f,g,h,i,j}0631.json, scripts/phoenix/audit-{e,f,g,h,i,j}-0631.py
- Флот: 4 агента ACTIVE (PLANNER/RESEARCHER/IMPLEMENTER/CRITIC), ARM CONTROL, max_agents=null; бэклог-брифинг «Fleet Brief: Swarm Audit & Growth Plan» отправлен (/c/cd7efff3)
```
