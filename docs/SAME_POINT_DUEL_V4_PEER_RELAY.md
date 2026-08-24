# SAME_POINT_DUEL_V4 — Interactive Peer Relay

Status: CROSS-CUTTING, non-authority. The relay does not alter roadmap authority or V4 arbitration.

## Purpose

The persistent sovereign coordinator remains the fastest fully automatic mode when GPT and GLM are callable OpenAI-compatible model endpoints. Interactive ChatGPT/GLM chat environments are not themselves persistent HTTP inference servers. The peer-relay mode lets two independent agent environments enter the same V4 causal machine through guarded Supabase RPCs.

## Invariants

- Both agents start from the same Supabase semantic head and exact GitHub `main` SHA.
- The relay has exactly two waves: `PROPOSE`, then `REBUT`.
- One actor cannot read the other actor's pending payload before submitting its own payload for that wave.
- The second submission invokes the existing atomic pair RPC. The relay does not create a second pairing algorithm.
- `REBUT` must address the exact persisted peer `PROPOSE` `event_sha256`.
- The second rebut invokes the existing `h205f22_duel_submit_rebut_finalize_v4` RPC, so pair #2 and arbitration remain one DB transaction.
- Pending submissions are immutable and unique by `(duel_id,wave,actor)`.
- Direct table writes are denied, including to `service_role`; only guarded RPCs may submit.
- `canonical=false` and `authority_effect=false` are forced.

## RPC surface

```text
h205f22_duel_create_peer_relay_v4
h205f22_duel_read_peer_relay_v4
h205f22_duel_submit_peer_v4
```

Existing V4 RPCs remain authoritative for atomic pairing and deterministic arbitration.

## Peer identities

Use fixed identities for one relay session:

```text
GPT = chatgpt:gpt-5.6-sol
GLM = glm:5.3
```

The guarded submit RPC rejects actor/identity mismatch.

## Deterministic start

Both agents must independently read:

1. current GitHub `main` SHA;
2. `compute_fabric_roadmap_status_h205f22()`;
3. semantic checkpoint id;
4. semantic payload root;
5. roadmap definition digest/integrity;
6. current supervisor directive for the selected milestone.

Fail closed if those values differ from the peer session or if definition integrity is false.

For automatic next-mainline development, derive:

```text
milestone = roadmap_status.next_mainline.milestone_key

duel_key =
same-point-v4::<checkpoint_id>::<milestone>::<main_sha>
```

Use an identical JSON subject:

```json
{
  "mode": "PROJECT_NEXT_MAINLINE_V1",
  "semantic_point": "SELECT_BEST_NEXT_ENGINEERING_ACTION",
  "milestone_key": "<milestone>",
  "checkpoint_id": "<checkpoint_id>",
  "payload_root_sha256": "<payload_root_sha256>",
  "base_github_sha": "<main_sha>",
  "roadmap_definition_sha256": "<definition_sha256>",
  "authority_rule": "DUEL_DECISION_NONAUTHORITY_UNTIL_EXECUTOR_REVALIDATES"
}
```

Both agents may call `h205f22_duel_create_peer_relay_v4` with the same `duel_key` and identical arguments; creation is idempotent through the underlying V4 session key contract.

## PROPOSE payload

Each agent creates its own structured public reasoning object without seeing the peer's current proposal:

```json
{
  "phase": "PROPOSE",
  "step_type": "IMPLEMENT",
  "claim": "...",
  "reasoning_summary": [],
  "evidence_used": [],
  "assumptions": [],
  "peer_claims_addressed": [],
  "counterexample": null,
  "falsifier": "...",
  "proposed_action": {"kind": "..."},
  "tests_required": [],
  "peer_event_hash_addressed": null,
  "need_canary": false,
  "terminal_vote": null
}
```

Submit it using the exact `current_checkpoint_sha256` returned by the relay readback.

The first submission returns `WAITING_PROPOSE_PEER`. The second submission commits atomic pair #1 and advances `current_tick` to `1`.

## REBUT payload

Read the relay after pair #1. The persisted ledger now exposes both proposal events and their `event_sha256` values. Address the peer hash exactly.

```json
{
  "phase": "REBUT",
  "step_type": "IMPLEMENT",
  "claim": "...",
  "reasoning_summary": [],
  "evidence_used": [],
  "assumptions": [],
  "peer_claims_addressed": [],
  "counterexample": null,
  "falsifier": "...",
  "resulting_action": {"kind": "..."},
  "tests_required": [],
  "peer_event_hash_addressed": "<exact peer PROPOSE event_sha256>",
  "need_canary": false,
  "terminal_vote": "SYNTHESIS"
}
```

Allowed terminal votes are `WIN_GPT`, `WIN_GLM`, `SYNTHESIS`, `NO_ACTION`.

The first rebut returns `WAITING_REBUT_PEER`. The second rebut executes atomic pair #2 plus V4 arbitration and returns `DECIDED`.

## Execution boundary

A `DECIDED` relay outcome is still non-authority. Before applying `resulting_action`, an executor must re-read:

- current semantic head;
- current Git main SHA;
- roadmap definition integrity;
- current claim/directive/dependency state;
- required tests/evidence.

If any authority input changed, do not execute the stale decision. Start a new semantic point instead.

## One-command interactive operation

To minimize manual turns, send the same `START SAME_POINT_DUEL_V4` command to both agent chats within a few seconds. Each agent should:

1. read authoritative state;
2. create/join the deterministic relay session;
3. submit its proposal;
4. perform bounded readback polling during the same execution while the peer is still running;
5. once pair #1 appears, generate and submit its rebut;
6. poll for `DECIDED`;
7. report only the persisted V4 decision and evidence hashes.

If the peer does not arrive before the agent execution ends, stop at the returned `WAITING_*` state. Do not fabricate the peer response. The next user message may simply say `CONTINUE SAME_POINT_DUEL_V4`; the agent resumes from persisted state.

## Fully automatic endpoint mode

For a persistent Linux/GPU/Colab host with callable model endpoints, use the original sovereign runner instead:

```bash
cd orchestration/sovereign
npm install --no-audit --no-fund
npm run check

export DATABASE_URL='...'
export DUEL_RUNNER_ID='gpu-worker-01'
export SOVEREIGN_GPT_URL='http://127.0.0.1:8001'
export SOVEREIGN_GLM_URL='http://127.0.0.1:8002'
export SOVEREIGN_GPT_MODEL='<exact GPT endpoint model id>'
export SOVEREIGN_GLM_MODEL='<exact GLM endpoint model id>'
export SOVEREIGN_CONTROL_TOKEN='<strong random token>'

npm start
```

Do not run the persistent coordinator for an interactive `peer_relay=true` session. Peer-relay sessions are intentionally blocked/armed between external agent submissions.
