from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (
    ROOT
    / "supabase/migrations/20260902103500_devos_result_ready_expiry_fence_v1.sql"
).read_text(encoding="utf-8")


def test_reconcile_fences_all_expirable_nonterminal_lease_states():
    assert "t.state in ('LEASED','RUNNING','RESULT_READY','BLOCKED')" in MIGRATION
    assert "LEASE_EXPIRED_RESULT_UNADOPTED" in MIGRATION
    assert "LEASE_EXPIRED_BLOCKED_UNRESOLVED" in MIGRATION
    assert "set state = 'AMBIGUOUS'" in MIGRATION


def test_reconcile_never_turns_expiry_into_automatic_work_retry():
    assert "'requeued_tasks', 0" in MIGRATION
    assert "'automatic_retry_allowed', false" in MIGRATION
    assert "'authority_effect', false" in MIGRATION


def test_watchdog_discovers_result_ready_and_blocked_expiry_without_second_scheduler():
    assert MIGRATION.count("t.state in ('LEASED','RUNNING','RESULT_READY','BLOCKED')") >= 2
    assert "'scheduler_source','NONE_RECOVERY_ONLY'" in MIGRATION
    assert "'leases_ready_work',false" in MIGRATION


def test_result_evidence_is_preserved_when_expired_result_ready_is_fenced():
    assert "'result_sha256', v_task.result_sha256" in MIGRATION
