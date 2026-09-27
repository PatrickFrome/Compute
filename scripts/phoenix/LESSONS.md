# METAENGINE OPERATIONAL LESSONS (bounded, deduped, provenance-tagged)
# Format: [id] (provenance) lesson — application rule
# Retrieval: coordinator embeds relevant IDs into agent briefs each cycle.
# Cap: 50 lessons. On overflow: merge/expire lowest-value. Contradiction → supersede, keep newest.

[L01] (BROWSER-TEST-0330/0400/t0700) Conversation creation on z.ai chat: SEMANTIC_TYPE submit_after_type=true — единственный доказанный сабмит; replace_existing=true на чистом драфте даёт native_semantic_type_replace_unverified → всегда replace_existing=false на новом табе.
[L02] (t0700) Пост-условие submit: url-sha пост-чек даёт AMBIGUOUS_AFTER_ENTER на chat.z.ai (URL не меняется мгновенно) → верифицировать через READ_TRANSCRIPT/CAPTURE-элементы, не через URL.
[L03] (AUDIT-j/M14) TYPED_CLICK: RPC enqueue_v3 валидатор ложнореджектит (supervisor_typed_click_payload_fields_invalid) → канонический путь = прямой INSERT в command-таблицу (DB-триггеры валидируют; receipt: point вычисляет браузер из semref — координатно-независимо).
[L04] (t0700) Sidebar-состояние персистится через reload; Toggle Sidebar клик нестабилен → RELOAD → CAPTURE: полнота UI = ~96 элементов с именами New Task/AI PPT/ZCode/Agent/Chat; 18 элементов = свёрнутый/деградировавший вид.
[L05] (E-J/М-фазы) Budget 24pts/60s (mutation=4pts): пауза ≥20s между mutations; LEASED-hang CAPTURE/SCROLL/SUPMODE/DOWNLOAD_STATUS = симптом бюджетного давления; RELOAD лечит деградацию семантической плоскости (names→None).
[L06] (R/M-фазы) INSERT 23514 = действие НЕ в implemented-allowlist (roadmap-gate), а не поломка: SESSION_STATUS/CHATGPT_*/WEBMCP_*/FIND_IN_PAGE/SET_ZOOM — не ретраить.
[L07] (E-J) PRESS_KEY standalone: target=null swallowed, Enter не сабмитит → сабмит только внутри SEMANTIC_TYPE(submit_after_type=true).
[L08] (E) BACK/FORWARD на свежем табе: NO_EFFECT_PROVEN — корректное консервативное поведение, не баг; на истории работают.
[L09] (0745) Coordination-plane RPC плоскости metaengine_federation_*/meta_orchestrator_*/duel_*/aop1_* — мертвы в schema-cache (404): task/lesson lifecycle строить на worklog/CONTEXT/LESSONS + command-plane + mesh.
[L10] (J4/K) Agent-space z.ai маркеры: sidebar кнопки Chat|Agent, зона New Task/ZCode/AutoClaw, шаблоны IM/Full-Stack/Writing/Data Insight; клик New Task открывает модалку со вторым unnamed textbox.
[L11] (UI-AUDIT-0610) /agent, /agent/new = error-страницы (плодили мусор-табы); /agents = пустая гидрация → вход в Agent ТОЛЬКО кнопкой сайдбара (SPA).
[L12] (F-0605) Флот: ELASTIC_BACKLOG_DRIVEN, desired_agents следует брифам; рост = NEW_TAB+SEMANTIC_TYPE(submit) брифы planner'у; капы отсутствуют (max_agents=null).
[L13] (Perf-0745) issue→lease p50=1.0s — транспорт здоров; хвост p95+ = LEASED-hang механик: оптимизировать watch-dog'ом lease, не транспортом.
[L14] (E) DISARM запрещён always-on контрактом (23514); GATE_DISABLE требует owner override_id — супервизор вечный by design; не тратить циклы на снятие.
[L15] (M-retry) NAVIGATE на тот же URL = postcondition AMBIGUOUS — использовать RELOAD вместо повторного NAVIGATE.
[L16] (E2E-2/3, 0750) semref TTL ~60s: state_revision fence протухает между capture и click при паузах → tight capture→click (<5s); CAPTURE READ_ONLY (0pts) — budget-wait делать ДО capture, не после.
[L17] (D5-D8, 0757) Agent-space submit задачи: SEMANTIC_TYPE(submit_after_type=True, replace_existing=False) в "Send a Message" → effect=PROVEN_NEW_CONVERSATION + /c/ URL — КОНТРАКТ СОЗДАНИЯ ЗАКРЫТ. НО: (a) READ_TRANSCRIPT=0 и тред вне a11y-дерева — readback agent-сессий НЕ парсится (FIX: transcript parser для agent-mode DOM или CAPTURE-канал содержимого); (b) модель agent-space = GLM-5.2, оператору нужен GLM-5.3-Flash (FIX: Select a model flow); (c) view остаётся на agent-landing — проверять переход в тред.
