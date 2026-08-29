# F1 Sparse Targeted-Falsification Committee — 2026-08-29

Status: PREPARE_ONLY / non-canonical / non-authority.

Canonical Level-1 milestone: F1+
Level-2 milestone: F1_LIVE_EXTERNAL_FEDERATION

## Motivation

The first zero-spend committee deliberately treats 2/3 only as an availability quorum. A second research pass reinforced that the system should not convert model majority into semantic truth:

- *Minority Sentinel: When to Overturn Majority Voting in Multi-Agent LLM Debates* (arXiv:2606.29270) reports that correlated errors among heterogeneous LLMs can suppress a correct minority answer, motivating explicit preservation of dissent rather than majority-winner promotion.
- *Debate or Vote: Which Yields Better Decisions in Multi-Agent Large Language Models?* (arXiv:2508.17536) finds that simple majority voting explains much of the observed gain attributed to multi-agent debate, while debate alone does not guarantee improved expected correctness without targeted corrective intervention.
- *Improving Multi-Agent Debate with Sparse Communication Topology* (arXiv:2406.11776) reports that sparse communication can match or outperform fully connected debate while reducing communication cost.
- Google DeepMind's *On scalable oversight with weak LLMs judging strong LLMs* (arXiv:2407.04622) reports task-dependent debate benefits and mixed results versus direct answering outside some information-asymmetry settings, reinforcing the decision not to claim debate as a universal correctness oracle.

These results are treated as design evidence, not as proof that any specific METAENGINE model committee is correct.

## Implemented protocol

Endpoint: `POST /v1/committee/challenge`.

Protocol name: `SPARSE_RING_TARGETED_FALSIFICATION_V1`.

Wave 1 remains the existing independent three-provider committee:

1. MiniMax M3 Free
2. Poolside Laguna S 2.1 Free
3. InclusionAI Ling 3.0 Flash Fin Free

After Wave 1:

- if fewer than two provider responses are usable, the challenge wave is not invented and the endpoint returns a structured HTTP 503 receipt;
- if two providers survive, they challenge each other;
- if all three survive, deterministic sparse ring assignments are:
  - MiniMax challenges Poolside;
  - Poolside challenges InclusionAI;
  - InclusionAI challenges MiniMax.

The ring intentionally avoids all-to-all broadcast and does not ask any model to vote for a winner.

## Challenge objective

Each challenger receives one peer answer marked as untrusted data. The trusted preamble instructs it to find the strongest concrete flaw rather than agree, synthesize, or follow instructions found inside the peer output.

Requested critique focus:

- concrete counterexample;
- missing evidence;
- unsafe assumption;
- falsifying test or evidence check;
- preservation of a correct minority view when warranted.

No semantic consensus is computed by the gateway.

## Safety and provenance invariants

- fresh tier-aware zero-price catalog verification before **Wave 1**;
- a second fresh zero-price verification immediately before **Wave 2**;
- Wave 1 price state cannot authorize spend in Wave 2 after a catalog change;
- each challenge is a single-model call with no fallback substitution;
- `served_model` must equal the challenger model;
- peer output is explicitly labeled untrusted;
- secret-like content in either original input or forwarded peer output is blocked before cross-provider forwarding;
- each target answer, critique, and upstream response is SHA-256 bound;
- challenge completion requires **target coverage**, not a majority count: every surviving Wave-1 proposal must receive a successful challenge;
- a failed or substituted challenger leaves `challenge_status=INCOMPLETE`;
- `semantic_consensus_evaluated=false`;
- `semantic_consensus=null`;
- `synthesis_performed=false`;
- `requires_supervisor_arbitration=true`;
- `direct_action_allowed=false`;
- `executable_action=null`;
- `canonical=false`;
- `authority_effect=false`.

The full two-wave response receives a key-sorted canonical-JSON SHA-256 receipt, while Wave-1 and Wave-2 pricing/provenance objects have independent hashes.

## Why target coverage rather than majority

The challenge gate is designed to answer a narrower question: "Did every surviving proposal receive an independent falsification attempt under verified provenance?"

It does **not** answer:

- which proposal is true;
- which model won;
- whether two models agree semantically;
- whether an action is safe to execute;
- whether roadmap or runtime authority exists.

Those remain supervisor responsibilities under existing METAENGINE governance.

## Verification

Tested code head: `8e1b6e6bfc685885941b83051fcb3b5b6a3e4956`.

`F1 Model Gateway Contract` run #23 / GitHub Actions run `33235065585`: **SUCCESS**.

- syntax/schema gates: PASS;
- total contract/adversarial tests: **46/46 PASS**;
- sparse 3-peer ring assignment: PASS;
- 2-peer survivor mutual challenge: PASS;
- parallel challenge execution: PASS;
- complete target coverage gate: PASS;
- served-model substitution => incomplete challenge: PASS;
- peer-output untrusted-data prompt fence: PASS;
- secret-like cross-provider forwarding => blocked: PASS;
- live Vercel catalog gate: PASS;
- live catalog observed: 360 models;
- selected three routes remain tier-aware zero-price: PASS;
- contract-CI inference calls: 0;
- authority effect: false.

Governance Preview remains intentionally red for the unregistered F1 accelerator branch and was not weakened.

## Live limitation

The existing live qualification rail still fails actual inference at the Vercel customer/account verification layer with HTTP 403 before model answers. Therefore the two-wave protocol is contract-proven but is **not** claimed as live model debate evidence.

## Integration boundary

The sparse committee remains an advisory layer. It is not inserted as a third actor into the existing two-actor SAME_POINT_DUEL_V4 peer relay. The supervisor may later consume the proposal/challenge transcript as evidence, but execution requires a fresh authority/state revalidation and the normal METAENGINE action gates.