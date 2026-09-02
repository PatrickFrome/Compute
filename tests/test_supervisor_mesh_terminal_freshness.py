from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (
    ROOT / "supabase/migrations/20260902205500_supervisor_mesh_terminal_freshness_v1.sql"
).read_text(encoding="utf-8")


def test_terminal_mesh_rows_do_not_refresh_liveness():
    lower = MIGRATION.lower()
    assert "h205f22_a2_supervisor_mesh_heartbeat_v1" in MIGRATION
    assert "h205f22_a2_supervisor_mesh_sync_v1" in MIGRATION
    assert "then s.last_seen_at" in lower
    assert "then compute_fabric_a2_supervisor_mesh_instance_h205f22.last_seen_at" in lower
    assert "coalesce(s.retired_at,clock_timestamp())" in lower
    assert "coalesce(compute_fabric_a2_supervisor_mesh_instance_h205f22.retired_at,clock_timestamp())" in lower
    assert "terminal_freshness_preserved" in lower


def test_preferred_supervisor_must_be_live_in_same_snapshot():
    lower = MIGRATION.lower()
    assert "supervisor_mesh_sync_preferred_not_live" in lower
    assert "in ('active','paused')" in lower


def test_watchdog_expires_stale_actuation_lease_without_replay():
    lower = MIGRATION.lower()
    assert "actuation_leases_expired" in lower
    assert "where status='active'" in lower
    assert "expires_at <= clock_timestamp()" in lower
    assert "leases_ready_work',false" in lower
    assert "automatic_retry_allowed',false" in lower
    assert "authority_effect',false" in lower
    assert "delete from public.compute_fabric_a2_supervisor_mesh_instance_h205f22" not in lower
