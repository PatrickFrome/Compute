from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20260821060500_aop1_clean_replay.sql"
CF = ROOT / "orchestration/cloudflare/src"

sql = MIGRATION.read_text(encoding="utf-8")
index_ts = (CF / "index.ts").read_text(encoding="utf-8")
executor_ts = (CF / "executor.ts").read_text(encoding="utf-8")
github_ts = (CF / "github.ts").read_text(encoding="utf-8")
supabase_ts = (CF / "supabase.ts").read_text(encoding="utf-8")

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

# Supabase adapter is RPC allowlist-based, not arbitrary SQL.
assert "h205f22_aop1_lease_run_v1" in supabase_ts
assert "h205f22_aop1_complete_run_v1" in supabase_ts
assert "h205f22_aop1_supervisor_adopt_active_claim_v1" in supabase_ts
assert "h205f22_aop1_supervisor_return_authority_v1" in supabase_ts
assert "query" not in supabase_ts.lower() or "sql" not in supabase_ts.lower()

print("AOP1 static contract guards: PASS")
