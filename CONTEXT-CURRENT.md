# PHOENIX CONTEXT DIGEST (auto, heartbeat v2.2)

gen: 2026-09-27T22:31:08Z | worklog: 2003394B / 10950L | sha12=c5a08bd93a75

## КАК ПОЛУЧИТЬ ПОЛНЫЙ КОНТЕКСТ (выполни по порядку)
1. `bash /home/z/my-project/scripts/phoenix/phoenix-restore.sh --check` — кворум 8 источников, вердикт целостности
2. Прочитай: /home/z/my-project/CONTEXT.md (handoff-документ) + /home/z/my-project/PHOENIX-PROTOCOL.md
3. Прочитай хвост /home/z/my-project/worklog.md (последние 150+ строк) — канонический журнал ВСЕХ чатов
4. Если локальный worklog усечён/отсутствует: `phoenix-restore.sh --merge` (секционный merge-append без потерь)
5. Диагностика канала Supabase: хвост /home/z/context-vault/journal/phoenix.log (HB-SB-FAIL содержит тело ошибки)

## КАНАЛЫ ПОЛНОЙ КОПИИ worklog.md (2003394B)
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
- BROWSER-TEST-20260928-0243 → Повторный прогон всех механик live METAENGINE 0.7.0-dev.36336130139.1 (Supabase compute_fabric_a2_*), классификация работает/не работает/не проверено относительно целей: (1) создание GLM-чат-агентов, (2) автономный флот, (3) взаимная видимость/координация/самообучение, (4) вечный супервизор
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

## ХВОСТ worklog (последние 40 строк, вербатим)
```

---
Task ID: FLEET-CHATONLY-20260928-0605
Agent: Super Z (cron loop)
Task: оператор: «все агенты — ТОЛЬКО ЧАТ-АГЕНТЫ, всё остальное удалить, НИКАКИХ лимитов»

Work Log:
- FLEET_SET_PROFILE: enum только BALANCED (CHAT/CHAT_ONLY/GLM_CHAT → fleet_profile_invalid); {"profile":"BALANCED","boot_fleet_target":16} → COMPLETED, политика применилась: boot_fleet_target 4→16 ✓; max_agents=null, hard_agent_cap=null (капов нет); desired_agents=4 остался (выводится моделью ELASTIC_BACKLOG_DRIVEN); adopt_existing/spawn_burst_limit не применились (строгий payload)
- GATE_DISABLE / GATE_DISABLE_ALL → owner_gate_reason_invalid / owner_gate_override_id_invalid: гейт-система требует валидный override_id (список overrides пуст) — снятие гейтов недоступно из командной плоскости (нужен owner-оверрайд на серверной стороне)
- ARM → COMPLETED: armed=true, supervisor_mode=CONTROL, authority_effect=true — супервизор вооружён (главный рычаг «без лимитов»)
- CLOSE_TAB ×9: все грязные draft-табы + /error табы закрыты; census 20→13 табов (12 GLM_CHAT + 1 LOCAL_DEV console; roles 8 USER / 4 FLEET / 1 SUPERVISOR)
- Флот: 4×ACTIVE (PLANNER/RESEARCHER/IMPLEMENTER/CRITIC — все живут в чат-табах GLM, т.е. все ЧАТ-АГЕНТЫ; роли — внутренние лейблы конвейера)

Stage Summary:
- Выполнено: ARM (authority), boot_fleet_target=16, капы отсутствуют (max_agents=null), флот 100% чат-агенты (4/4 в GLM-табах), мусорные 9 табов удалены (20→13)
- Блокер: GATE_DISABLE требует override_id — 15 safety-гейтов остаются активными (нужен owner-оверрайд вне командной плоскости)
- Рецепт роста флота теперь: NEW_TAB → SEMANTIC_TYPE(submit_after_type=True) с брифом (backlog-driven модель подхватит) + reconcile
- Артефакт: browser-test-results-t0600.json

---
Task ID: UI-AUDIT-20260928-0610
Agent: Super Z (cron loop)
Task: оператор — агентов создавать во вкладке «Agent» z.ai (не в Chat); полный аудит всех механик/панелей: что мешает, бесполезно, декоративно, ограничивает цель «автономный непрерывный самообучающийся рой»

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
```
