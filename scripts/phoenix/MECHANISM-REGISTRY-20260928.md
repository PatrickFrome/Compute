# METAENGINE MECHANISM REGISTRY — 2026-09-28 07:3x (master directive §18)
# Evidence: browser-test-results-t0700.json (phases R/M/D/S3-S6), audit-{e..j}0631.json, worklog AUDIT-20260928-0631
# Verdicts: KEEP/FIX/INTEGRATE/MERGE/REPLACE/REMOVE/QUARANTINE (directive §6; no UNKNOWN allowed)

## A. IMPLEMENTED (48) — runtime-verified this cycle

| Mechanism | Purpose | Works? (physical evidence) | Verdict | Action |
|---|---|---|---|---|
| POLL | liveness probe | ✅ implicit every command | KEEP | — |
| CAPTURE | semantic snapshot | ✅ but size correlates with tab viewport: 0×0 bg-cell → 18 els; 950×577 → 96 els | KEEP | FIX(doc): always SELECT/paint tab before capture |
| CAPTURE_VIEW | screenshot | ✅ on painted tabs (sha256 8a2404b8…); ❌ surface_unavailable on 0×0 cells | KEEP | — |
| CONTROL_CAPABILITIES | 48+21 manifest | ✅ | KEEP | — |
| PROCESS_CENSUS / PROCESS_EVENTS | process plane | ✅ | KEEP | — |
| SEMANTIC_CENSUS / SEMANTIC_EVENTS | semantic plane stats | ✅ (0631) | KEEP | — |
| CONTROL_LATENCY_STATUS | fast-lane latency | ✅ | KEEP | — |
| TAB_TELEMETRY | per-tab console/health | ✅ (z.ai console logs) | KEEP | — |
| SYSTEM_TELEMETRY | census+system | ✅ 15 tabs, ceilings, fleet ids | KEEP | — |
| READ_TRANSCRIPT | conversation readback | ✅ (works; entries format varies) | KEEP | — |
| TAB_CENSUS | tab inventory | ✅ 15 tabs: 10 USER/4 FLEET/1 SUPERVISOR, max 48 | KEEP | — |
| FLEET_STATUS | fleet state | ✅ 4 agents ACTIVE, ELASTIC_BACKLOG_DRIVEN, max_agents=null | KEEP | — |
| DOWNLOAD_STATUS | dl plane | ⏸ LEASED-hang 55s no receipt (this cycle, clean budget) | FIX | add lease watchdog |
| DEV_PLANE_STATUS/HEALTH/CAPABILITIES/PROCESS_METRICS/REPO_HEAD | dev plane | ✅ (0631) | KEEP | — |
| SELF_UPDATE_STATUS | update state | ✅ CURRENT 36336130139.1 > feed hint | KEEP | — |
| GATE_STATUS | gates snapshot | ✅ 15 active, no overrides | KEEP (owner-only) | — |
| STOP_GENERATION | halt generation | ❌ needs semref button; no stop button exposed w/o active gen (0631) | FIX | schema: require semref |
| SCROLL | page scroll | ❌ CDP deadline 30000 (this cycle); 0631: LEASED-hang | FIX | low priority |
| SEMANTIC_FOCUS | focus element | ✅ | KEEP | — |
| SEMANTIC_TYPE | type+optional submit | ⚠️ typing ✅ (inserted_chars verified); **submit BROKEN: effect=AMBIGUOUS_AFTER_ENTER on chat home AND Agent-space** (worked 3× yesterday); no send button addressable | **FIX (P0 blocker for swarm)** | root-cause z.ai composer change; need send-button exposure or Enter path |
| TYPED_CLICK | semantic click | ✅ via INSERT (RPC v3 validator broken: supervisor_typed_click_payload_fields_invalid); point computed browser-side from semref; **0-effect COMPLETED possible on 0×0 tabs** (geometry dead zone) | KEEP (INSERT path) | FIX: RPC validator; FIX: reject click when viewport 0×0 |
| SELECT_TAB | focus tab | ✅ but does NOT make bg-cell paint (viewport stays 0×0 for NEW_TAB-born cells) | FIX | investigate window placement of NEW_TAB |
| PRESS_KEY | key dispatch | ⚠️ Enter COMPLETED but no submit effect; NumpadEnter=native_press_key_invalid; semref fields accepted-but-ignored | FIX | — |
| CLOSE_TAB | close | ✅ (0631 ×9) | KEEP | — |
| NAVIGATE | url go | ⚠️ AMBIGUOUS postcondition while effect landed (readback proved navigation) | FIX | postcondition for SPA/same-origin nav |
| BACK / FORWARD | history | ❌ NO_EFFECT_PROVEN on fresh tabs (no history — expected); worked 0631 | KEEP | — |
| RELOAD | reload | ✅; also revives degraded captures (0631) | KEEP | — |
| ARM / SET_SUPERVISOR_MODE | authority | ✅ CONTROL, authority_effect=true | KEEP | — |
| DISARM | off switch | 🚫 constitutionally forbidden (Final V2 always-on authority contract) — REJECTED by design | QUARANTINE | keep as constitutional guard |
| NEW_TAB | create cell | ✅ but cells are born 0×0 unpainted (bg window?) → clicks/blind captures dead | **FIX (P1)** | place cell in painted window or document |
| FLEET_RECONCILE / FLEET_SET_PROFILE | fleet control | ✅ (0631) | KEEP | — |
| DOWNLOAD_FILE / DOWNLOAD_CANCEL | dl control | ❌ verified-manifest schema undocumented; install_authority=false | QUARANTINE | — |
| SELF_UPDATE_CHECK / SELF_UPDATE_APPLY | self-update | ✅ CHECK; APPLY=no-op EXPIRED when CURRENT (safe) | KEEP | — |
| GATE_DISABLE / GATE_DISABLE_ALL / GATE_ENABLE / GATE_ENABLE_ALL | owner gates | 🚫 require owner override_id (empty overrides; id_invalid) — owner-level only | QUARANTINE (from cmd-plane) | — |

## B. 23514-DB-BLOCKED (RPC allowlist migration needed — operator-side)

| Mechanism | Verdict |
|---|---|
| SESSION_STATUS, CHATGPT_STATUS, WEBMCP_LIST, FIND_IN_PAGE, SET_ZOOM | FIX(blocked) — DB constraint 23514 kills INSERT; find_in_page+set_zoom are useful for swarm UX; chatgpt_* are foreign-domain (REMOVE candidate if unused) |

## C. NEXT (21, not implemented)

| Mechanics | Verdict |
|---|---|
| KEY_PRESS, POINTER_CLICK, DRAG | REPLACE: geometry-dependent (viewport fence) — keep out until geometry-independent |
| SET_ZOOM, DUPLICATE_TAB, MOVE_TAB, PIN_TAB, MUTE_TAB, SEARCH_WEB, FIND_IN_PAGE, SESSION_STATUS, SET_SITE_PERMISSION, SET_PROXY, CLEAR_SITE_DATA | INTEGRATE candidates: DUPLICATE_TAB/MUTE_TAB/FIND_IN_PAGE useful for swarm; SET_PROXY/CLEAR_SITE_DATA dangerous |
| CHATGPT_STATUS/SET_SETTING/SET_MODE/SEARCH/PROJECT_CONFIGURE, WEBMCP_LIST/INVOKE | REMOVE candidates: foreign platform surface, serves no swarm goal (consumer analysis pending) |

## D. ANTI-PATTERNS FOUND (directive §7) — coordination plane

1. **Viewport-0×0 blind zone**: NEW_TAB cells unpainted → commands "succeed" with zero effect. Fix: paint-or-reject fence.
2. **Two agent surfaces**: chat vs Agent-space — canonical must become Agent-space (directive §2).
3. **Submit regression**: z.ai composer ignores synthetic Enter (AMBIGUOUS_AFTER_ENTER ×5 today) — P0 blocker for swarm bootstrap.
4. **6 overlapping coordination planes in Supabase** (devos_fleet_*, meta_orchestrator_*, metaengine_federation_*, aop1_*, duel_*, mesh_*) — MERGE into one canonical task authority.
5. **Lease watchdog missing**: LEASED-hangs (DOWNLOAD_STATUS 55s, CAPTURE under budget pressure) never resolve.
6. **RPC v3 TYPED_CLICK validator desync** — INSERT path is de-facto canonical; RPC rejects valid payloads.

## E. Target architecture map (current → goal)

USER GOAL → SUPERVISOR(armed CONTROL, eternal) → PLANNER(ELASTIC_BACKLOG_DRIVEN, max=null)
→ AGENT CREATION: z.ai **Agent-space** (REACHED ✅; task-submit ❌ P0) → BROWSERCELLS (paint-fence fix P1)
→ BRAIN/MEMORY (cognitive_cursor 403, lessons table TBD) → WORKSPACE/DEVOS → TEST/CRITIC → VEF readback → RELEASE/SELF-UPDATE → NEXT CYCLE
