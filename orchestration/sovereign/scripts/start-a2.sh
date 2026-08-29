#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required for trusted A2 control services}"
: "${A2_WORKSPACE_ID:?A2_WORKSPACE_ID is required}"
: "${A2_GPT_MODEL_URL:?A2_GPT_MODEL_URL is required}"
: "${A2_GLM_MODEL_URL:?A2_GLM_MODEL_URL is required}"

export A2_INGRESS_URL="${A2_INGRESS_URL:-http://127.0.0.1:${A2_INGRESS_PORT:-8092}}"
GPT_RUNTIME_ID="${A2_GPT_RUNTIME_ID:-a2-gpt-runtime}"
GLM_RUNTIME_ID="${A2_GLM_RUNTIME_ID:-a2-glm-runtime}"
pids=()

cleanup() {
  for pid in "${pids[@]}"; do
    if kill -0 "${pid}" 2>/dev/null; then kill "${pid}" 2>/dev/null || true; fi
  done
  for pid in "${pids[@]}"; do wait "${pid}" 2>/dev/null || true; done
}
trap cleanup EXIT INT TERM

probe_peer() {
  local agent="$1" provider="$2" model="$3" model_url="$4" model_token="$5"
  local output status
  set +e
  output="$(env -u DATABASE_URL \
    A2_AGENT="$agent" \
    A2_PROVIDER="$provider" \
    A2_MODEL="$model" \
    A2_MODEL_URL="$model_url" \
    A2_MODEL_TOKEN="$model_token" \
    tsx src/a2_model_probe.ts)"
  status=$?
  set -e
  printf '%s\n' "$output"
  if [ "$status" -ne 0 ]; then
    echo "A2 exact-model readiness failed for $agent (exit=$status); peers were not registered and no sync round was opened." >&2
    exit "$status"
  fi
}

# Fail before creating peer sessions or lockstep rounds when an exact inference rail is unavailable.
probe_peer GPT openai openai/gpt-5.6-sol "$A2_GPT_MODEL_URL" "${A2_GPT_MODEL_TOKEN:-}"
probe_peer GLM z.ai zai/glm-5.3 "$A2_GLM_MODEL_URL" "${A2_GLM_MODEL_TOKEN:-}"

GPT_KEY="${A2_GPT_ED25519_PRIVATE_KEY_PEM_B64:-$(tsx src/a2_keygen.ts)}"
GLM_KEY="${A2_GLM_ED25519_PRIVATE_KEY_PEM_B64:-$(tsx src/a2_keygen.ts)}"
GPT_EPOCH="${A2_GPT_CAPABILITY_EPOCH:-$(A2_AGENT=GPT tsx src/a2_epoch_allocator.ts)}"
GLM_EPOCH="${A2_GLM_CAPABILITY_EPOCH:-$(A2_AGENT=GLM tsx src/a2_epoch_allocator.ts)}"

tsx src/a2_ingress.ts &
pids+=("$!")

for _ in {1..40}; do
  if curl -fsS "${A2_INGRESS_URL}/healthz" >/dev/null; then break; fi
  sleep 0.25
done
curl -fsS "${A2_INGRESS_URL}/healthz" >/dev/null

tsx src/a2_coordinator.ts &
pids+=("$!")
tsx src/a2_server.ts &
pids+=("$!")

launch_peer() {
  local agent="$1" provider="$2" model="$3" model_url="$4" model_token="$5" runtime_id="$6" epoch="$7" key="$8"
  env -u DATABASE_URL \
    A2_AGENT="$agent" \
    A2_PROVIDER="$provider" \
    A2_MODEL="$model" \
    A2_MODEL_URL="$model_url" \
    A2_MODEL_TOKEN="$model_token" \
    A2_RUNTIME_ID="$runtime_id" \
    A2_CAPABILITY_EPOCH="$epoch" \
    A2_ED25519_PRIVATE_KEY_PEM_B64="$key" \
    tsx src/a2_runtime.ts &
  pids+=("$!")

  env -u DATABASE_URL \
    A2_AGENT="$agent" \
    A2_PROVIDER="$provider" \
    A2_MODEL="$model" \
    A2_RUNTIME_ID="$runtime_id" \
    A2_CAPABILITY_EPOCH="$epoch" \
    A2_ED25519_PRIVATE_KEY_PEM_B64="$key" \
    tsx src/a2_lease_keeper.ts &
  pids+=("$!")
}

launch_peer GPT openai openai/gpt-5.6-sol "$A2_GPT_MODEL_URL" "${A2_GPT_MODEL_TOKEN:-}" "$GPT_RUNTIME_ID" "$GPT_EPOCH" "$GPT_KEY"
launch_peer GLM z.ai zai/glm-5.3 "$A2_GLM_MODEL_URL" "${A2_GLM_MODEL_TOKEN:-}" "$GLM_RUNTIME_ID" "$GLM_EPOCH" "$GLM_KEY"

wait -n "${pids[@]}"
