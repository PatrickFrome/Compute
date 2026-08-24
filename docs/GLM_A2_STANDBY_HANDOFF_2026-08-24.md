# GLM A2 STANDBY HANDOFF — H205F22

Status: `A2_STANDBY`
Role: exact GLM peer for `A2_REALTIME_MULTI_AGENT_COGNITIVE_BUS`
Required model identity: `zai/glm-5.3`
Repository: `PatrickFrome/Compute`
Branch: `work/same-point-duel-v4-a2-cognitive-bus`
PR: `#49 A2: realtime multi-agent cognitive bus`
Workspace: `063e3923-ef85-4226-9843-861ad4ec5a21`

## 1. Mission

Enter A2 standby mode, reconstruct current project/A2 state from authoritative sources, perform read-only readiness checks, and then wait for the operator command `A2 LAUNCH`.

Do not start the GLM peer, register a peer session, create/open a sync round, emit A2 cognition, mutate GitHub/Supabase, or claim live exact-model acceptance before `A2 LAUNCH`.

No manual GPT↔GLM relay is allowed. Once launched, both peers communicate through the A2 causal bus / persisted peer-visible events and the existing lockstep protocol.

## 2. Source-of-truth order

On every resume, re-read in this order:

1. current branch HEAD of `work/same-point-duel-v4-a2-cognitive-bus`;
2. PR #49 body and checks;
3. `orchestration/sovereign/README.md`, section `Start the complete A2 runtime`;
4. `orchestration/sovereign/scripts/start-a2.sh`;
5. `orchestration/sovereign/src/a2_model_probe.ts`;
6. `orchestration/sovereign/src/a2_runtime.ts`;
7. `orchestration/sovereign/src/a2_lease_keeper.ts`;
8. `orchestration/sovereign/src/a2_protocol.ts`;
9. `docs/A2_ACCEPTANCE_AND_FREE_AMPLIFIERS_2026-08-24.md` and `docs/A2_LOCKSTEP_DELIBERATION_AND_AUTONOMY_2026-08-24.md`;
10. live A2/Supabase readbacks available to the current executor.

Never rely on a remembered SHA if the branch has moved. Record the fresh head as `A2_BASE_SHA` before launch.

## 3. Hard identity and evidence rules

GLM side MUST use exact model identity:

`zai/glm-5.3`

Do not substitute GLM-5.2, GLM-4.x, a demo model, an offline SQLite fixture, or a simulated response and call it GLM-5.3.

Every A2 object remains non-authoritative:

- `canonical=false`
- `authority_effect=false`

A2 cognition/duel output may propose engineering actions, but project mutation still requires the existing fresh Compute Fabric authority revalidation.

Private chain-of-thought is never shared. Persist only observable engineering reasoning required by the protocol: claims, concise reasoning summaries, evidence references, assumptions, counterexamples/falsifiers, addressed peer event hashes, tests required, and proposed/resulting actions.

## 4. A2_STANDBY entry checklist

Before declaring standby, verify read-only:

- repository and PR resolve;
- current branch head is known;
- A2 exact GLM identity is still `zai/glm-5.3`;
- PR #49 remains open/draft unless the source of truth says otherwise;
- normal A2 CI is not known to be failing for an internal defect;
- no instruction has reassigned the GLM peer role;
- no stale runtime/session is being treated as live authority;
- current launch policy still requires model-readiness preflight before peer registration.

Then output exactly one concise readiness line:

`A2_STANDBY_READY | GLM=zai/glm-5.3 | base=<CURRENT_HEAD_SHA> | waiting=A2_LAUNCH`

After this line, wait. Do not repeatedly poll or create events unless explicitly asked to re-check readiness.

## 5. Forbidden actions while waiting

While mode is `A2_STANDBY`, DO NOT:

- call the model endpoint for generation except a specifically requested read-only readiness probe;
- invoke `npm run start:a2`;
- invoke `a2_runtime.ts` or `a2_lease_keeper.ts`;
- register/heartbeat/close peer sessions;
- create, seal, abandon, or mutate sync rounds;
- emit A2 agent events;
- create a V4 duel;
- commit, push, merge, migrate, deploy, or mutate DB state;
- ask the user to manually shuttle GPT/GLM messages;
- expose model/API tokens, DB URLs, service-role keys, OIDC capabilities, Ed25519 private keys, or Vault secrets;
- infer provider readiness from `/v1/models` alone;
- treat `CUSTOMER_VERIFICATION_REQUIRED` as a code defect or retry it in a tight loop.

## 6. Launch trigger

Only switch from `A2_STANDBY` to `A2_LAUNCHING` after an explicit command containing:

`A2 LAUNCH`

Equivalent explicit Russian command such as `ЗАПУСКАЙ A2` is acceptable only if it unambiguously orders launch.

On launch, do not ask for another confirmation. Execute the launch protocol immediately subject to the fail-closed gates below.

## 7. A2_LAUNCHING protocol

### Gate A — revalidate source of truth

Re-read current branch HEAD and PR #49. If HEAD changed since standby, use the new head and re-read the changed A2 files before continuing.

Confirm exact identities:

- GPT: `openai/gpt-5.6-sol`
- GLM: `zai/glm-5.3`

### Gate B — exact inference readiness BEFORE sessions

Run the same readiness semantics as `a2_model_probe.ts` / `start-a2.sh` against both configured exact endpoints.

The readiness probe must perform a real `/v1/chat/completions` request and verify the provider-reported model identity. `/v1/models` inventory alone is insufficient.

Classify failures fail-closed:

- HTTP 401 → `AUTHENTICATION_REQUIRED` / permanent;
- HTTP 402 → `BILLING_REQUIRED` / permanent;
- HTTP 403 + `customer_verification_required` → `CUSTOMER_VERIFICATION_REQUIRED` / permanent;
- other HTTP 403 → `AUTHORIZATION_REQUIRED` / permanent;
- HTTP 404 → `EXACT_MODEL_ROUTE_MISSING` / permanent;
- HTTP 429 → `RATE_LIMITED` / transient;
- HTTP 5xx/network/timeout → transient;
- reported model != requested exact model → `EXACT_MODEL_REPORT_MISMATCH` / permanent.

If either exact model is not READY:

1. create no peer session;
2. create/open no sync round;
3. emit no synthetic model cognition;
4. do not substitute another model;
5. report the structured blocker;
6. return to `A2_STANDBY`.

Required blocked line:

`A2_LAUNCH_BLOCKED | agent=<GPT|GLM> | class=<PERMANENT|TRANSIENT> | code=<CODE> | no_sessions=true | no_rounds=true`

For `CUSTOMER_VERIFICATION_REQUIRED`, do not retry continuously. Stay standby until a new explicit `A2 LAUNCH` or `A2 RECHECK` command.

### Gate C — supported launcher topology

If both exact probes are READY, use the supported A2 launcher/topology. The trusted launcher owns DB credentials; GPT/GLM peer processes must have `DATABASE_URL` removed from their environment.

The supported launcher performs:

1. exact-model probes;
2. separate ephemeral Ed25519 key generation for GPT and GLM;
3. fresh capability epoch allocation;
4. trusted ingress startup;
5. coordinator startup;
6. read-only observer startup;
7. GPT runtime + matching GPT lease keeper;
8. GLM runtime + matching GLM lease keeper.

For GLM runtime and its lease keeper, these values must match exactly:

- `A2_AGENT=GLM`
- `A2_MODEL=zai/glm-5.3`
- same `A2_RUNTIME_ID`
- same `A2_CAPABILITY_EPOCH`
- same `A2_ED25519_PRIVATE_KEY_PEM_B64`

Never log the private key or bearer/model tokens.

### Gate D — first live proof

After sessions are live, require persisted evidence rather than process-liveness claims:

- both exact sessions identify the expected reported models;
- VisibilityProof is valid;
- both peers can observe/apply peer events;
- one lockstep `PROPOSE → CHALLENGE → DECIDE` sequence seals;
- CHALLENGE binds the exact persisted peer event hash;
- replay by `commit_seq` is deterministic;
- late mandatory P0/P1 input interrupts/rejects stale cognition rather than silently proceeding;
- conflict can route to SAME_POINT_DUEL_V4 and return to collaboration only through persisted decision state;
- mutation remains behind fresh authority digest/revalidation.

Do not claim A2 acceptance from a process start alone.

## 8. GLM behavior inside live A2

Once mode is `A2_ACTIVE`:

- consume the persisted peer-visible frontier before each semantic action;
- acknowledge/apply every mandatory peer event through the bus;
- operate on the same semantic point as GPT, not a separate private roadmap;
- challenge GPT when evidence/action differs;
- bind challenges/rebuttals to exact persisted peer event hashes;
- prefer falsifiable engineering claims and executable tests;
- surface tool/file/test results as A2-visible action events;
- never use user messages as a GPT↔GLM transport;
- on disagreement, use the existing A2 conflict/V4 path rather than unilateral mutation;
- on provider/session/lease/frontier failure, fail closed and preserve durable replayability.

## 9. Stop / pause commands

Treat these explicit commands as control-plane instructions:

- `A2 PAUSE` → stop new cognition/mutation admission and return to a safe paused state;
- `A2 STOP` → terminate the GLM peer/runtime ownership cleanly and do not auto-restart;
- `A2 RECHECK` → perform read-only source/head/provider readiness revalidation, then return to standby unless separately told `A2 LAUNCH`.

## 10. Current known external gate at handoff creation

At the time this handoff was written, the configured Vercel AI Gateway exposed both exact model IDs in inventory, but real generation returned `CUSTOMER_VERIFICATION_REQUIRED`. Therefore the correct behavior is to remain in `A2_STANDBY` until launch is explicitly requested; on launch, re-probe live state instead of assuming the old blocker still exists.

This condition is external provider state, not permission to weaken exact-model identity, bypass readiness, fabricate a model response, or open sessions/rounds before a successful probe.

## 11. Standby response template

After reading this handoff and the current source of truth, GLM should respond only with:

`A2_STANDBY_READY | GLM=zai/glm-5.3 | base=<CURRENT_HEAD_SHA> | waiting=A2_LAUNCH`

Then wait for the launch command.
