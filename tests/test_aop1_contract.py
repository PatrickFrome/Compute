from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20260821060500_aop1_clean_replay.sql"
OIDC_MIGRATION = ROOT / "supabase/migrations/20260821071452_aop1_one_time_github_oidc_bootstrap_capability.sql"
DENY_MIGRATION = ROOT / "supabase/migrations/20260821072003_aop1_bootstrap_capability_explicit_deny_policy.sql"
REARM_MIGRATION = ROOT / "supabase/migrations/20260821080306_aop1_supervisor_rearm_exhausted_analyst.sql"
SIGNAL_MIGRATION = ROOT / "supabase/migrations/20260821082219_aop1_signal_resume_payload_v2.sql"
STALE_RUN_MIGRATION = ROOT / "supabase/migrations/20260821102500_aop1_stale_run_fencing_v1.sql"
STALE_RUN_V2 = ROOT / "supabase/migrations/20260821111500_aop1_stale_run_fencing_v2.sql"
DEPLOY_EXCHANGE = ROOT / "supabase/migrations/20260821110000_aop1_reusable_oidc_deploy_exchange_v1.sql"
DEPLOY_BROKER = ROOT / "supabase/functions/metaengine-aop1-github-oidc-deploy-h205f22/index.ts"
CF = ROOT / "orchestration/cloudflare/src"
WRANGLER = ROOT / "orchestration/cloudflare/wrangler.jsonc"
LIVE_DEPLOY = ROOT / ".github/workflows/aop1-live-deploy.yml"

sql = MIGRATION.read_text(encoding="utf-8")
oidc_sql = OIDC_MIGRATION.read_text(encoding="utf-8")
deny_sql = DENY_MIGRATION.read_text(encoding="utf-8")
rearm_sql = REARM_MIGRATION.read_text(encoding="utf-8")
signal_sql = SIGNAL_MIGRATION.read_text(encoding="utf-8")
stale_sql = STALE_RUN_MIGRATION.read_text(encoding="utf-8")
stale_v2_sql = STALE_RUN_V2.read_text(encoding="utf-8")
deploy_exchange_sql = DEPLOY_EXCHANGE.read_text(encoding="utf-8")
deploy_broker_ts = DEPLOY_BROKER.read_text(encoding="utf-8")
index_ts = (CF / "index.ts").read_text(encoding="utf-8")
executor_ts = (CF / "executor.ts").read_text(encoding="utf-8")
github_ts = (CF / "github.ts").read_text(encoding="utf-8")
supabase_ts = (CF / "supabase.ts").read_text(encoding="utf-8")
types_ts = (CF / "types.ts").read_text(encoding="utf-8")
wrangler_json = WRANGLER.read_text(encoding="utf-8")
deploy_yml = LIVE_DEPLOY.read_text(encoding="utf-8")

# Authority/truth invariants.
assert "NO_MANUAL_HANDOFF_V1" in sql
assert "authority_effect boolean not null default false check (authority_effect=false)" in sql
assert "active_supervisor_capability_required" in sql
assert "cannot_record_verified_before_authoritative_roadmap_is_verified" in sql
assert "compute_fabric_finish_roadmap_claim_h205f22" in sql
assert "compute_fabric_supervisor_set_directive_h205f22" in sql
assert "compute_fabric_claim_roadmap_work_h205f22" in sql

# At-least-once/idempotency and immutability.
assert sql.count("on conflict(idempotency_key) do nothing") >= 2
assert "aop_event_is_append_only" in sql
assert "aop_terminal_run_is_immutable" in sql
assert "lease_generation" in sql and "run_lease_fenced" in sql
assert "duplicate',not v_inserted" in sql

# Client isolation.
for table in ("compute_fabric_aop_role_h205f22", "compute_fabric_aop_event_h205f22", "compute_fabric_aop_run_h205f22"):
    assert f"alter table destruktion_meta.{table} enable row level security" in sql
assert "to anon,authenticated using(false) with check(false)" in sql

# Runtime fail-closed behavior and authority boundaries.
assert "EXECUTOR_AVAILABLE" in index_ts
assert "AOP_SUPERVISOR_TOKEN_MISSING" in executor_ts
assert "AI_EXECUTOR_NOT_CONFIGURED" in executor_ts
assert "GITHUB_WRITE_EXECUTOR_AVAILABLE" in executor_ts
assert "waiting_event_requires_mutation_plan" in executor_ts
assert "waiting_event_requires_wake_condition" in executor_ts
assert "main_branch_write_forbidden" in github_ts
assert "invalid_repo_path" in github_ts
assert "github_pull_request_files" in executor_ts
assert "github_read_file_ref" in executor_ts
assert "supervisor_tool_forbidden" in executor_ts
assert "Checkpoint seal and main merge are intentionally not exposed" in executor_ts
assert "JSON.stringify(await leaseRun" in index_ts
assert "JSON.stringify(await executeRole" in index_ts

# Public GitHub reads stay tokenless. Mutations accept either a legacy dedicated
# token or a complete GitHub App tuple, with the App path preferred when PAT is absent.
assert 'const mutation = method !== "GET" && method !== "HEAD"' in github_ts
assert "github_mutation_credential_missing" in github_ts
assert "github_app_configuration_incomplete" in github_ts
assert "githubAppConfigured" in github_ts
assert "githubWriteConfigured" in github_ts
assert 'lease.role_kind === "IMPLEMENTER" && githubWriteConfigured(env)' in executor_ts
assert "if (!githubWriteConfigured(env))" in executor_ts
assert '"WAITING_EVENT"' in executor_ts
assert "output.mutation_plan" in executor_ts
assert 'wake_condition=GITHUB_WRITE_EXECUTOR_AVAILABLE' in executor_ts
assert "github_write_tool_forbidden_for_role" in executor_ts
assert "Analyst is strictly read-only in GitHub tools" in executor_ts
assert "github_configured: githubWriteConfigured(env)" in index_ts
assert "github_auth_mode: githubAuthMode(env)" in index_ts

# GitHub App authentication mints short-lived installation tokens instead of
# persisting a generated installation token. Repository scope is explicit.
assert 'GITHUB_APP_CLIENT_ID' in types_ts
assert 'GITHUB_APP_INSTALLATION_ID' in types_ts
assert 'GITHUB_APP_PRIVATE_KEY' in types_ts
assert 'RSASSA-PKCS1-v1_5' in github_ts
assert 'iat: now - 60' in github_ts
assert 'exp: now + 540' in github_ts
assert '/app/installations/${installationId}/access_tokens' in github_ts
assert 'repositories: [REPO_NAME]' in github_ts
assert 'BEGIN RSA PRIVATE KEY' in github_ts and 'BEGIN PRIVATE KEY' in github_ts
assert 'wrapPkcs1AsPkcs8' in github_ts
assert 'body.token' in github_ts and 'body.expires_at' in github_ts
assert 'return body.token' in github_ts

# Stale execution objects are terminally fenced before wake/lease can revive them.
assert "compute_fabric_aop_run_wake_status_h205f22" in stale_sql
assert "STALE_SEMANTIC_HEAD" in stale_sql
assert "ORPHANED_OR_EXPIRED_CLAIM" in stale_sql
assert "ROADMAP_NOT_IN_PROGRESS" in stale_sql
assert "ROADMAP_NOT_EVIDENCE_READY" in stale_sql
assert "RUN_FENCED" in stale_sql
assert "c.base_checkpoint_id=v_head" in stale_sql

# v2 supersedes the wake-only fence: it also fences completion before authority finish,
# constrains Supervisor reason/state pairs, and forbids broad GitHub mutation wakeups.
for marker in (
    "SUPERVISOR_REBIND_STATUS_STALE",
    "SUPERVISOR_REVIEW_STATUS_STALE",
    "TARGETED_OR_ROLE_SIGNAL_REQUIRED",
    "CONDITION_SIGNAL_REJECTED_BROAD_MUTATION",
    "run_base_checkpoint_stale",
    "implementer_completion_requires_in_progress",
    "active_claim_required_for_implementer_completion",
    "analyst_completion_requires_evidence_ready",
    "supervisor_rebind_completion_status_stale",
    "supervisor_review_completion_status_stale",
    "metaengine.compute.aop-complete.h205f22.v5",
):
    assert marker in stale_v2_sql
assert "c.base_checkpoint_id=v_head" in stale_v2_sql
assert stale_v2_sql.index("run_base_checkpoint_stale") < stale_v2_sql.index("compute_fabric_finish_roadmap_claim_h205f22")
assert stale_v2_sql.index("active_claim_required_for_implementer_completion") < stale_v2_sql.index("compute_fabric_finish_roadmap_claim_h205f22")

# Responses tool loop remains stateless when store=false.
assert "previous_response_id" not in executor_ts
assert "const transcript: Array<Record<string, unknown>>" in executor_ts
assert "transcript.push(...responseItems(response), ...outputs)" in executor_ts
assert "instructions, input: transcript" in executor_ts
assert "model_transcript_limit_exceeded" in executor_ts
assert "MAX_TRANSCRIPT_BYTES" in executor_ts
assert "canonicalReadOnlyToolName" in executor_ts
assert 'lease.role_kind !== "ANALYST"' in executor_ts
assert "READ_ONLY_TOOL_NAMES" in executor_ts
assert '"github_write_file"' not in executor_ts.split("const READ_ONLY_TOOL_NAMES", 1)[1].split("]);", 1)[0]
assert '"supervisor_return_authority"' not in executor_ts.split("const READ_ONLY_TOOL_NAMES", 1)[1].split("]);", 1)[0]

# Resume semantics attach the evidence payload to the next lease input.
assert "resume_signal" in signal_sql
assert "input=coalesce(input,'{}'::jsonb) || jsonb_build_object" in signal_sql
assert "resume_payload_attached" in signal_sql
assert "signal_payload_must_be_object" in signal_sql
assert "signal_payload_too_large" in signal_sql
assert "65536" in signal_sql
assert "authority_effect',false" in signal_sql
assert "revoke all on function public.h205f22_aop1_signal_v1" in signal_sql

# Exhausted-run recovery is narrower than general retry.
assert "analyst_role_required" in rearm_sql
assert "exhausted_expired_lease_required" in rearm_sql
assert "active_supervisor_capability_required" in rearm_sql
assert "p_extra_attempts > 3" in rearm_sql
assert "SUPERVISOR_RUN_REARMED" in rearm_sql
assert "EXECUTOR_REPAIR_RETRY" in rearm_sql
assert "authority_effect',false" in rearm_sql
assert "revoke all on function public.h205f22_aop1_supervisor_rearm_exhausted_analyst_v1" in rearm_sql

# Supabase adapter is RPC allowlist-based, not arbitrary SQL.
assert "h205f22_aop1_lease_run_v1" in supabase_ts
assert "h205f22_aop1_complete_run_v1" in supabase_ts
assert "h205f22_aop1_supervisor_adopt_active_claim_v1" in supabase_ts
assert "h205f22_aop1_supervisor_return_authority_v1" in supabase_ts
assert "query" not in supabase_ts.lower() or "sql" not in supabase_ts.lower()

# Historical one-time bootstrap remains hashed, expiring, atomically consumed and client-denied.
assert "compute_fabric_aop_bootstrap_capability_h205f22" in oidc_sql
assert "capability_sha256" in oidc_sql and "extensions.digest" in oidc_sql
assert "for update" in oidc_sql.lower()
assert "bootstrap_capability_consumed" in oidc_sql
assert "set used_at=clock_timestamp()" in oidc_sql
assert "revoke all on function public.h205f22_aop1_consume_bootstrap_bundle_v1" in oidc_sql
assert "to anon, authenticated" in deny_sql and "using (false)" in deny_sql and "with check (false)" in deny_sql

# Reusable delivery exchange: one OIDC JWT -> one exchange; only deploy credentials
# are returned. Runtime/supervisor secrets never cross into the GitHub deploy job.
assert "compute_fabric_aop_deploy_exchange_receipt_h205f22" in deploy_exchange_sql
assert "oidc_jti_sha256" in deploy_exchange_sql and "unique" in deploy_exchange_sql.lower()
assert "oidc_exchange_replay_denied" in deploy_exchange_sql
assert "h205f22_aop1_issue_deploy_bundle_v1" in deploy_exchange_sql
assert "aop1_cloudflare_account_id" in deploy_exchange_sql
assert "aop1_cloudflare_api_token" in deploy_exchange_sql
for forbidden in ("aop1_supabase_service_role", "aop1_supervisor_token", "aop1_wake_secret", "aop1_cloudflare_ai_token"):
    assert forbidden not in deploy_exchange_sql
assert "to service_role" in deploy_exchange_sql
assert "aop_deploy_exchange_receipt_is_append_only" in deploy_exchange_sql

# GitHub switched newly-created repositories to immutable default OIDC subjects on
# 2026-07-15. Trust both immutable numeric identity and explicit repository claims.
for marker in (
    'AUDIENCE = "metaengine-h205f22-aop1-deploy"',
    'repository_id: "1341371143"',
    'repository_owner_id: "20597814"',
    'ref: "refs/heads/work/aop1-autonomous-orchestration"',
    'sub: "repo:PatrickFrome@20597814/Compute@1341371143:ref:refs/heads/work/aop1-autonomous-orchestration"',
    'payload.event_name !== "push"',
    'payload.runner_environment !== "github-hosted"',
    'payload.repository_visibility !== "public"',
    'payload.jti',
    'h205f22_aop1_issue_deploy_bundle_v1',
):
    assert marker in deploy_broker_ts
assert "ONE_TIME_CAPABILITY" not in deploy_broker_ts

# Wrangler declares required Worker runtime secrets. The Vercel inference rail is
# provisioned as a Cloudflare secret before deploy so required-secret validation
# fails closed instead of silently deploying a one-rail runtime.
assert '"secrets"' in wrangler_json and '"required"' in wrangler_json
for secret_name in ("SUPABASE_SERVICE_ROLE_KEY", "AOP_WAKE_SECRET", "AOP_SUPERVISOR_TOKEN", "CF_ACCOUNT_ID", "CF_AI_TOKEN", "VERCEL_AI_GATEWAY_API_KEY"):
    assert secret_name in wrangler_json

# Live deploy uses GitHub OIDC -> deploy-only broker. The Vercel AI Gateway key is
# transiently masked in the deploy job, installed into the Worker secret store, and
# erased from subsequent step environments. Higher-privilege runtime/supervisor
# secrets are never exported through the GitHub runner.
assert "id-token: write" in deploy_yml
assert "ACTIONS_ID_TOKEN_REQUEST_TOKEN" in deploy_yml
assert "ACTIONS_ID_TOKEN_REQUEST_URL" in deploy_yml
assert "audience=metaengine-h205f22-aop1-deploy" in deploy_yml
assert "metaengine-aop1-github-oidc-deploy-h205f22" in deploy_yml
assert "metaengine-aop1-github-oidc-bootstrap-h205f22" not in deploy_yml
assert "workflow_dispatch" not in deploy_yml
assert "::add-mask::" in deploy_yml
assert "wrangler queues info" in deploy_yml and "wrangler queues create" in deploy_yml
assert "cloudflare/wrangler-action@v3" in deploy_yml
assert 'wranglerVersion: "4.125.0"' in deploy_yml
assert "Install Vercel AI Gateway key as Worker secret" in deploy_yml
assert "wrangler secret put VERCEL_AI_GATEWAY_API_KEY" in deploy_yml
assert "Deploy Worker with Vercel duel rail configured" in deploy_yml
assert deploy_yml.index("Install Vercel AI Gateway key as Worker secret") < deploy_yml.index("Deploy Worker with Vercel duel rail configured")
assert "Drop deploy and gateway capabilities from subsequent step environments" in deploy_yml
assert "VERCEL_AI_GATEWAY_API_KEY=\\n" in deploy_yml
assert '/health' in deploy_yml
assert '.duel_vercel_rail_configured == true' in deploy_yml
assert '.snapshot.invariant == "NO_MANUAL_HANDOFF_V1"' in deploy_yml
assert '.github_configured == false' in deploy_yml
assert '.github_auth_mode == "none"' in deploy_yml
assert "LIVE_DEPLOY_ACTIVATION" not in deploy_yml
for forbidden in ("SUPABASE_SERVICE_ROLE_KEY", "AOP_WAKE_SECRET", "AOP_SUPERVISOR_TOKEN", "CF_AI_TOKEN", "GITHUB_APP_PRIVATE_KEY", "GITHUB_APP_INSTALLATION_ID"):
    assert forbidden not in deploy_yml
assert "AOP1_GITHUB_TOKEN" not in deploy_yml

print("AOP1 static contract guards: PASS")
