# METAENGINE continuous autonomous development: 2026-10-12 architecture review (local)

## Ultimate acceptance test
The METAENGINE Windows client must autonomously develop an assigned software project, coordinate dynamically created ChatGPT agents (target GPT-6 High when the actual authenticated UI supports the mode), retain durable state across crashes/reboots, perform code+tests+independent criticism, and improve its own client through separately qualified upgrades. A model selector label, an open tab, a heartbeat or a green mock test alone does not prove this goal.

## Verified local baseline, not a claim of finished autonomy
Authoritative source: `work/client-autonomous-continuity-v1` on Windows, not upstream GitHub. The .61.1 candidate was built from `c5917a9...` and passed a *disposable PostgreSQL* packaged Owner/CDP/UI physical E2E; this does not exercise ChatGPT agent useful work. Installed .59 remains runtime STOPPED, Admin disconnected, Supervisor `WAKE_AMBIGUOUS`, zero proven agents. A one-shot live pre-upgrade `pg_dump` was unconfirmed and left a 0-byte file with no PASS receipt. The backup-only gate from commit `2755d3f...` correctly holds installation, and the earlier unknown Send has not been repeated.

## External technical research: competing designs and adoptable mechanisms
- **Temporal** workflow history and activity model: replay deterministic decisions; keep side effects in Activities with explicit retry and idempotency policy. Child workflows are suitable for durable delegated tasks. https://docs.temporal.io/child-workflows and https://github.com/temporalio/documentation/blob/main/docs/encyclopedia/workflow/workflow-definition.mdx
- **LangGraph** checkpoints for thread continuation and separate stores for long-term, cross-thread facts. Checkpoint persistence does not automatically make external effects exactly once. https://langchain-ai.github.io/langgraph/concepts/durable_execution/ and https://github.com/langchain-ai/docs/blob/main/src/oss/langgraph/checkpointers.mdx
- **OpenAI Agents SDK** handoffs and manager-as-tools patterns: owner of a response and authority for a physical action must be explicit. Tool and handoff guardrails have distinct boundaries; tracing can record ownership and outcomes. https://developers.openai.com/api/docs/guides/agents/orchestration and https://openai.github.io/openai-agents-js/guides/handoffs/
- **PostgreSQL 17**: `pg_dump` internally performs SELECT and uses libpq connection environment. A successful `pg_isready` is not proof that the snapshot role can execute `pg_dump` successfully. Archive TOC inspection does not equal full restore validation. https://www.postgresql.org/docs/17/app-pgdump.html

### Architectural decision (not yet full implementation)
**Do not add a second orchestration authority or paid workflow service while the installed local runtime is unavailable.** Adopt the strongest execution properties as contracts inside the existing Node/PG runtime; only consider a separate Temporal worker if tests later establish a demonstrable durability/scaling benefit.

Model the core loop as:
```
Goal admitted -> deterministic plan -> durable claim/lease -> immutable effect intent
-> trusted native/browser execution -> exact process/tab/model readback
-> independently verified output -> merge/checkpoint -> next admissible work
```
An UNKNOWN external effect is *not* a retryable timeout. It must remain attached to the same intent, process incarnation, target identity and result journal until independently reconciled. The page/transcript cannot authenticate its own physical Send outcome. Never use raw excerpt markers as an automatic settlement receipt.

Logical agent count is data, not a fixed tab-count target. Physical slots belong to a bounded resource broker and are adjusted using CPU, memory, model quota, browser stability and queue pressure. A single Supervisor tick must not linearly await the full fleet one tab at a time. The newly added bounded observation worker pool provides a first, limited optimization: max four concurrent **read-only CAPTURE** calls, stable result order, and one serial durable wake publication. It does not parallelize Send or grant new authority; physical 64-agent scaling remains unqualified.

## Trust/evidence hierarchy
1. **Intention**: immutable signed/hashed request and exact incarnation/lease identity, before side effects.
2. **Observation**: DOM text, screenshot and chat transcript — useful content but *not trusted authority*.
3. **Execution**: trusted kernel evidence of exactly which command was issued, to which target/incarnation, and its bounded outcome.
4. **Verification**: independent readback of outputs/commit SHA/test receipt; a green single agent's self-report is insufficient.
5. **Promotion**: separately fenced operator/host gates including tested rollback, backup integrity and intact user state.

The lifecycle source previously accepted `wake_id` inside `text_excerpt` as `observed_sent:true`. This was an untrusted-content promotion across the trust boundary. The new gate classifies it as `PAGE_MARKER_UNVERIFIED`; it intentionally cannot reconcile an old unknown effect. Native trustworthy event-origin proof is a follow-on feature, not implicitly present now.

## Next engineering phases and proof obligations
**P0. Installed continuity:** collect sanitized failure categories for the *prior* live backup without re-running it or exposing credentials; create a separately fenced new snapshot transaction, independently verify it with `pg_restore` and a disposable restore; only then qualify a controlled installed upgrade to .61 with exact Owner/Keeper/process pins and rollback.

**P0. One agent:** prove end to end on the upgraded installed Browser: admitted goal, exact lease, authenticated normal ChatGPT conversation, real output, independent test, durable checkpoint. Verify actual model/mode if supported by trusted UI readback; do not invent proof for GPT-6 High.

**P0. Four agents:** roles PLANNER/IMPLEMENTER/CRITIC/INTEGRATOR; common provenance-bound task ledger; no shared mutable worktree without leases; independent critic and verified merge; communication messages must be task-ID and causal-sequence bound.

**P1. Elastic fleet:** instrument time-to-observation, max concurrent captures, queue lag, memory, site throttles, duplicate intents and per-task cost. Scale 4 -> 16 -> 32 -> 64 logical agents under bounded physical slots with adversarial restarts; no fake work credit from simulated completion.

**P1. 72-hour resilience:** reboot / network loss / PostgreSQL transient fault / Browser process death / auth expiration / ambiguous Send / lost leases. A recovered process may restore deterministic workflow state, but not replay an unknown real-world effect.

**P1. Verified self-improvement:** agent-generated change -> isolated worktree -> tests + independent critic -> frozen SHA build -> physical QA -> protected backup -> canary / rollback evidence -> controlled promotion. No self-certifying or automatic production promotion of irreversible effects.

## Explicit nonclaims
- The marker fix removes a false-positive origin channel but is not by itself a working positive native send-receipt system.
- The bounded CAPTURE pool has synthetic tests, not a real 64-chat measured throughput result.
- Installed .59 is not a working autonomous fleet; .61 remains a *candidate* until installed authority and backup gates pass.
- Upstream GitHub remains stale relative to local Windows; no blind git pull/reset/rebase/push.
