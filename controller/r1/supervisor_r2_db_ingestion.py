#!/usr/bin/env python3
"""STEP09B thin Supervisor runner for postgres-only continuity ingestion.

Trust zone: database only. This runner accepts a STEP08 package/receipt and the
production STEP09A authority-gate receipt, rejects provider/GitHub credentials,
then invokes the postgres-only SECURITY INVOKER ingestion function through psql.
It does not fetch provider bytes, run GitHub verification, create seals, or promote
canonical roadmap state.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Mapping

from controller.r1.supervisor_r2_ingestion_authority_gate import (
    AUTHORITY_GATE_CLASSIFICATION,
    AUTHORITY_GATE_SCHEMA,
)
from controller.r1.supervisor_r2_ingestion_gate import _canonical, _load_package, _sha_json

DB_RESULT_SCHEMA = "metaengine.compute.r1-step09b-db-ingestion-result.h205f22.v1"
DB_RESULT_CLASSIFICATION = "DATABASE_DERIVED_TWO_DOMAIN_READBACK_QUORUM"
PROJECTION_PATH = "meta/r1-final-r2-db-ingestion-projection.json"
ROOT_CONTEXT_MAX_AGE = timedelta(minutes=15)
PSQL_TIMEOUT_SECONDS = 120
SHA256 = re.compile(r"^[0-9a-f]{64}$")

FORBIDDEN_CREDENTIAL_ENV = (
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
    "AWS_WEB_IDENTITY_TOKEN_FILE",
    "B2_APPLICATION_KEY_ID",
    "B2_APPLICATION_KEY",
    "B2_ACCOUNT_ID",
)
DB_ENV_ALLOWLIST = (
    "PGHOST",
    "PGHOSTADDR",
    "PGPORT",
    "PGDATABASE",
    "PGUSER",
    "PGPASSWORD",
    "PGSSLMODE",
    "PGSSLROOTCERT",
    "PGSSLCERT",
    "PGSSLKEY",
    "PGCHANNELBINDING",
    "PGCONNECT_TIMEOUT",
    "PGTARGETSESSIONATTRS",
)


class DBIngestionError(RuntimeError):
    pass


def _read_json(path: Path, label: str) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise DBIngestionError(f"{label}_invalid_json") from exc


def _parse_time(value: Any, field: str) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise DBIngestionError(f"{field}_missing")
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise DBIngestionError(f"{field}_invalid") from exc
    if dt.tzinfo is None:
        raise DBIngestionError(f"{field}_timezone_required")
    return dt.astimezone(timezone.utc)


def _verify_authority_gate(value: Any, *, package_sha: str, projection_sha: str, now: datetime) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schema") != AUTHORITY_GATE_SCHEMA or value.get("classification") != AUTHORITY_GATE_CLASSIFICATION:
        raise DBIngestionError("authority_gate_identity_invalid")
    claimed = value.get("authority_gate_receipt_sha256")
    if not isinstance(claimed, str) or SHA256.fullmatch(claimed) is None:
        raise DBIngestionError("authority_gate_receipt_sha256_invalid")
    core = dict(value)
    core.pop("authority_gate_receipt_sha256", None)
    if _sha_json(core) != claimed:
        raise DBIngestionError("authority_gate_receipt_sha256_mismatch")
    if value.get("package_sha256") != package_sha or value.get("db_projection_sha256") != projection_sha:
        raise DBIngestionError("authority_gate_package_or_projection_mismatch")
    if value.get("step09b_ingestion_eligible") is not True:
        raise DBIngestionError("authority_gate_not_step09b_eligible")
    if any(value.get(k) is not False for k in (
        "database_credential_present", "database_write_performed", "provider_credential_present",
        "provider_call_performed", "canonical", "authority_effect", "r2_proven", "r3_proven",
        "persisted_seal_allowed",
    )):
        raise DBIngestionError("authority_gate_boundary_invalid")
    verify = value.get("gh_attestation_verification")
    if not isinstance(verify, dict) or verify.get("executed_by_this_gate") is not True or verify.get("offline_bundle_used") is not True or verify.get("custom_fresh_trusted_root_used") is not True or verify.get("result_count") != 1:
        raise DBIngestionError("authority_gate_verification_boundary_invalid")
    root = value.get("trusted_root")
    if not isinstance(root, dict) or root.get("online_fetch_required") is not True:
        raise DBIngestionError("authority_gate_trusted_root_boundary_invalid")
    acquired = _parse_time(root.get("acquired_at"), "trusted_root_acquired_at")
    if acquired > now or now - acquired > ROOT_CONTEXT_MAX_AGE:
        raise DBIngestionError("authority_gate_trusted_root_stale_before_db_call")
    return value


def _check_trust_zone(env: Mapping[str, str]) -> dict[str, str]:
    present = sorted(key for key in FORBIDDEN_CREDENTIAL_ENV if env.get(key))
    if present:
        raise DBIngestionError("forbidden_non_database_credentials_present:" + ",".join(present))
    missing = [key for key in ("PGHOST", "PGDATABASE", "PGUSER") if not env.get(key)]
    if missing:
        raise DBIngestionError("required_libpq_environment_missing:" + ",".join(missing))
    child = {key: env[key] for key in DB_ENV_ALLOWLIST if env.get(key)}
    if env.get("PATH"):
        child["PATH"] = env["PATH"]
    child["PGAPPNAME"] = "metaengine-r1-step09b"
    return child


def build_sql(projection: dict[str, Any], gate: dict[str, Any]) -> str:
    p64 = base64.b64encode(_canonical(projection)).decode("ascii")
    g64 = base64.b64encode(_canonical(gate)).decode("ascii")
    return (
        "select destruktion_meta.compute_ingest_r2_projection_h205f22("
        f"convert_from(decode('{p64}','base64'),'utf8')::jsonb,"
        f"convert_from(decode('{g64}','base64'),'utf8')::jsonb)::text;"
    )


def _run_psql(command: list[str], child_env: dict[str, str]) -> str:
    try:
        proc = subprocess.run(
            command,
            env=child_env,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            check=True,
            timeout=PSQL_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise DBIngestionError("psql_ingestion_failed") from exc
    if not proc.stdout.strip():
        raise DBIngestionError("psql_ingestion_empty_output")
    return proc.stdout


def _validate_db_result(value: Any, *, projection_sha: str, gate_sha: str) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schema") != DB_RESULT_SCHEMA or value.get("classification") != DB_RESULT_CLASSIFICATION:
        raise DBIngestionError("db_result_identity_invalid")
    if value.get("projection_sha256") != projection_sha or value.get("authority_gate_receipt_sha256") != gate_sha:
        raise DBIngestionError("db_result_input_binding_mismatch")
    if value.get("database_transaction_validated") is not True:
        raise DBIngestionError("db_result_transaction_not_validated")
    if not isinstance(value.get("database_write_performed"), bool):
        raise DBIngestionError("db_result_write_flag_invalid")
    if value.get("continuity_readiness_r2_proven") is not True:
        raise DBIngestionError("db_result_r2_not_derived")
    readiness = value.get("continuity_readiness")
    audit = value.get("continuity_audit")
    if not isinstance(readiness, dict) or readiness.get("r2_proven") is not True:
        raise DBIngestionError("db_result_readiness_invalid")
    if not isinstance(audit, dict) or audit.get("status") != "PASS":
        raise DBIngestionError("db_result_audit_invalid")
    if value.get("canonical_roadmap_r2_promoted") is not False or value.get("r3_proven") is not False or value.get("persisted_seal_created") is not False:
        raise DBIngestionError("db_result_authority_scope_invalid")
    return value


def invoke_ingestion(
    *,
    package_path: Path,
    package_receipt_path: Path,
    authority_gate_path: Path,
    psql_bin: str = "psql",
    env: Mapping[str, str] | None = None,
    runner: Callable[[list[str], dict[str, str]], str] = _run_psql,
    now: datetime | None = None,
) -> dict[str, Any]:
    entries, package_receipt, _manifest, projection = _load_package(package_path, package_receipt_path)
    if PROJECTION_PATH not in entries:
        raise DBIngestionError("step08_projection_missing")
    authority = _read_json(authority_gate_path, "authority_gate")
    observed = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    authority = _verify_authority_gate(
        authority,
        package_sha=package_receipt["package_sha256"],
        projection_sha=projection["projection_sha256"],
        now=observed,
    )
    child_env = _check_trust_zone(env or os.environ)
    sql = build_sql(projection, authority)
    command = [
        psql_bin,
        "-X",
        "--no-psqlrc",
        "--set=ON_ERROR_STOP=1",
        "--tuples-only",
        "--no-align",
        "--quiet",
        "--command",
        sql,
    ]
    raw = runner(command, child_env)
    lines = [line.strip() for line in raw.splitlines() if line.strip()]
    if len(lines) != 1:
        raise DBIngestionError("psql_result_line_count_invalid")
    try:
        result = json.loads(lines[0])
    except json.JSONDecodeError as exc:
        raise DBIngestionError("psql_result_invalid_json") from exc
    return _validate_db_result(
        result,
        projection_sha=projection["projection_sha256"],
        gate_sha=authority["authority_gate_receipt_sha256"],
    )


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--package", required=True)
    p.add_argument("--package-receipt", required=True)
    p.add_argument("--authority-gate", required=True)
    p.add_argument("--psql-bin", default="psql")
    p.add_argument("--output", required=True)
    a = p.parse_args(argv)
    try:
        result = invoke_ingestion(
            package_path=Path(a.package),
            package_receipt_path=Path(a.package_receipt),
            authority_gate_path=Path(a.authority_gate),
            psql_bin=a.psql_bin,
        )
        Path(a.output).write_bytes(_canonical(result) + b"\n")
        return 0
    except DBIngestionError as exc:
        print(f"R1_STEP09B_DB_INGESTION_REJECTED:{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
