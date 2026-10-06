# LIVE_PREFLIGHT protocol

Run this before any meaningful continuation of METAENGINE development.

The protocol is intentionally read-only until the final mutation gate.

## Phase A — objective resolution

Identify one bounded objective.

Output:

- objective
- mutation domains
- expected GitHub branch/PR
- expected Supabase/runtime surfaces
- irreversible effects that may become relevant

If the user only says "continue development", derive the next objective from the freshest live frontiers, not from Project chat history.

## Phase B — GitHub topology readback

Read:

1. current exact head of the relevant source branch;
2. PR state/base/head;
3. exact-head CI/workflow conclusions;
4. relevant predecessor/successor ancestry;
5. package reservation/freeze semantics;
6. recent competing PRs touching the same authority/effect domain.

For repositories with many historical branches, do not inspect every branch semantically on every chat start. Instead:

- maintain a branch census;
- fully inspect the active/recent authority line;
- use ancestry/compare for candidate predecessors;
- only descend into historical divergent branches when they intersect the current objective.

This avoids both context explosion and unsafe bulk convergence.

## Phase C — Supabase live readback

Read only the surfaces relevant to the objective, plus the core control plane:

- roadmap authority;
- applied migrations touching the domain;
- active Edge function versions;
- Browser heartbeat/version/state if Browser work is involved;
- task counts / relevant task rows if orchestration is involved;
- active actuation lease;
- Supervisor mesh freshness;
- relevant audit/continuity checkpoints.

Never infer deployed state from repository migrations alone.

## Phase D — frontier reconciliation

Construct a multi-frontier table using `FRONTIER_MODEL.md`.

At minimum answer:

- selected source SHA;
- selected package identity, if any;
- currently installed/runtime identity;
- current authority identity;
- current continuity/evidence boundary;
- session anchor PR/issue;
- explicit drift between them.

## Phase E — stale-context quarantine

Before using Project files/chats, classify each relied-upon claim:

- CURRENT — revalidated live;
- CONTAINED — historical predecessor contained in current source;
- SUPERSEDED — replaced;
- HISTORICAL — rationale only;
- UNVERIFIED — do not use for mutation.

Do not copy old "current state" paragraphs into a new handoff.

## Phase F — mutation gate

Before mutation, state:

- exact target/source;
- exact mutation;
- authority allowing it;
- expected post-condition;
- readback that will prove it;
- ambiguity handling.

Rules:

- no active authority / lease when required -> do not actuate;
- ambiguous prior effect -> reconcile first;
- frozen package identity -> source mutation requires a new package identity;
- divergent historical branch -> no wholesale merge;
- source/live schema drift -> inspect contract before DDL/deployment;
- failed readback -> do not claim success.

## Phase G — bounded execution

Prefer several short execution batches:

1. inspect;
2. patch;
3. targeted tests;
4. broader qualification;
5. live mutation if authorized;
6. readback.

After each authority-bearing transition, checkpoint externally.

## Phase H — durable handoff

Persist `CHAT_HANDOFF_V1` to the active PR/issue when:

- exact source head changes materially;
- package identity is reserved/consumed;
- live migration or Edge version changes;
- an irreversible effect occurs;
- evidence boundary changes;
- the chat becomes long/unreliable;
- work is transferred to a fresh chat.

A new chat repeats LIVE_PREFLIGHT. It never treats the handoff itself as authority.

## Minimal start prompt

```text
Continue METAENGINE from live state.

Run LIVE_PREFLIGHT first.
GitHub + Supabase are authoritative.
Project files/chats are historical unless revalidated.
Identify the multi-frontier drift and choose one bounded next objective.
Do not perform an irreversible effect until exact source/target/authority/readback are resolved.
Persist CHAT_HANDOFF_V1 to the active PR/issue when the objective reaches a new evidence boundary.
```
