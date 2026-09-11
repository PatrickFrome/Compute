from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (
    ROOT / "supabase/migrations/20260902205500_supervisor_mesh_terminal_freshness_v1.sql"
).read_text(encoding="utf-8")


class SupervisorMeshTerminalFreshnessContract(unittest.TestCase):
    def test_terminal_mesh_rows_do_not_refresh_liveness(self):
        lower = MIGRATION.lower()
        self.assertIn("h205f22_a2_supervisor_mesh_heartbeat_v1", lower)
        self.assertIn("h205f22_a2_supervisor_mesh_sync_v1", lower)
        self.assertIn("then s.last_seen_at", lower)
        self.assertIn(
            "then compute_fabric_a2_supervisor_mesh_instance_h205f22.last_seen_at",
            lower,
        )
        self.assertIn("coalesce(s.retired_at,clock_timestamp())", lower)
        self.assertIn(
            "coalesce(compute_fabric_a2_supervisor_mesh_instance_h205f22.retired_at,clock_timestamp())",
            lower,
        )
        self.assertIn("terminal_freshness_preserved", lower)

    def test_preferred_supervisor_must_be_live_in_same_snapshot(self):
        lower = MIGRATION.lower()
        self.assertIn("supervisor_mesh_sync_preferred_not_live", lower)
        self.assertIn("in ('active','paused')", lower)

    def test_watchdog_expires_stale_actuation_lease_without_replay(self):
        lower = MIGRATION.lower()
        self.assertIn("actuation_leases_expired", lower)
        self.assertIn("where status='active'", lower)
        self.assertIn("expires_at <= clock_timestamp()", lower)
        self.assertIn("leases_ready_work',false", lower)
        self.assertIn("automatic_retry_allowed',false", lower)
        self.assertIn("authority_effect',false", lower)
        self.assertNotIn(
            "delete from public.compute_fabric_a2_supervisor_mesh_instance_h205f22",
            lower,
        )
        self.assertNotIn(
            "insert into public.compute_fabric_a2_supervisor_actuation_lease_h205f22",
            lower,
        )
        self.assertNotIn(
            "insert into public.compute_fabric_a2_browser_supervisor_command_h205f22",
            lower,
        )


if __name__ == "__main__":
    unittest.main()
