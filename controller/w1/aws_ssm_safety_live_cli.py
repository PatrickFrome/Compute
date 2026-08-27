#!/usr/bin/env python3
"""Reviewed file-oriented CLI for the W1 live SSM safety provisioning workflow.

The CLI contains validation/composition only. It never imports an AWS SDK,
executes `aws`, performs network I/O, mutates a provider, reboots a host, or
writes to Supabase. GitHub Actions owns provider transport and supplies captured
JSON files to these subcommands.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
from typing import Any

from controller.w1 import aws_ssm_safety_provision_guard as transport
from controller.w1 import aws_ssm_safety_provision_provenance as provenance
from controller.w1 import aws_ssm_safety_send_semantics_guard as strict


def _read(path: str) -> Any:
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"invalid_json:{path}") from exc


def _write(path: str, value: Any) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n", encoding="utf-8")


def validate_remote(args: argparse.Namespace) -> None:
    transport.validate_managed_node(_read(args.managed_node), expected_instance_id=args.instance_id)
    remote = transport.validate_remote_document(
        description=_read(args.description),
        get_document=_read(args.get_document),
        account_id=args.account_id,
    )
    plan = transport.build_command_plan(
        instance_id=args.instance_id,
        aws_document_sha256=remote["aws_document_sha256"],
    )
    _write(args.remote_output, remote)
    _write(args.plan_output, plan)


def validate_send(args: argparse.Namespace) -> None:
    result = strict.validate_send_command_response_strict(_read(args.response), plan=_read(args.plan))
    _write(args.output, result)


def validate_invocation(args: argparse.Namespace) -> None:
    value = provenance.validate_strict_command_invocation(
        _read(args.invocation),
        command_id=args.command_id,
        instance_id=args.instance_id,
    )
    _write(args.output, value)


def check_cloudtrail(args: argparse.Namespace) -> None:
    remote = transport.validate_remote_document(
        description=_read(args.description),
        get_document=_read(args.get_document),
        account_id=args.account_id,
    )
    metadata = _read(args.metadata)
    selected = strict.select_strict_send_command_event(
        _read(args.lookup),
        instance_id=args.instance_id,
        account_id=args.account_id,
        region=args.region,
        provisioner_role_arn=metadata.get("provisioner_role_arn"),
        role_session=metadata.get("role_session"),
        requested_at=metadata.get("requested_at"),
        api_returned_at=metadata.get("api_returned_at"),
        aws_document_sha256=remote["aws_document_sha256"],
    )
    _write(args.output, selected["summary"])


def compose(args: argparse.Namespace) -> None:
    metadata = _read(args.metadata)
    result = strict.compose_strict_provisioning_provenance(
        cloudtrail_lookup=_read(args.cloudtrail),
        instance_id=args.instance_id,
        worker_id=args.worker_id,
        account_id=args.account_id,
        region=args.region,
        provisioner_role_arn=metadata.get("provisioner_role_arn"),
        role_session=metadata.get("role_session"),
        requested_at=metadata.get("requested_at"),
        api_returned_at=metadata.get("api_returned_at"),
        verifier_caller_identity=_read(args.verifier_caller),
        preflight_bundle=_read(args.preflight_bundle),
        managed_node_response=_read(args.managed_node),
        document_description=_read(args.description),
        get_document_response=_read(args.get_document),
        command_invocation=_read(args.invocation),
        verified_iid=_read(args.verified_iid),
    )
    required_false = (
        "capture_executed",
        "host_safety_verified",
        "reboot_completion_proven",
        "persistent_worker_proof",
        "worker_admitted",
        "w1_verified",
        "database_mutation",
        "canonical",
        "authority_effect",
    )
    if result.get("package_provisioning_verified") is not True:
        raise RuntimeError("package_provisioning_not_verified")
    if result.get("strict_send_command_semantics_verified") is not True:
        raise RuntimeError("strict_send_semantics_not_verified")
    for key in required_false:
        if result.get(key) is not False:
            raise RuntimeError(f"downstream_authority_nonclaim_failed:{key}")
    _write(args.output, result)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("validate-remote")
    p.add_argument("--managed-node", required=True)
    p.add_argument("--description", required=True)
    p.add_argument("--get-document", required=True)
    p.add_argument("--instance-id", required=True)
    p.add_argument("--account-id", required=True)
    p.add_argument("--remote-output", required=True)
    p.add_argument("--plan-output", required=True)
    p.set_defaults(handler=validate_remote)

    p = sub.add_parser("validate-send")
    p.add_argument("--response", required=True)
    p.add_argument("--plan", required=True)
    p.add_argument("--output", required=True)
    p.set_defaults(handler=validate_send)

    p = sub.add_parser("validate-invocation")
    p.add_argument("--invocation", required=True)
    p.add_argument("--command-id", required=True)
    p.add_argument("--instance-id", required=True)
    p.add_argument("--output", required=True)
    p.set_defaults(handler=validate_invocation)

    p = sub.add_parser("check-cloudtrail")
    p.add_argument("--lookup", required=True)
    p.add_argument("--description", required=True)
    p.add_argument("--get-document", required=True)
    p.add_argument("--metadata", required=True)
    p.add_argument("--instance-id", required=True)
    p.add_argument("--account-id", required=True)
    p.add_argument("--region", required=True)
    p.add_argument("--output", required=True)
    p.set_defaults(handler=check_cloudtrail)

    p = sub.add_parser("compose")
    p.add_argument("--metadata", required=True)
    p.add_argument("--cloudtrail", required=True)
    p.add_argument("--verifier-caller", required=True)
    p.add_argument("--preflight-bundle", required=True)
    p.add_argument("--managed-node", required=True)
    p.add_argument("--description", required=True)
    p.add_argument("--get-document", required=True)
    p.add_argument("--invocation", required=True)
    p.add_argument("--verified-iid", required=True)
    p.add_argument("--instance-id", required=True)
    p.add_argument("--worker-id", required=True)
    p.add_argument("--account-id", required=True)
    p.add_argument("--region", required=True)
    p.add_argument("--output", required=True)
    p.set_defaults(handler=compose)

    args = parser.parse_args(argv)
    try:
        args.handler(args)
        return 0
    except strict.CloudTrailEventNotYetVisible as exc:
        print(f"W1_CLOUDTRAIL_RETRYABLE:{exc}", file=sys.stderr)
        return 2
    except Exception as exc:
        print(f"W1_SSM_SAFETY_LIVE_VALIDATION_REJECTED:{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
