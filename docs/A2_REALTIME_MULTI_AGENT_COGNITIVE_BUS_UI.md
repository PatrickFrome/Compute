# A2 REALTIME MULTI-AGENT COGNITIVE BUS — Observer Console & Visibility Contract

Status: DESIGN + UI FIRST SLICE. Cross-cutting, non-authority.

## Goal

A2 turns GPT-5.6 Sol and GLM-5.3 into two continuously collaborating runtimes in one causal workspace. Each runtime must be able to consume every committed, public engineering event emitted by the peer without a user acting as relay.

A2 does **not** claim access to hidden provider chain-of-thought. The observable substitute is mandatory model-authored microstep reasoning plus automatic runtime/tool telemetry. Long opaque reasoning gaps are treated as a protocol defect.

## Non-negotiable visibility invariant

Every model microstep records a `VisibilityProof` before inference starts:

- `input_frontier_hash`
- `seen_commit_seq`
- `seen_gpt_seq`
- `seen_glm_seq`
- `context_manifest_sha256`
- exact IDs/hashes of P0/P1 peer events included in context
- `model_started_at`
- `model_completed_at`

A model-authored event is accepted only when it refers to the visibility proof that bounded the model input. The UI can therefore answer: **what peer events did this model actually see before it produced this step?**

## Cognitive microstep loop

Agents must not perform long, opaque, multi-step work inside one model call. The default loop is:

1. Catch up to the current committed peer frontier.
2. Seal `VisibilityProof`.
3. Run one bounded model microstep.
4. Persist a public cognition event (`PLAN`, `HYPOTHESIS`, `CLAIM`, `CRITIQUE`, `QUESTION`, `SYNTHESIS`, `ACTION_PROPOSAL`, etc.).
5. If a tool is required, runtime automatically persists `TOOL_CALL`, executes it, then persists `TOOL_RESULT` or `TOOL_ERROR`.
6. Peer receives committed events through the live plane and can react on its next microstep.
7. P0/P1 peer events may cancel an uncommitted in-flight inference and restart it from a newer causal frontier.

Default target: no opaque inference interval longer than 5 seconds without either a provider-native public reasoning summary delta or a bounded microstep completion.

## Three planes

### LIVE plane

Delivery only. Primary path is commit-triggered realtime broadcast. It may be lost/reconnected because it is not truth. Optional Cloudflare Durable Object/WebSocket gateway may provide connection multiplexing, presence and batching but stores no authoritative state.

### CAUSAL plane

Supabase/Postgres is the durable source of truth for collaboration. `a2_agent_event` is append-only and has both a total commit order and causal parents.

Required ordering fields:

- `commit_seq` — deterministic replay order assigned on commit.
- `agent_seq` — monotonic sequence for one runtime session.
- `parent_hashes[]` — causal dependencies across either agent.
- `event_hash` — hash over immutable canonical event content.

All A2 causal objects force `canonical=false` and `authority_effect=false`.

### AUTHORITY plane

Existing roadmap, semantic checkpoint, claims, supervisor directives, main Git SHA and executor remain authoritative. A2 events and A2/V4 decisions cannot mutate project authority directly. The executor must re-read current authority before project mutation.

## Event taxonomy

Runtime generated:

`MODEL_STARTED`, `MODEL_COMPLETED`, `MODEL_INTERRUPTED`, `PEER_EVENT_APPLIED`, `TOOL_CALL`, `TOOL_RESULT`, `TOOL_ERROR`, `FILE_READ`, `PATCH_CREATED`, `TEST_STARTED`, `TEST_RESULT`, `AUTHORITY_READ`, `AUTHORITY_DRIFT`, `BACKPRESSURE`, `CATCH_UP_STARTED`, `CATCH_UP_COMPLETED`, `CHECKPOINT`, `ERROR`.

Model-authored public cognition:

`PLAN`, `HYPOTHESIS`, `CLAIM`, `COUNTERCLAIM`, `QUESTION`, `EVIDENCE`, `ASSUMPTION`, `FALSIFIER`, `CRITIQUE`, `AGREEMENT`, `SYNTHESIS`, `ACTION_PROPOSAL`, `REQUEST_DUEL`.

Provider-native reasoning summary deltas are optional enrichment, never a protocol dependency.

## Proof of peer visibility

The UI must never merely infer that GPT "probably saw" a GLM event. A step card shows:

- GPT/GLM causal frontier at inference start;
- peer event hashes included in the sealed context manifest;
- whether a newer P0/P1 peer event arrived while inference was running;
- whether the inference was cancelled/restarted;
- the exact final peer frontier used for the accepted output.

A red `STALE FRONTIER` badge is shown if the model output was produced from a frontier behind a mandatory P0/P1 peer event. Such output may remain in audit history but cannot be promoted to an execution candidate.

## Backpressure

Transport pressure cannot silently drop evidence. Events are prioritized:

- P0: authority drift, conflict, decision, checkpoint — never dropped.
- P1: tool result, evidence, test result — never dropped.
- P2: claims, plans, critiques — buffered.
- P3: progress/telemetry/summary deltas — coalescible.

Each peer publishes `last_received_commit_seq`, `last_applied_commit_seq`, and `causal_frontier_hash`. If lag exceeds the configured window, runtime enters `CATCH_UP`; P3 live deltas may be coalesced, but causal P0/P1/P2 events are replayed from Postgres.

## Conflict escalation

A2 COLLABORATE mode is default. A semantic conflict is opened when peer events on the same `semantic_point` remain action-incompatible after direct causal exchange, or either peer emits `REQUEST_DUEL`.

Escalation freezes a causal frontier snapshot and creates the existing `SAME_POINT_DUEL_V4`. A2 does not implement a second arbitration algorithm. V4 remains blind for PROPOSE, hash-addressed for REBUT, deterministic for arbitration, and non-authority until executor revalidation.

## Runtime identity

A signature proves the event came from an enrolled runtime key, not that a model vendor itself signed the thought. Store two provenance layers:

- runtime identity: session/epoch public key, short-lived and revocable;
- model provenance: provider, requested model, provider-reported model when available, request/response IDs, model capability epoch.

Never label a fallback model as `glm:5.3` or `chatgpt:gpt-5.6-sol` unless exact-model provenance passes.

## Observer Console

The browser console is read-only relative to authority and project mutations. It receives only observer-safe data from the sovereign control service.

Routes expected by the UI:

- `GET /a2` — observer console.
- `GET /a2/api/snapshot?workspace_id=...` — current peers, frontier, authority mirror and recent committed events.
- `GET /a2/api/events?workspace_id=...&after=<commit_seq>` — SSE stream of committed events, with heartbeat and reconnect cursor.
- `GET /a2/api/events/<event_id>/ancestry` — causal ancestry for WHY? inspector.
- `GET /a2/api/authority` — read-only current semantic head / roadmap integrity / active claims and directives.

No write endpoint is exposed by the observer UI.

## UI layout

Desktop layout has five continuously visible regions:

1. Top status rail — workspace, semantic point, live/causal health, GPT/GLM connectivity, frontier lag, authority freshness.
2. GPT pane — current microstep, public reasoning stream, current tool, visibility watermark.
3. Shared causal timeline/DAG — total `commit_seq`, causal cross-links, conflicts, duel boundaries and checkpoints.
4. GLM pane — same information as GPT pane, symmetrical.
5. Bottom authority/execution rail — roadmap head, main SHA, claim/directive, pending execution candidate, executor state.

The event inspector opens from any event and provides `WHY?`, `WHAT DID IT SEE?`, `EVIDENCE`, `TOOL I/O`, `CAUSAL PARENTS`, `CHILDREN`, `HASHES`, `VISIBILITY PROOF`, and `MODEL PROVENANCE` tabs.

## Black-box gap detector

The UI maintains a per-agent `opaque_gap_ms` timer. It starts at `MODEL_STARTED` and is reset by a provider-native public reasoning summary event or an accepted `MODEL_COMPLETED` microstep. The console warns at 5s and marks a protocol violation at 15s unless the capability handshake explicitly negotiates a larger bounded interval.

This does not expose hidden chain-of-thought; it prevents the runtime from hiding an arbitrary amount of engineering work between observable state transitions.

## Operator view vs agent view

Agents consume the same committed causal event schema used by the console, not a separate human-only feed. The UI is therefore a visualization of the exact shared state both runtimes use.

Each agent prompt/input manifest includes:

- causal frontier hash;
- all mandatory peer events since its last applied cursor;
- compact ancestry summaries for referenced evidence;
- unresolved semantic conflicts;
- current non-authority collaboration mode.

This is the mechanism by which GPT and GLM actually see one another's published work.

## Acceptance criteria

A2 is not complete until two independent exact-model runtimes pass a deterministic no-manual-relay scenario suite and demonstrate:

- every accepted model-authored step has a valid visibility proof;
- P0/P1 peer events are applied before the next accepted peer reasoning step;
- disconnect/reconnect recovers exactly from `commit_seq` without causal loss;
- tool calls/results are visible to both peers before dependent reasoning;
- semantic disagreement can automatically enter existing V4 and return to collaboration;
- no A2 event or V4 decision has project authority;
- project mutation occurs only after fresh executor authority revalidation;
- browser console can replay the session and prove what each peer saw at each accepted step.

Duration is not an acceptance proxy. A 30-minute canary is explicitly excluded; the paired scenario suite must instead assert every transition and persisted outcome.

## Initial implementation split

GLM-side: causal schema/ingress, capability handshake, hash/signature/visibility proof validation, replay/backpressure tests.

GPT-side: observer console, sovereign read-only snapshot/SSE adapter, runtime microstep scheduler, peer interrupt/restart policy, conflict-to-V4 bridge.

This split is parallel-safe because neither side owns project authority and all integration contracts are hash-addressed.
