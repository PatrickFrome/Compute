from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FUNCTION_DDL = ROOT / "coordination/read-plane/read-barrier-migration.sql"
ACL_MIGRATION = (
    ROOT
    / "supabase/migrations/20260824143000_coordination_read_barrier_acl_v2.sql"
)


def _normalized(path: Path) -> str:
    return " ".join(path.read_text(encoding="utf-8").lower().split())


def _assert_service_role_only(sql: str) -> None:
    signature = "public.coordination_read_barrier_h205f22()"
    assert f"revoke execute on function {signature}" in sql
    assert "from public, anon, authenticated" in sql
    assert f"grant execute on function {signature}" in sql
    assert "to service_role" in sql
    assert f"to authenticated, service_role" not in sql


def test_function_definition_revokes_default_and_client_execution() -> None:
    _assert_service_role_only(_normalized(FUNCTION_DDL))


def test_live_acl_migration_is_idempotent_and_service_role_only() -> None:
    _assert_service_role_only(_normalized(ACL_MIGRATION))


def test_acl_migration_is_narrowly_scoped() -> None:
    sql = _normalized(ACL_MIGRATION)
    assert "create " not in sql
    assert "drop " not in sql
    assert "alter " not in sql
    assert "insert " not in sql
    assert "update " not in sql
    assert "delete " not in sql
