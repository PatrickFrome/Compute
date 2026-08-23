#!/usr/bin/env python3
"""Fail-closed validator for a Google Compute Engine W1 persistent-host preflight.

This module validates provider READ evidence only. It never performs a reset,
never grants project authority, and never upgrades W1 evidence on its own.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

SCHEMA = "metaengine.compute.w1-gcp-persistent-host-preflight.h205f22.v1"
FREE_TIER_REGIONS = {"us-west1", "us-central1", "us-east1"}
SHA_RE = re.compile(r"^[0-9a-f]{40}$")
WORKER_RE = re.compile(r"^[A-Za-z0-9._:-]{3,160}$")
PROJECT_RE = re.compile(r"^[a-z][a-z0-9-]{4,28}[a-z0-9]$")
ZONE_RE = re.compile(r"^[a-z]+-[a-z0-9]+[0-9]-[a-z]$")
INSTANCE_RE = re.compile(r"^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$")


def _load(path: str) -> dict[str, Any]:
    value = json.loads(Path(path).read_text())
    if not isinstance(value, dict):
        raise ValueError(f"expected JSON object: {path}")
    return value


def _metadata(instance: dict[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    for item in (instance.get("metadata") or {}).get("items") or []:
        if isinstance(item, dict) and isinstance(item.get("key"), str):
            out[item["key"]] = str(item.get("value", ""))
    return out


def _ends(value: Any, suffix: str) -> bool:
    return isinstance(value, str) and value.endswith(suffix)


def _external_ipv4_present(instance: dict[str, Any]) -> bool:
    for nic in instance.get("networkInterfaces") or []:
        if not isinstance(nic, dict):
            continue
        for config in nic.get("accessConfigs") or []:
            if isinstance(config, dict) and (config.get("natIP") or config.get("type") == "ONE_TO_ONE_NAT"):
                return True
    return False


def validate(
    *,
    instance: dict[str, Any],
    disk: dict[str, Any],
    permissions: dict[str, Any],
    project_id: str,
    zone: str,
    instance_name: str,
    worker_id: str,
    expected_w1_sha: str,
) -> dict[str, Any]:
    reasons: list[str] = []

    if not PROJECT_RE.fullmatch(project_id):
        reasons.append("INVALID_PROJECT_ID")
    if not ZONE_RE.fullmatch(zone):
        reasons.append("INVALID_ZONE")
    if not INSTANCE_RE.fullmatch(instance_name):
        reasons.append("INVALID_INSTANCE_NAME")
    if not WORKER_RE.fullmatch(worker_id):
        reasons.append("INVALID_WORKER_ID")
    if not SHA_RE.fullmatch(expected_w1_sha):
        reasons.append("INVALID_W1_SHA")

    region = zone.rsplit("-", 1)[0] if "-" in zone else ""
    if region not in FREE_TIER_REGIONS:
        reasons.append("NOT_GCP_COMPUTE_FREE_TIER_REGION")

    if instance.get("name") != instance_name:
        reasons.append("INSTANCE_NAME_MISMATCH")
    if not _ends(instance.get("zone"), f"/zones/{zone}"):
        reasons.append("INSTANCE_ZONE_MISMATCH")
    if instance.get("status") != "RUNNING":
        reasons.append("INSTANCE_NOT_RUNNING")
    if not _ends(instance.get("machineType"), "/machineTypes/e2-micro"):
        reasons.append("NOT_E2_MICRO")

    scheduling = instance.get("scheduling") or {}
    if scheduling.get("preemptible") is True:
        reasons.append("PREEMPTIBLE_NOT_ALLOWED")
    if scheduling.get("provisioningModel") not in (None, "STANDARD"):
        reasons.append("NON_STANDARD_PROVISIONING_MODEL")
    if instance.get("guestAccelerators"):
        reasons.append("ACCELERATOR_NOT_FREE_TIER")

    metadata = _metadata(instance)
    if metadata.get("metaengine-worker-id") != worker_id:
        reasons.append("WORKER_METADATA_MISMATCH")
    if metadata.get("metaengine-git-sha") != expected_w1_sha:
        reasons.append("GIT_SHA_METADATA_MISMATCH")

    boot = [d for d in instance.get("disks") or [] if isinstance(d, dict) and d.get("boot") is True]
    if len(boot) != 1:
        reasons.append("EXACTLY_ONE_BOOT_DISK_REQUIRED")
    elif not _ends(boot[0].get("source"), f"/disks/{disk.get('name', '')}"):
        reasons.append("BOOT_DISK_SOURCE_MISMATCH")

    if not _ends(disk.get("zone"), f"/zones/{zone}"):
        reasons.append("BOOT_DISK_ZONE_MISMATCH")
    if not _ends(disk.get("type"), "/diskTypes/pd-standard"):
        reasons.append("BOOT_DISK_NOT_PD_STANDARD")
    try:
        size_gb = int(disk.get("sizeGb", 0))
    except (TypeError, ValueError):
        size_gb = 0
    if size_gb <= 0 or size_gb > 30:
        reasons.append("BOOT_DISK_OUTSIDE_FREE_TIER_30GB")

    granted = set(permissions.get("permissions") or [])
    if "compute.instances.reset" not in granted:
        reasons.append("RESET_PERMISSION_NOT_PROVEN")

    external_ipv4 = _external_ipv4_present(instance)
    accepted = not reasons
    return {
        "schema": SCHEMA,
        "provider": "gcp-compute-engine",
        "accepted": accepted,
        "reasons": reasons,
        "project_id": project_id,
        "zone": zone,
        "instance_name": instance_name,
        "worker_id": worker_id,
        "expected_w1_sha": expected_w1_sha,
        "machine_type": "e2-micro" if _ends(instance.get("machineType"), "/machineTypes/e2-micro") else None,
        "boot_disk_type": "pd-standard" if _ends(disk.get("type"), "/diskTypes/pd-standard") else None,
        "boot_disk_size_gb": size_gb,
        "free_tier_compute_eligible_shape": accepted,
        "external_ipv4_present": external_ipv4,
        "strict_zero_cost_networking": not external_ipv4,
        "reset_permission_proven": "compute.instances.reset" in granted,
        "reset_performed": False,
        "persistent_worker_proof": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--instance", required=True)
    p.add_argument("--disk", required=True)
    p.add_argument("--permissions", required=True)
    p.add_argument("--project-id", required=True)
    p.add_argument("--zone", required=True)
    p.add_argument("--instance-name", required=True)
    p.add_argument("--worker-id", required=True)
    p.add_argument("--expected-w1-sha", required=True)
    p.add_argument("--output", required=True)
    args = p.parse_args()

    result = validate(
        instance=_load(args.instance),
        disk=_load(args.disk),
        permissions=_load(args.permissions),
        project_id=args.project_id,
        zone=args.zone,
        instance_name=args.instance_name,
        worker_id=args.worker_id,
        expected_w1_sha=args.expected_w1_sha,
    )
    Path(args.output).write_text(json.dumps(result, sort_keys=True, separators=(",", ":")) + "\n")
    if not result["accepted"]:
        raise SystemExit("gcp_preflight_rejected:" + ",".join(result["reasons"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
