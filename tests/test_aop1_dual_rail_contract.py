from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MICROSTEP = (ROOT / "orchestration/cloudflare/src/duel_microstep.ts").read_text(encoding="utf-8")
INDEX = (ROOT / "orchestration/cloudflare/src/index.ts").read_text(encoding="utf-8")
TYPES = (ROOT / "orchestration/cloudflare/src/types.ts").read_text(encoding="utf-8")
WRANGLER = (ROOT / "orchestration/cloudflare/wrangler.jsonc").read_text(encoding="utf-8")
PAIR_V2 = (ROOT / "supabase/migrations/20260824052833_aop1_duel_persisted_pair_readback_v3.sql").read_text(encoding="utf-8")
PAIR_V3 = (ROOT / "supabase/migrations/20260824061721_duel_submit_pair_idempotent_v3.sql").read_text(encoding="utf-8")

# Minimum-latency invariant: all configured inference rails start together and the
# first valid exact-model response wins. There is no provider-first sequential fallback.
assert 'Promise.any(tasks.map((t) => t.promise))' in MICROSTEP
assert 'rails.map((rail) => startRail' in MICROSTEP
assert 'DUAL_RAIL_RACE' in MICROSTEP
assert 'rail_loser' in MICROSTEP
assert 'availableRails(env)' in MICROSTEP

# Both exact model identities remain pinned per provider naming convention.
assert 'openai/gpt-5.6-sol' in MICROSTEP
assert '@cf/zai-org/glm-5.2' in MICROSTEP
assert 'zai/glm-5.2' in MICROSTEP

# Vercel asks its own gateway for the lowest time-to-first-token provider ordering;
# the external Cloudflare/Vercel race remains independent of that inner routing choice.
assert 'providerOptions: { gateway: { sort: "ttft" } }' in MICROSTEP
assert 'vercel_provider_sort: "ttft"' in MICROSTEP
assert 'duel_vercel_provider_sort: "ttft"' in INDEX

# Zero-wait is the default. Cross-provider confirmation remains opt-in for critical
# steps, with a bounded window and immediate loser abort afterwards.
assert 'DUEL_CRITICAL_SHADOW_MS || 0' in MICROSTEP
assert 'criticalStep(winner.payload)' in MICROSTEP
assert 'Promise.race([' in MICROSTEP and 'alternate.promise' in MICROSTEP
assert 'DUEL_CRITICAL_SHADOW_MS' in TYPES
assert 'DUEL_MODEL_TIMEOUT_MS' in TYPES
assert 'duel_critical_shadow_ms: Number(env.DUEL_CRITICAL_SHADOW_MS || 0)' in INDEX

# Routine debate uses bounded output and adaptive reasoning. The first tick is medium,
# routine ticks are low, and critical/veto/terminal state raises the next tick to high.
assert 'DUEL_MAX_OUTPUT_TOKENS || 1200' in MICROSTEP
assert 'DUEL_MAX_OUTPUT_TOKENS?: string' in TYPES
assert '"DUEL_MAX_OUTPUT_TOKENS": "1200"' in WRANGLER
assert 'function reasoningEffort' in MICROSTEP
assert 'return "medium"' in MICROSTEP
assert 'return "high"' in MICROSTEP
assert 'return "low"' in MICROSTEP
assert 'duel_reasoning_policy: "ADAPTIVE_LOW_MEDIUM_HIGH_V1"' in INDEX
assert 'duel_max_output_tokens: Number(env.DUEL_MAX_OUTPUT_TOKENS || 1200)' in INDEX

# The adversarial role is not permanently attached to GPT or GLM. BUILD/BREAK rotates
# by tick, keeping the actors symmetric and reducing premature argument convergence.
assert 'type Lens = "BUILD" | "BREAK"' in MICROSTEP
assert 'function assignedLens' in MICROSTEP
assert 'ROLE_LENS=' in MICROSTEP
assert 'LENS_RULE=' in MICROSTEP
assert 'ROTATING_BUILD_BREAK_V1' in INDEX

# A failing provider cannot mask a healthy provider. Executor failure is emitted only
# when Promise.any has no successful exact-model result.
assert 'duel_all_rails_failed' in MICROSTEP
assert 'duel_no_inference_rail_configured' in MICROSTEP
assert 'EXECUTOR_ERROR' in MICROSTEP
assert 'No model reasoning was fabricated' in MICROSTEP

# Persist the winning rail/latency in the observable hashed model step.
for marker in (
    'winner_rail',
    'winner_model',
    'winner_latency_ms',
    'rails_started',
    'failures_before_winner',
    '_executor',
):
    assert marker in MICROSTEP

# DB-origin duel wakes bypass both Queue and Durable Object. HMAC verification is
# followed by an idempotent Workflow createBatch() with a deterministic instance ID.
assert 'AOP_RUN_WORKFLOW.createBatch' in INDEX
assert 'workflowInstanceId(wake)' in INDEX
assert 'transport: "DIRECT_IDEMPOTENT_WORKFLOW"' in INDEX
assert 'duel_start_path: "DIRECT_WORKFLOW_CREATE_BATCH_NO_QUEUE_NO_DO"' in INDEX
assert 'createBatch(options:' in TYPES
db_wake_block = INDEX.split('url.pathname === "/duel/db-wake"', 1)[1].split('url.pathname === "/wake"', 1)[0]
assert 'AOP_WAKE_QUEUE.send' not in db_wake_block
assert 'supervisorStub(env).wake' not in db_wake_block

# Any remaining Queue delivery is recovery/general-AOP only and is configured for
# immediate single-message dispatch rather than batching.
assert '"max_batch_size": 1' in WRANGLER
assert '"max_batch_timeout": 0' in WRANGLER

# The DB-selected persisted pair remains the sole next-tick source of truth.
assert 'persisted_readback' in PAIR_V2
assert 'duel_persisted_pair_readback_missing' in PAIR_V2
assert "'gpt_event',g_readback" in PAIR_V2
assert "'glm_event',l_readback" in PAIR_V2
assert "'tick',tick_readback" in PAIR_V2
assert 'microstep-read-initial' in MICROSTEP
assert 'appendPersisted(read, receipt' in MICROSTEP
assert 'duel_pair_persisted_readback_required' in MICROSTEP
assert 'hot_path_readback: "DB_SELECTED_PAIR_RECEIPT"' in MICROSTEP
assert 'microstep-read-${tick}' not in MICROSTEP

# One durable tick: inference and the atomic DB pair commit are inside the same
# Workflow step. A retry after a successful DB commit reads and returns the original
# persisted pair instead of generating a competing replacement pair.
assert 'microstep-pair-${tick}' in MICROSTEP
assert 'microstep-dual-${tick}' not in MICROSTEP
assert 'microstep-persist-${tick}' not in MICROSTEP
assert 'ctx.attempt > 1' in MICROSTEP
assert 'replayReceiptIfCommitted' in MICROSTEP
assert 'h205f22_duel_submit_pair_v3' in MICROSTEP
assert 'ONE_DURABLE_TICK_V3' in MICROSTEP
assert 'duel_tick_durability: "ONE_DURABLE_TICK_V3"' in INDEX
assert 'p_tick_no=d.current_tick' in PAIR_V3
assert "'replayed',true" in PAIR_V3
assert 'duel_replay_input_checkpoint_mismatch' in PAIR_V3
assert 'duel_replay_output_checkpoint_mismatch' in PAIR_V3
assert 'duel_replay_pair_readback_missing' in PAIR_V3
assert 'to service_role' in PAIR_V3
assert 'from public,anon,authenticated' in PAIR_V3

# Agents still see every observable step through hashes, while the inference prompt
# receives a semantic projection rather than bulky executor metadata/full raw payloads.
assert 'function compactReadback' in MICROSTEP
assert 'function compactPayload' in MICROSTEP
assert 'CAUSAL_HISTORY=' in MICROSTEP
assert 'event_sha256' in MICROSTEP and 'payload_sha256' in MICROSTEP
assert 'parent_checkpoint_sha256' in MICROSTEP
assert 'FULL_HASHED_HISTORY_COMPACT_PROJECTION' in MICROSTEP
assert 'duel_context_mode: "FULL_HASHED_HISTORY_COMPACT_PROJECTION"' in INDEX
assert 'p_after_tick: 0' in MICROSTEP

# Health exposes routing and hot-path choices without exposing credential values.
assert 'DUAL_RAIL_RACE_V1' in INDEX
assert 'FIRST_VALID_EXACT_MODEL_RESPONSE_WINS' in INDEX
assert 'DB_WEBHOOK+DIRECT_IDEMPOTENT_WORKFLOW+ATOMIC_DB_PAIR+DUAL_RAIL_RACE' in INDEX
assert 'vercel_ai_gateway: vercelRail' in INDEX
assert 'cloudflare_ai: cloudflareRail' in INDEX
assert 'VERCEL_AI_GATEWAY_API_KEY?: string' in TYPES

print("AOP1 dual-rail one-durable-tick contract guards: PASS")
