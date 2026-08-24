from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MICROSTEP = (ROOT / "orchestration/cloudflare/src/duel_microstep.ts").read_text(encoding="utf-8")
INDEX = (ROOT / "orchestration/cloudflare/src/index.ts").read_text(encoding="utf-8")
TYPES = (ROOT / "orchestration/cloudflare/src/types.ts").read_text(encoding="utf-8")

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

# Normal microsteps never wait for the losing rail. Only critical trust/arbitration
# steps get a bounded confirmation window, after which the loser is aborted.
assert 'criticalStep(winner.payload)' in MICROSTEP
assert 'criticalShadowMs(env)' in MICROSTEP
assert 'Promise.race([alternate.promise' in MICROSTEP
assert 'DUEL_CRITICAL_SHADOW_MS' in TYPES
assert 'DUEL_MODEL_TIMEOUT_MS' in TYPES

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

# Health exposes routing availability without exposing any credential value.
assert 'DUAL_RAIL_RACE_V1' in INDEX
assert 'FIRST_VALID_EXACT_MODEL_RESPONSE_WINS' in INDEX
assert 'vercel_ai_gateway: vercelRail' in INDEX
assert 'cloudflare_ai: cloudflareRail' in INDEX
assert 'VERCEL_AI_GATEWAY_API_KEY?: string' in TYPES
