# ARCHITECTURE-MAP-20260928 — §18 Loop Map & Coverage (gen 08:45 +08)

Mandate: PRINCIPAL-DIRECTIVE.md sha256=0aa0957922d0f9d65296e4038b160887eaf85fd517cf8650ca365e75e556f739
Evidence base: worklog Task IDs BROWSER-TEST-20260928-{0730,0815,0836}, DIRECTIVE-CONVERGENCE-0758, DIRECTIVE-LOOP-0815, DIRECTIVE-MULTIAGENT-0830; results JSONs t0700/t0800/m0815/ma0830/bs0836
Registries: MECHANISM-REGISTRY-20260928.md (48+21), AUDIT-REGISTRY-20260928.md, LESSONS.md (L01-L17)

## 1. LOOP MAP (§18) — статус каждого звена

| Звено | Статус | Физическое доказательство |
|---|---|---|
| USER GOAL | PROVEN | брифы отправлены в agent-сессии (4 задачи: task-board, essay, research, critic) |
| SUPERVISOR decompose | PARTIAL | роли RESEARCHER/CRITIC формирует директивный cron-контур; встроенный supervisor-планировщик не управляет z.ai-сессиями |
| AGENT POOL | PROVEN | флот 4 ACTIVE (PLANNER/RESEARCHER/IMPLEMENTER/CRITIC, transport-proof, LOST=0) |
| Z.AI AGENT UI creation | PROVEN ×4 | canonical recipe: sidebar→Agent→New Task→"Send a Message"→SEMANTIC_TYPE(submit=True, replace_existing=False) → /c/36ce7b45, /c/94fd04de, /c/b86be1da, /c/cfefd09f |
| BROWSERCELLS | PROVEN | TAB_CENSUS: 16/48 табов (fleet=4, supervisor=1, headroom user=32/fleet=24), lanes v3 read=64 parallel / mutation=16, pressure YELLOW |
| BRAIN/MEMORY | INTEGRATE | LESSONS.md L01-L17 + worklog + реестры; retrieval в брифы директивных циклов работает; встроенный Brain-контур в routing z.ai-сессий не включён |
| WORKSPACE/DEVOS | PROVEN | DEV_PLANE_HEALTH ok (pid 18460, uptime>6.5h), CAPS v0.4.0 (11 caps), REPO_HEAD refs/pull/1024/merge@5aeaaa05 (PatrickFrome/Compute) |
| TEST/CRITIC | PROVEN (уровень сессий) | CRITIC-сессия создана и ответила (автотайтл «Top Risks & Missing Requirement…»); авто-E2E-контур — наши скрипты (mt/u/m/ma/bs-*) |
| VEF/readback | FIX | session-level: автотайтл-readback работает стабильно; thread-level: READ_TRANSCRIPT sidebar-only (payload-варианты игнорируются), effect_state=PROVEN_NEW_CONVERSATION от клиента |
| RELEASE/CI | OPERATOR-BLOCKED | direct_promote_current=false, candidate_capsules_executable=false, verification_sandbox_execution=false — нужна подписанная аттестация (вне песочницы) |
| SELF UPDATE | PROVEN (check) | SELF_UPDATE_CHECK state=CURRENT (0.7.0-dev.36336130139.1), sentinel ARMED v1.6.1, host_resilience ACTIVE; APPLY=no-op |
| NEXT CYCLE | PROVEN | perpetual cron-контур: 419718 (15м директива) + 419203 (браузер-тесты) + 417373 (30м heartbeat) + 416526 (15м guard) + 416759 (secrets) + 416631 (hourly compactor) |

## 2. ВЕРДИКТЫ МЕХАНИК (свод на 08:45)

- РАБОТАЮТ (23): CAPTURE, CAPTURE_VIEW, TYPED_CLICK(INSERT+явный tab), SEMANTIC_TYPE(submit=True/replace=False), SEMANTIC_FOCUS, READ_TRANSCRIPT(sidebar), TAB_CENSUS, FLEET_STATUS, FLEET_RECONCILE, CONTROL_CAPABILITIES, GATE_STATUS, SYSTEM_TELEMETRY, TAB_TELEMETRY, PROCESS_CENSUS, CONTROL_LATENCY_STATUS, DEV_PLANE_STATUS/HEALTH/CAPS/REPO_HEAD, SEMANTIC_CENSUS, SEMANTIC_EVENTS, SELF_UPDATE_CHECK/STATUS, NEW_TAB, RELOAD, SELECT_TAB, CLOSE_TAB
- НЕ РАБОТАЮТ (15): STOP_GENERATION (нет адресуемой stop-кнопки), FLEET_SET_PROFILE (schema-gap), GATE_ENABLE (реестр пуст), NAVIGATE (AMBIGUOUS), SCROLL (CDP deadline), PRESS_KEY (Enter no-effect), BACK/FORWARD (no-op), SEMANTIC_TYPE replace=True (replace_unverified), TYPED_CLICK-RPC (validator), DOWNLOAD_STATUS (LEASED-hang), DOWNLOAD_FILE, SESSION_STATUS/WEBMCP_LIST/CHATGPT_STATUS/FIND_IN_PAGE/SET_ZOOM/READ_STATE (23514-class, operator allowlist)
- НЕ ПРОВЕРЕНО (осознанно): SELF_UPDATE_APPLY на ненулевой diff, GATE_ENABLE на реальном gate, WEBMCP_INVOKE, класс next-revision (POINTER_CLICK/DRAG/KEY_PRESS/SEARCH_WEB — capability_revision_required)

## 3. ТРИ SEMANTIC-PLANE ГЭПА (одна доработка клиента закрывает все)

1. stop-кнопка безымянная в a11y → STOP_GENERATION неприменим
2. тред agent-сессии вне capture-scope → READ_TRANSCRIPT возвращает только sidebar (READBACK_SIDEBAR_ONLY)
3. model-popover вне semantic tree → Select-model NO_EFFECT (AMBIGUOUS, §4)

Требуемая доработка: portal-inclusive semantic capture ИЛИ unnamed-ref targeting (§4 п.2 backend_node_id / п.6 CDP DOM по доказанному target).

## 4. REMOVE LEDGER (§15/§18)

| Removed/к удалению | Почему | Замена |
|---|---|---|
| enqueue_v1/v2, complete_v4, lease_v1/v2 RPC | legacy-дубли command plane | enqueue_v3 + INSERT path |
| duel_* | мёртвый контур | — |
| meta_orchestrator_* | дубль coordination | MERGE в command plane |
| federation_*, aop1_* | 404 в schema-cache | — |
| POINTER_CLICK/DRAG/SET_ZOOM | geometry-управление (§4 запрет) | semantic path |
| CHATGPT_* surface | не служит целям (z.ai only) | GLM_ZAI platform |
| duplicate persistence-плоскости (261 табл/~90 RPC) | избыточные копии state | canonical: browser_supervisor_{state,command} + fleet |

## 5. OPERATOR ASKS (для полного §12/§20 DoD)

1. Allowlist 6 × 23514-действий (SESSION_STATUS, WEBMCP_LIST, CHATGPT_STATUS, FIND_IN_PAGE, SET_ZOOM, READ_STATE)
2. FLEET_SET_PROFILE payload schema (fleet_profile_invalid)
3. Portal-inclusive capture / unnamed-ref targeting (закрывает 3 гэпа)
4. Release pipeline с подписанной аттестацией (candidate capsules → CI → installer SHA-256 → штатный update)
5. GLM-5.3-Flash select для agent-space (заблокирован гэпом №3)
