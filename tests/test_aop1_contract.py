from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20260821060500_aop1_clean_replay.sql"
OIDC_MIGRATION = ROOT / "supabase/migrations/20260821071452_aop1_one_time_github_oidc_bootstrap_capability.sql"
DENY_MIGRATION = ROOT / "supabase/migrations/20260821072003_aop1_bootstrap_capability_explicit_deny_policy.sql"
CF = ROOT / "orchestration/cloudflare/src"
LIVE_DEPLOY = ROOT / ".github/workflows/aop1-live-deploy.yml"

sql = MIGRATION.read_text(encoding="utf-8")
oidc_sql = OIDC_MIGRATION.read_text(encoding="utf-8")
deny_sql = DENY_MIGRATION.read_text(encoding="utf-8")
index_ts = (CF / "index.ts").read_text(encoding="utf-8")
executor_ts = (CF / "executor.ts").read_text(encoding="utf-8")
github_ts = (CF / "github.ts").read_text(encoding="utf-8")
supabase_ts = (CF / "supabase.ts").read_text(encoding="utf-8")
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
assert "GITHUB_TOKEN_MISSING" in executor_ts
assert "main_branch_write_forbidden" in github_ts
assert "invalid_repo_path" in github_ts
assert "github_pull_request_files" in executor_ts
assert "github_read_file_ref" in executor_ts
assert "supervisor_tool_forbidden" in executor_ts
assert "Checkpoint seal and main merge are intentionally not exposed" in executor_ts
assert "JSON.stringify(await leaseRun" in index_ts
assert "JSON.stringify(await executeRole" in index_ts

# Public GitHub reads are tokenless, but every mutation and every write tool remain fenced.
assert 'const mutation = method !== "GET" && method !== "HEAD"' in github_ts
assert "github_token_required_for_mutation" in github_ts
assert 'lease.role_kind === "IMPLEMENTER" && !env.GITHUB_TOKEN' in executor_ts
assert 'if (lease.role_kind === "IMPLEMENTER")' in executor_ts
assert "github_write_tool_forbidden_for_role" in executor_ts
assert "Analyst is strictly read-only in GitHub tools" in executor_ts

# Responses tool loop must remain stateless when store=false. Cloudflare GPT-OSS rejects
# previous_response_id for non-stored responses; carry the full transcript explicitly.
assert "previous_response_id" not in executor_ts
assert "const transcript: Array<Record<string, unknown>>" in executor_ts
assert "transcript.push(...responseItems(response), ...outputs)" in executor_ts
assert "instructions, input: transcript" in executor_ts
assert "model_transcript_limit_exceeded" in executor_ts
assert "MAX_TRANSCRIPT_BYTES" in executor_ts
# GPT-OSS may decorate read-only tool names with a channel sentinel. Only ANALYST
# read-only names may be normalized; write/supervisor tools must never be normalized.
assert "canonicalReadOnlyToolName" in executor_ts
assert 'lease.role_kind !== "ANALYST"' in executor_ts
assert "READ_ONLY_TOOL_NAMES" in executor_ts
assert '"github_write_file"' not in executor_ts.split("const READ_ONLY_TOOL_NAMES", 1)[1].split("]);", 1)[0]
assert '"supervisor_return_authority"' not in executor_ts.split("const READ_ONLY_TOOL_NAMES", 1)[1].split("]);", 1)[0]

# Supabase adapter is RPC allowlist-based, not arbitrary SQL.
assert "h205f22_aop1_lease_run_v1" in supabase_ts
assert "h205f22_aop1_complete_run_v1" in supabase_ts
assert "h205f22_aop1_supervisor_adopt_active_claim_v1" in supabase_ts
assert "h205f22_aop1_supervisor_return_authority_v1" in supabase_ts
assert "query" not in supabase_ts.lower() or "sql" not in supabase_ts.lower()

# One-time bootstrap is hashed, expiring, atomically consumed, and client-denied.
assert "compute_fabric_aop_bootstrap_capability_h205f22" in oidc_sql
assert "capability_sha256" in oidc_sql and "extensions.digest" in oidc_sql
assert "for update" in oidc_sql.lower()
assert "bootstrap_capability_consumed" in oidc_sql
assert "set used_at=clock_timestamp()" in oidc_sql
assert "revoke all on function public.h205f22_aop1_consume_bootstrap_bundle_v1" in oidc_sql
assert "to anon, authenticated" in deny_sql and "using (false)" in deny_sql and "with check (false)" in deny_sql

# Live bootstrap must use GitHub OIDC, not repository secrets, then health-gate activation.
assert "id-token: write" in deploy_yml
assert "ACTIONS_ID_TOKEN_REQUEST_TOKEN" in deploy_yml
assert "ACTIONS_ID_TOKEN_REQUEST_URL" in deploy_yml
assert "audience=metaengine-h205f22-aop1" in deploy_yml
assert "metaengine-aop1-github-oidc-bootstrap-h205f22" in deploy_yml
assert "::add-mask::" in deploy_yml
assert "wrangler queues info" in deploy_yml and "wrangler queues create" in deploy_yml
assert "cloudflare/wrangler-action@v3" in deploy_yml
assert 'wranglerVersion: "4.125.0"' in deploy_yml
assert '/health' in deploy_yml
assert '.snapshot.invariant == "NO_MANUAL_HANDOFF_V1"' in deploy_yml
assert '.github_configured == false' in deploy_yml
assert "BLOCKED_MISSING_DEDICATED_RUNTIME_CREDENTIAL" in deploy_yml
assert "LIVE_DEPLOY_ACTIVATION" in deploy_yml
assert deploy_yml.index('/health') < deploy_yml.index('LIVE_DEPLOY_ACTIVATION')
# No long-lived GitHub runtime credential is smuggled through the bootstrap job.
assert "AOP1_GITHUB_TOKEN" not in deploy_yml
assert "GITHUB_TOKEN\n" not in deploy_yml

print("AOP1 static contract guards: PASS")
