from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20260821060500_aop1_clean_replay.sql"
CF = ROOT / "orchestration/cloudflare/src"
LIVE_DEPLOY = ROOT / ".github/workflows/aop1-live-deploy.yml"

sql = MIGRATION.read_text(encoding="utf-8")
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
assert "main_branch_write_forbidden" in github_ts
assert "invalid_repo_path" in github_ts
assert "github_pull_request_files" in executor_ts
assert "github_read_file_ref" in executor_ts
assert "supervisor_tool_forbidden" in executor_ts
assert "Checkpoint seal and main merge are intentionally not exposed" in executor_ts
assert "JSON.stringify(await leaseRun" in index_ts
assert "JSON.stringify(await executeRole" in index_ts

# Supabase adapter is RPC allowlist-based, not arbitrary SQL.
assert "h205f22_aop1_lease_run_v1" in supabase_ts
assert "h205f22_aop1_complete_run_v1" in supabase_ts
assert "h205f22_aop1_supervisor_adopt_active_claim_v1" in supabase_ts
assert "h205f22_aop1_supervisor_return_authority_v1" in supabase_ts
assert "query" not in supabase_ts.lower() or "sql" not in supabase_ts.lower()

# Live deploy must be capability-gated, fail closed, health-gated, then activate.
required_deploy_secrets = (
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "AOP1_SUPABASE_SERVICE_ROLE_KEY",
    "AOP1_SUPERVISOR_TOKEN",
    "AOP1_GITHUB_TOKEN",
    "AOP1_CF_AI_TOKEN",
    "AOP1_WAKE_SECRET",
)
for secret in required_deploy_secrets:
    assert secret in deploy_yml
assert "configured=false" in deploy_yml
assert "steps.capability.outputs.configured == 'true'" in deploy_yml
assert "wrangler queues info" in deploy_yml and "wrangler queues create" in deploy_yml
assert "cloudflare/wrangler-action@v3" in deploy_yml
assert 'wranglerVersion: "4.125.0"' in deploy_yml
assert '/health' in deploy_yml
assert '.snapshot.invariant == "NO_MANUAL_HANDOFF_V1"' in deploy_yml
assert "LIVE_DEPLOY_ACTIVATION" in deploy_yml
assert deploy_yml.index('/health') < deploy_yml.index('LIVE_DEPLOY_ACTIVATION')
assert "NOT_LIVE_DEPLOYED" in deploy_yml

print("AOP1 static contract guards: PASS")
