# SAME_POINT_DUEL_V4 — ChatGPT Actor Peer Relay

Status: CROSS-CUTTING, non-authority. The relay does not alter roadmap authority or V4 arbitration.

## Purpose

Two independent ChatGPT/OpenAI agent sessions can enter the same V4 causal machine without pretending that one of them is GLM. ACTOR_A and ACTOR_B start from the same durable semantic point, submit independently, and meet only at the existing atomic pair/finalizer boundary.

The historical V4 database schema still names its pair slots `GPT` and `GLM`. Those labels are immutable compatibility storage coordinates only:

`GPT slot = ACTOR_A`
`GLM slot = ACTOR_B`

They do not select a provider. Both active actors are `provider=OPENAI`, `platform=CHATGPT`.

## Invariants

- ACTOR_A and ACTOR_B are different ChatGPT agent/session identities.
- Both start from the same Supabase semantic head and exact GitHub SHA.
- The relay has exactly two waves: `PROPOSE`, then `REBUT`.
- One actor cannot read the peer's pending payload before submitting its own payload for that wave.
- The second submission invokes the existing atomic pair RPC; no second pairing algorithm exists.
- `REBUT` must address the exact persisted peer `PROPOSE event_sha256`.
- Pending submissions are immutable and unique by legacy DB slot, but the stored `peer_id` remains the truthful ChatGPT actor identity.
- Direct table writes remain denied; only guarded RPCs submit.
- `canonical=false` and `authority_effect=false` are forced.
- Any GLM/Z.ai model or peer identity on the new active API is rejected fail-closed.

## Active RPC surface

```text
h205f22_duel_create_chatgpt_relay_v1
h205f22_duel_read_peer_relay_v4
h205f22_duel_submit_chatgpt_peer_v1
```

The read RPC and underlying pair/finalizer remain the historical V4 implementation. The new create/submit wrappers translate actor identity only at the DB boundary.

## Peer identities

Use independent identities for one relay session:

```text
ACTOR_A = chatgpt:actor-a:<session-or-model-identity>
ACTOR_B = chatgpt:actor-b:<session-or-model-identity>
```

The guarded submit RPC rejects an actor/peer mismatch.

## Deterministic start

Both actors independently read the same GitHub SHA, roadmap status, semantic checkpoint id, semantic payload root, roadmap definition digest/integrity, and current supervisor directive. Fail closed if those authority inputs differ.

A deterministic key remains:

```text
same-point-v4::<checkpoint_id>::<milestone>::<git_sha>
```

Both actors call `h205f22_duel_create_chatgpt_relay_v1` with the same key/subject and their fixed actor identities.

## PROPOSE / REBUT

PROPOSE contains the existing public reasoning fields (`claim`, `reasoning_summary`, `evidence_used`, `assumptions`, `falsifier`, `proposed_action`, `tests_required`) and no peer event hash.

After atomic proposal pair persistence, each actor reads the peer proposal hash. REBUT must set `peer_event_hash_addressed` to that exact hash and provide `resulting_action`.

Historical terminal vote strings remain `WIN_GPT`, `WIN_GLM`, `SYNTHESIS`, `NO_ACTION` because deterministic V4 arbitration stores them immutably. Their current meaning is:

- `WIN_GPT` = ACTOR_A candidate wins;
- `WIN_GLM` = ACTOR_B candidate wins.

They are not provider names.

## Execution boundary

A `DECIDED` relay result is still non-authority. Before executing `resulting_action`, re-read the current semantic head, Git SHA, roadmap definition integrity, claims/directives/dependencies, and required evidence. If any authority input changed, start a new semantic point.

## Fully automatic endpoint mode

```bash
cd orchestration/sovereign
npm install --no-audit --no-fund
npm run check

export DATABASE_URL='...'
export DUEL_RUNNER_ID='gpu-worker-01'
export SOVEREIGN_ACTOR_A_URL='http://127.0.0.1:8001'
export SOVEREIGN_ACTOR_B_URL='http://127.0.0.1:8002'
export SOVEREIGN_ACTOR_A_MODEL='openai/gpt-oss-20b'
export SOVEREIGN_ACTOR_B_MODEL='openai/gpt-oss-20b'
export SOVEREIGN_CONTROL_TOKEN='<strong random token>'

npm start
```

Keep raw OpenAI-compatible inference servers on loopback/private LAN. Do not expose raw vLLM to the public Internet.

Do not run the persistent coordinator against a peer-relay session while it is intentionally blocked/armed between external actor submissions.
