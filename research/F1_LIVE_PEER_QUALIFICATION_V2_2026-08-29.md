# F1 live external peer qualification v2 — 2026-08-29

This checkpoint records only model behavior observed through real HTTP/Gradio/Supabase inference paths. A model is not marked connected merely because a Space or catalog entry exists.

## Current live plane

Supabase Edge broker: `metaengine-live-peer-broker-h205f22`

Current qualified API surface:

- OpenAI-compatible `POST /v1/chat/completions`
- `metaengine/structured-auto`
- advisory committee with separate availability quorum and answer agreement
- structured committee with JSON recovery before agreement
- divergence decision adapter `metaengine-peer-decision-h205f22`

All public-Space outputs are advisory external data. The broker does not claim semantic truth or action authority.

## Live-qualified peers

| Peer | Family | Real inference | Observed role | Key observations |
|---|---|---:|---|---|
| `gemma2` | Google Gemma | PASS | fast + structured | Usually ~2–4s when ZeroGPU quota is available. Correct on observed arithmetic and JSON tests. Later hit anonymous ZeroGPU reservation quota. |
| `llama32` | Meta Llama 3.2 | PASS | structured + corrective | Direct GPU inference PASS. OpenAI JSON request returned canonical `{"ok":true,"value":42}` in ~6.15s. With 128-token structured committee cap it returned canonical `{"answer":20}` in ~4.2s. |
| `nemotron` | NVIDIA Nemotron 3.5 | PASS with qualification fence | diverse advisory | Real GPU inference PASS, but final-channel behavior is unstable on the public Space: completed `</think>121` normalized correctly, some generations end with no final after `</think>`, and one observed arithmetic run returned an incorrect final. Incomplete reasoning is now fail-closed. |
| `tinyllama` | TinyLlama | PASS transport / FAIL quality qualification | availability only | Always-on CPU-style Gradio generator works and is quota-independent, but exact instruction following failed in qualification. `quorum_eligible=false`. |
| `llama2` | Meta Llama 2 | PASS | legacy quality backup | Direct `METAENGINE_OK` probe passed, but 90s ZeroGPU reservation consumed quota quickly. Kept as late backup only. |

## Selected live receipts

- request 152: Gemma arbitrary broker prompt -> `GEMMA_BROKER_OK`
- request 153: Llama 2 arbitrary broker prompt -> `LLAMA_BROKER_OK`
- request 154: Nemotron real generation
- request 169: adaptive Gemma + Nemotron committee on `9*7`
- request 170: Nemotron `11*11` -> normalized final `121`
- requests 218/219: OpenAI-compatible Llama32 and structured-auto end-to-end PASS
- request 221: incomplete Nemotron rejected; TinyLlama transport fallback exposed why transport success must not equal quality quorum
- request 223: incomplete Nemotron rejected; Llama32 used as quality backup
- request 225: Gemma/Nemotron divergence on `13*13`; independent Llama32 tiebreak supported Gemma's `169` while `truth_claimed=false`
- request 226: regression PASS — Gemma `144`, incomplete Nemotron rejected, structured Llama32 backup `144`, observed `AGREED`
- request 228: structured committee — Llama32 canonical JSON PASS at 128 tokens; Gemma unavailable because anonymous ZeroGPU quota was exhausted

## Important live defects found and fixed

1. **Hardcoded probe != real integration**
   - Replaced fixed `METAENGINE_OK` probes with a programmable Supabase broker accepting arbitrary prompts.

2. **Reasoning trace mistaken for final answer**
   - Nemotron `</think>` / `<final>` normalization added.
   - A long reasoning trace with no final is now `incomplete_generation` and cannot satisfy committee quorum.
   - A closing `</think>` with an empty tail is also incomplete.

3. **Transport success mistaken for useful committee vote**
   - TinyLlama remains an availability peer but has `quorum_eligible=false`.

4. **Raw Llama32 backup returned code instead of the requested scalar**
   - Advisory backup now uses a structured independent `{answer: ...}` envelope and extracts only the answer.

5. **Availability quorum mistaken for answer agreement**
   - Committee now emits both `availability_quorum_met` and `decision_state` / `answer_candidate`.
   - Candidate is exposed only for exact/numeric observed agreement.

6. **Two-model disagreement had no independent escalation**
   - `metaengine-peer-decision-h205f22` invokes Llama32 independently only after divergence and only if Llama32 did not already participate.
   - It never shows the two peer answers to the tiebreak model.
   - `TIEBREAK_SUPPORT` remains observational: `truth_claimed=false`.

7. **Structured committee compared wrappers instead of JSON values**
   - Every structured peer now undergoes JSON recovery before agreement.
   - Objects use recursive key-sorted canonical JSON.

8. **ZeroGPU output budget caused avoidable reservation failures**
   - Llama32 structured committee budget capped at 128 tokens. This changed a previous 135-second reservation failure into a live successful structured inference while quota remained available.

## Research implications

Recent ensemble research indicates that heterogeneous panels should not treat every model as equally trustworthy. Correlated failures can reduce many apparent judges to only a few effective independent votes, and unreliable experts can degrade naive aggregation. Therefore this implementation intentionally uses:

- task-aware roles rather than equal votes;
- explicit separation of availability and agreement;
- independent corrective tiebreak only on observed divergence;
- no semantic truth claim from majority or 2/3 agreement;
- weak availability models excluded from quality quorum;
- future routing to be driven by measured capability/reliability rather than model branding.

Relevant research reviewed during this implementation:

- `Nine Judges, Two Effective Votes: Correlated Errors Undermine LLM Evaluation Panels` (2026)
- `Uncertainty-Aware Trust Estimation for Multi-LLM Systems via Structured Expert Judgement` (2026)

## Current routing recommendation

- structured JSON / machine contracts: `gemma2 -> llama32`
- diverse advisory committee: `gemma2 + nemotron`
- corrective backup when Nemotron is incomplete: structured `llama32`
- divergence tiebreak: independent `llama32` only when it was not already a committee member
- availability-only fallback: `tinyllama`, never quality quorum
- late legacy backup: `llama2`, because of high ZeroGPU reservation cost

## Remaining practical blocker

The main blocker is now free public GPU quota/availability, not the METAENGINE transport. A stronger next step is a live always-on CPU peer (Qwen/Phi/SmolLM-class) with a public callable API, or restoration of a credentialed Vercel/Cloudflare/provider rail. Such a peer should not enter the registry until real inference passes.
