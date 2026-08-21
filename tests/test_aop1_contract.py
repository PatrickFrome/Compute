from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20260821060500_aop1_clean_replay.sql"
OIDC_MIGRATION = ROOT / "supabase/migrations/20260821071452_aop1_one_time_github_oidc_bootstrap_capability.sql"
DENY_MIGRATION = ROOT / "supabase/migrations/20260821072003_aop1_bootstrap_capability_explicit_deny_policy.sql"
REARM_MIGRATION = ROOT / "supabase/migrations/20260821080306_aop1_supervisor_rearm_exhausted_analyst.sql"
SIGNAL_MIGRATION = ROOT / "supabase/migrations/20260821082219_aop1_signal_resume_payload_v2.sql"
STALE_RUN_MIGRATION = ROOT / "supabase/migrations/20260821102500_aop1_stale_run_fencing_v1.sql"
CF = ROOT / "orchestration/cloudflare/src"
LIVE_DEPLOY = ROOT / ".github/workflows/aop1-live-deploy.yml"

sql = MIGRATION.read_text(encoding="utf-8")
oidc_sql = OIDC_MIGRATION.read_text(encoding="utf-8")
deny_sql = DENY_MIGRATION.read_text(encoding="utf-8")
rearm_sql = REARM_MIGRATION.read_text(encoding="utf-8")
signal_sql = SIGNAL_MIGRATION.read_text(encoding="utf-8")
stale_sql = STALE_RUN_MIGRATION.read_text(encoding="utf-8")
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

# GitHub App authentication must mint short-lived installation tokens instead of
# persisting a generated token. GitHub requires RS256 JWT; repository scope is explicit.
assert 'GITHUB_APP_CLIENT_ID' in (CF / "types.ts").read_text(encoding="utf-8")
assert 'GITHUB_APP_INSTALLATION_ID' in (CF / "types.ts").read_text(encoding="utf-8")
assert 'GITHUB_APP_PRIVATE_KEY' in (CF / "types.ts").read_text(encoding="utf-8")
assert 'RSASSA-PKCS1-v1_5' in github_ts
assert 'iat: now - 60' in github_ts
assert 'exp: now + 540' in github_ts
assert '/app/installations/${installationId}/access_tokens' in github_ts
assert 'repositories: [REPO_NAME]' in github_ts
assert 'BEGIN RSA PRIVATE KEY' in github_ts and 'BEGIN PRIVATE KEY' in github_ts
assert 'wrapPkcs1AsPkcs8' in github_ts
assert 'body.token' in github_ts and 'body.expires_at' in github_ts
assert 'return body.token' in github_ts

# Stale execution objects are terminally fenced before any wake can re-enable them.
assert "compute_fabric_aop_run_wake_status_h205f22" in stale_sql
assert "STALE_SEMANTIC_HEAD" in stale_sql
assert "ORPHANED_OR_EXPIRED_CLAIM" in stale_sql
assert "ROADMAP_NOT_IN_PROGRESS" in stale_sql
assert "ROADMAP_NOT_EVIDENCE_READY" in stale_sql
assert "RUN_FENCED" in stale_sql
assert "base_checkpoint_id is distinct from v_head" in stale_sql
assert "c.claim_id=r.claim_id" in stale_sql
assert "c.base_checkpoint_id=v_head" in stale_sql
assert "perform destruktion_meta.compute_fabric_aop_reconcile_h205f22()" in stale_sql
assert stale_sql.count("stale_or_orphan_runs_fail_closed") >= 4
assert "resume_payload_attached',false" in stale_sql
assert "state='FENCED'" in stale_sql
assert "revoke all on function destruktion_meta.compute_fabric_aop_run_wake_status_h205f22" in stale_sql

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

# Resume semantics: waking a WAITING_EVENT run must attach the evidence payload to
# the next lease input, not merely emit an event the executor cannot see.
assert "resume_signal" in signal_sql
assert "input=coalesce(input,'{}'::jsonb) || jsonb_build_object" in signal_sql
assert "resume_payload_attached" in signal_sql
assert "signal_payload_must_be_object" in signal_sql
assert "signal_payload_too_large" in signal_sql
assert "65536" in signal_sql
assert "authority_effect',false" in signal_sql
assert "revoke all on function public.h205f22_aop1_signal_v1" in signal_sql

# Exhausted-run recovery is deliberately narrower than general retry: only an
# expired, nonterminal ANALYST lease with an active supervisor capability may rearm.
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

# One-time bootstrap is hashed, expiring, atomically consumed, and client-denied.
assert "compute_fabric_aop_bootstrap_capability_h205f22" in oidc_sql
assert "capability_sha256" in oidc_sql and "extensions.digest" in oidc_sql
assert "for update" in oidc_sql.lower()
assert "bootstrap_capability_consumed" in oidc_sql
assert "set used_at=clock_timestamp()" in oidc_sql
assert "revoke all on function public.h205f22_aop1_consume_bootstrap_bundle_v1" in oidc_sql
assert "to anon, authenticated" in deny_sql and "using (false)" in deny_sql and "with check (false)" in deny_sql

# Live bootstrap still uses GitHub OIDC, not repository secrets, then health-gates activation.
# App auth is CODE_READY only in this change: the existing one-time bootstrap bundle does not
# contain GitHub App private material, so the current live deployment must continue to report
# github_configured=false until an explicit dedicated runtime credential is provisioned.
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
# No long-lived GitHub runtime credential or App private key is smuggled through the
# already-consumed bootstrap job. Provisioning App credentials is a separate future gate.
assert "AOP1_GITHUB_TOKEN" not in deploy_yml
assert "GITHUB_TOKEN\n" not in deploy_yml
assert "GITHUB_APP_PRIVATE_KEY" not in deploy_yml
assert "GITHUB_APP_INSTALLATION_ID" not in deploy_yml

print("AOP1 static contract guards: PASS")
