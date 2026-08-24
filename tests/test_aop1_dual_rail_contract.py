from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MICROSTEP = (ROOT / "orchestration/cloudflare/src/duel_microstep.ts").read_text(encoding="utf-8")
INDEX = (ROOT / "orchestration/cloudflare/src/index.ts").read_text(encoding="utf-8")
TYPES = (ROOT / "orchestration/cloudflare/src/types.ts").read_text(encoding="utf-8")
WRANGLER = (ROOT / "orchestration/cloudflare/wrangler.jsonc").read_text(encoding="utf-8")
PAIR_V3 = (ROOT / "supabase/migrations/20260824052833_aop1_duel_persisted_pair_readback_v3.sql").read_text(encoding="utf-8")

# Minimum-latency invariant: all configured inference rails start together and the
# first valid exact-model response wins. There is no provider-first sequential fallback.
assert 'Promise.any(tasks.map((t)=>t.promise))' in MICROSTEP
assert 'rails.map((rail)=>startRail' in MICROSTEP
assert 'DUAL_RAIL_RACE' in MICROSTEP
assert 'rail_loser' in MICROSTEP
assert 'availableRails(env)' in MICROSTEP

# Both exact model identities remain pinned per provider naming convention.
assert 'openai/gpt-5.6-sol' in MICROSTEP
assert '@cf/zai-org/glm-5.2' in MICROSTEP
assert 'zai/glm-5.2' in MICROSTEP

# Zero-wait is the default. Cross-provider confirmation remains opt-in for critical
# steps, with a bounded window and immediate loser abort afterwards.
assert 'DUEL_CRITICAL_SHADOW_MS||0' in MICROSTEP
assert 'criticalStep(winner.payload)' in MICROSTEP
assert 'Promise.race([alternate.promise' in MICROSTEP
assert 'DUEL_CRITICAL_SHADOW_MS' in TYPES
assert 'DUEL_MODEL_TIMEOUT_MS' in TYPES
assert 'duel_critical_shadow_ms: Number(env.DUEL_CRITICAL_SHADOW_MS || 0)' in INDEX

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

# DB-origin duel wakes bypass Queue entirely: HMAC verification is followed by a
# direct Durable Object binding call, which starts the Workflow immediately. Queue
# remains available for recovery/other AOP wake sources only.
assert 'const direct = await supervisorStub(env).wake(wake)' in INDEX
assert 'transport: "DIRECT_DURABLE_OBJECT"' in INDEX
assert 'duel_start_path: "DIRECT_DO_NO_QUEUE"' in INDEX
db_wake_block = INDEX.split('url.pathname === "/duel/db-wake"', 1)[1].split('url.pathname === "/wake"', 1)[0]
assert 'AOP_WAKE_QUEUE.send' not in db_wake_block

# Any remaining Queue delivery is configured for immediate single-message dispatch.
assert '"max_batch_size": 1' in WRANGLER
assert '"max_batch_timeout": 0' in WRANGLER

# Post-first ticks use the DB-selected rows returned by the atomic pair transaction,
# eliminating an extra HTTP read without trusting caller-local state.
assert 'persisted_readback' in PAIR_V3
assert 'duel_persisted_pair_readback_missing' in PAIR_V3
assert "'gpt_event',g_readback" in PAIR_V3
assert "'glm_event',l_readback" in PAIR_V3
assert "'tick',tick_readback" in PAIR_V3
assert 'microstep-read-initial' in MICROSTEP
assert 'appendPersisted(read,receipt' in MICROSTEP
assert 'duel_pair_persisted_readback_required' in MICROSTEP
assert 'hot_path_readback:"DB_SELECTED_PAIR_RECEIPT"' in MICROSTEP
assert 'microstep-read-${tick}' not in MICROSTEP

# Health exposes routing and hot-path choices without exposing credential values.
assert 'DUAL_RAIL_RACE_V1' in INDEX
assert 'FIRST_VALID_EXACT_MODEL_RESPONSE_WINS' in INDEX
assert 'DB_WEBHOOK+DIRECT_DURABLE_OBJECT+WORKFLOW+ATOMIC_DB_PAIR+DUAL_RAIL_RACE' in INDEX
assert 'vercel_ai_gateway: vercelRail' in INDEX
assert 'cloudflare_ai: cloudflareRail' in INDEX
assert 'VERCEL_AI_GATEWAY_API_KEY?: string' in TYPES
