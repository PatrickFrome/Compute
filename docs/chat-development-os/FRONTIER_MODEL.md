# METAENGINE multi-frontier truth model

METAENGINE cannot be represented honestly by one "current SHA".

A development chat must track several independent frontiers and reconcile them before acting.

## Frontier classes

### 1. SOURCE_FRONTIER

Exact GitHub source selected for the objective.

Required fields:

- repository
- branch / PR
- exact full SHA
- ancestry relation to predecessor
- source qualification state
- whether source is frozen by a package reservation

This frontier answers: **what code are we reasoning about?**

### 2. PACKAGE_FRONTIER

Exact built artifact and physical evidence.

Required fields when applicable:

- source SHA
- package version
- installer/artifact digest
- package producer workflow/run
- physical install/activation/self-update evidence
- signed/published/promotion status

This frontier answers: **what exact bytes were physically qualified?**

A package frontier can be newer than live runtime and still have no production authority.

### 3. LIVE_RUNTIME_FRONTIER

Current installed Browser / Edge / DB runtime state.

Required fields when applicable:

- client/runtime identity
- installed version
- heartbeat/readback timestamp
- mode / armed state
- fleet/readiness state
- active actuation lease
- live Edge versions
- relevant applied migrations

This frontier answers: **what is actually running now?**

### 4. AUTHORITY_FRONTIER

Current durable authority and promotion state.

Examples:

- roadmap authority row
- alignment epoch
- active milestone
- release/promotion authority
- production trust root
- actuation lease
- scheduler/effect authority

This frontier answers: **what is authorized, not merely implemented or tested?**

### 5. CONTINUITY_FRONTIER

Independent durable evidence that survives process/chat boundaries.

Examples:

- useful-work proof
- restart journal
- Supervisor trust-root evidence
- R1 recovery checkpoints
- exact effect/readback receipts

This frontier answers: **what state/evidence can safely survive a restart or a new chat?**

### 6. SESSION_FRONTIER

The current bounded development objective.

It lives in one active PR/issue and carries:

- task
- exact starting source
- mutation boundary
- changed files
- validation
- blockers
- next safe action
- CHAT_HANDOFF_V1

This frontier answers: **what is this chat allowed to work on now?**

## Never collapse frontiers

Examples of invalid reasoning:

- "PR is green, therefore production is current."
- "Supabase roadmap baseline is old, therefore newer GitHub source is unauthorized garbage."
- "Installed Browser heartbeat is fresh, therefore latest package is installed."
- "A package is physically qualified, therefore real LIVE useful work is proven."
- "A historical Project capsule names an integration SHA, therefore that SHA remains current."

These are category errors.

## Drift matrix

Every LIVE_PREFLIGHT should produce:

| Frontier | Exact identity | Evidence/readback | Status | Drift |
|---|---|---|---|---|
| Source | SHA / PR | GitHub | CURRENT / SUPERSEDED | ... |
| Package | version + digest | Actions artifacts | QUALIFIED / UNQUALIFIED | ... |
| Live runtime | client/version | Supabase/Browser | FRESH / STALE | ... |
| Authority | roadmap/lease/trust | Supabase | AUTHORIZED / NOT_AUTHORIZED | ... |
| Continuity | checkpoint/proof | GitHub/Supabase | PROVEN / NOT_PROVEN | ... |
| Session | PR/issue | GitHub | ACTIVE / CLOSED | ... |

A mutation is allowed only when the relevant rows are sufficiently reconciled.

## Evidence vocabulary

Use these words precisely:

- `CURRENT`: exact live readback at the stated time.
- `CONTAINED`: an older source is an ancestor of a newer selected source.
- `SUPERSEDED`: a newer successor replaces the older objective/implementation.
- `PHYSICALLY_QUALIFIED`: exact artifact/source passed required physical gates.
- `EVIDENCE_READY`: required evidence exists for the stated boundary.
- `LIVE_PROVEN`: the specific live effect/useful-work condition was observed.
- `PRODUCTION_PROMOTED`: explicit production promotion authority/effect occurred.
- `HISTORICAL`: useful for rationale only.
- `UNVERIFIED`: not refreshed against current live truth.
- `AMBIGUOUS`: effect outcome cannot be safely inferred.

Do not upgrade one term into another without evidence.
