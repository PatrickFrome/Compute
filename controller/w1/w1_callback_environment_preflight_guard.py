#!/usr/bin/env python3
"""Credential-free GitHub Environment gate preflight for W1 callback readback.

This module performs no network access and grants no provider authority. It validates
GitHub Environment/branch-policy metadata collected through public read-only REST
surfaces and emits self-hashed non-authoritative receipts.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any

ENVIRONMENT = "w1-callback-readback"
REPOSITORY = "PatrickFrome/Compute"
REPOSITORY_ID = "1341371143"
REPOSITORY_OWNER_ID = "20597814"
SCHEMA = "metaengine.compute.w1-callback-github-environment-preflight.h205f22.v1"
GATE_SCHEMA = "metaengine.compute.w1-callback-github-environment-gate.h205f22.v1"
SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
ALLOWED_RULE_TYPES = {"required_reviewers", "branch_policy", "wait_timer"}


class CallbackEnvironmentPreflightError(RuntimeError):
    pass


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _sha_json(value: Any) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


def _read_json(path: Path, label: str) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise CallbackEnvironmentPreflightError(f"{label}_invalid_json") from exc


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(_canonical(value) + b"\n")


def _require_object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise CallbackEnvironmentPreflightError(f"{label}_not_object")
    return value


def _reviewer_identity(item: Any) -> dict[str, Any]:
    item = _require_object(item, "reviewer")
    kind = item.get("type")
    if kind not in {"User", "Team"}:
        raise CallbackEnvironmentPreflightError("reviewer_type_invalid")
    reviewer = _require_object(item.get("reviewer"), "reviewer_identity")
    reviewer_id = reviewer.get("id")
    if not isinstance(reviewer_id, int) or reviewer_id <= 0:
        raise CallbackEnvironmentPreflightError("reviewer_id_invalid")
    result = {"type": kind, "id": reviewer_id}
    if kind == "User":
        login = reviewer.get("login")
        if not isinstance(login, str) or not login:
            raise CallbackEnvironmentPreflightError("reviewer_user_login_invalid")
        result["login"] = login
    else:
        slug = reviewer.get("slug")
        if not isinstance(slug, str) or not slug:
            raise CallbackEnvironmentPreflightError("reviewer_team_slug_invalid")
        result["slug"] = slug
    return result


def validate_environment(*, environment: Any, branch: Any, branch_policies: Any,
                         custom_rules: Any) -> dict[str, Any]:
    env = _require_object(environment, "environment")
    if env.get("name") != ENVIRONMENT:
        raise CallbackEnvironmentPreflightError("environment_identity_mismatch")
    if env.get("can_admins_bypass") is not False:
        raise CallbackEnvironmentPreflightError("environment_admin_bypass_must_be_disabled")

    rules = env.get("protection_rules")
    if not isinstance(rules, list) or any(not isinstance(rule, dict) for rule in rules):
        raise CallbackEnvironmentPreflightError("environment_protection_rules_invalid")
    rule_types = [rule.get("type") for rule in rules]
    if any(kind not in ALLOWED_RULE_TYPES for kind in rule_types):
        raise CallbackEnvironmentPreflightError("unsupported_environment_protection_rule")
    reviewer_rules = [rule for rule in rules if rule.get("type") == "required_reviewers"]
    if len(reviewer_rules) != 1:
        raise CallbackEnvironmentPreflightError("exactly_one_required_reviewers_rule_required")
    branch_rules = [rule for rule in rules if rule.get("type") == "branch_policy"]
    if len(branch_rules) != 1:
        raise CallbackEnvironmentPreflightError("exactly_one_branch_policy_rule_required")
    wait_rules = [rule for rule in rules if rule.get("type") == "wait_timer"]
    if len(wait_rules) > 1:
        raise CallbackEnvironmentPreflightError("multiple_wait_timer_rules_forbidden")
    wait_timer = 0
    if wait_rules:
        wait_timer = wait_rules[0].get("wait_timer")
        if not isinstance(wait_timer, int) or wait_timer < 0 or wait_timer > 43200:
            raise CallbackEnvironmentPreflightError("wait_timer_invalid")

    reviewer_rule = reviewer_rules[0]
    if reviewer_rule.get("prevent_self_review") is not True:
        raise CallbackEnvironmentPreflightError("prevent_self_review_required")
    reviewers_raw = reviewer_rule.get("reviewers")
    if not isinstance(reviewers_raw, list) or not 1 <= len(reviewers_raw) <= 6:
        raise CallbackEnvironmentPreflightError("required_reviewers_count_invalid")
    reviewers = [_reviewer_identity(item) for item in reviewers_raw]
    if len({(item["type"], item["id"]) for item in reviewers}) != len(reviewers):
        raise CallbackEnvironmentPreflightError("duplicate_required_reviewer")

    deployment = _require_object(env.get("deployment_branch_policy"), "deployment_branch_policy")
    if deployment.get("protected_branches") is not False or deployment.get("custom_branch_policies") is not True:
        raise CallbackEnvironmentPreflightError("exact_custom_branch_policy_mode_required")

    policies = _require_object(branch_policies, "branch_policies")
    items = policies.get("branch_policies")
    if not isinstance(items, list) or any(not isinstance(item, dict) for item in items):
        raise CallbackEnvironmentPreflightError("branch_policy_items_invalid")
    if policies.get("total_count") != len(items):
        raise CallbackEnvironmentPreflightError("branch_policy_count_mismatch")
    if len(items) != 1 or items[0].get("name") != "main":
        raise CallbackEnvironmentPreflightError("exact_main_only_deployment_policy_required")
    if items[0].get("type") not in (None, "branch"):
        raise CallbackEnvironmentPreflightError("main_deployment_policy_must_be_branch")
    policy_id = items[0].get("id")
    if not isinstance(policy_id, int) or policy_id <= 0:
        raise CallbackEnvironmentPreflightError("main_deployment_policy_id_invalid")

    main = _require_object(branch, "main_branch")
    if main.get("name") != "main" or main.get("protected") is not True:
        raise CallbackEnvironmentPreflightError("protected_main_branch_required")
    commit = _require_object(main.get("commit"), "main_branch_commit")
    head_sha = commit.get("sha")
    if not isinstance(head_sha, str) or SHA40.fullmatch(head_sha) is None:
        raise CallbackEnvironmentPreflightError("main_branch_head_sha_invalid")

    custom = _require_object(custom_rules, "custom_protection_rules")
    enabled = custom.get("custom_deployment_protection_rules")
    if not isinstance(enabled, list) or any(not isinstance(item, dict) for item in enabled):
        raise CallbackEnvironmentPreflightError("custom_protection_rules_invalid")
    if custom.get("total_count") != len(enabled):
        raise CallbackEnvironmentPreflightError("custom_protection_rule_count_mismatch")
    if enabled:
        raise CallbackEnvironmentPreflightError("custom_protection_rules_not_supported")

    core = {
        "schema": SCHEMA,
        "classification": "W1_CALLBACK_GITHUB_ENVIRONMENT_PREFLIGHT_NONAUTHORITY",
        "repository": REPOSITORY,
        "repository_id": REPOSITORY_ID,
        "repository_owner_id": REPOSITORY_OWNER_ID,
        "environment": ENVIRONMENT,
        "environment_id": env.get("id"),
        "can_admins_bypass": False,
        "required_reviewers": reviewers,
        "required_reviewer_count": len(reviewers),
        "prevent_self_review": True,
        "wait_timer_minutes": wait_timer,
        "deployment_branch_policy_mode": "EXACT_CUSTOM_MAIN_ONLY",
        "deployment_branch_policy_id": policy_id,
        "main_branch_head_sha": head_sha,
        "main_branch_protected": True,
        "custom_deployment_protection_rules_enabled": False,
        "environment_approval_required_before_job_start": True,
        "environment_secrets_unavailable_before_protection_rules_pass": True,
        "expected_oidc_context": {
            "repository": REPOSITORY,
            "repository_id": REPOSITORY_ID,
            "repository_owner_id": REPOSITORY_OWNER_ID,
            "environment": ENVIRONMENT,
            "ref": "refs/heads/main",
        },
        "oidc_token_validated": False,
        "provider_credentials_used": False,
        "aws_execution_authorized": False,
        "supabase_mutation_authorized": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }
    result = dict(core)
    result["receipt_sha256"] = _sha_json(core)
    return result


def validate_receipt(value: Any) -> dict[str, Any]:
    receipt = _require_object(value, "receipt")
    if receipt.get("schema") != SCHEMA:
        raise CallbackEnvironmentPreflightError("receipt_schema_invalid")
    claimed = receipt.get("receipt_sha256")
    if not isinstance(claimed, str) or SHA256.fullmatch(claimed) is None:
        raise CallbackEnvironmentPreflightError("receipt_sha256_invalid")
    core = dict(receipt)
    core.pop("receipt_sha256", None)
    if _sha_json(core) != claimed:
        raise CallbackEnvironmentPreflightError("receipt_sha256_mismatch")
    if receipt.get("environment") != ENVIRONMENT or receipt.get("deployment_branch_policy_mode") != "EXACT_CUSTOM_MAIN_ONLY":
        raise CallbackEnvironmentPreflightError("receipt_environment_boundary_invalid")
    if receipt.get("can_admins_bypass") is not False or receipt.get("prevent_self_review") is not True:
        raise CallbackEnvironmentPreflightError("receipt_review_boundary_invalid")
    for field in ("provider_credentials_used", "aws_execution_authorized", "supabase_mutation_authorized",
                  "worker_admitted", "w1_verified", "canonical", "authority_effect"):
        if receipt.get(field) is not False:
            raise CallbackEnvironmentPreflightError(f"receipt_{field}_must_be_false")
    return receipt


def seal_gate(*, before: Any, after: Any, run_id: str, run_attempt: str,
              repository: str, repository_id: str, owner_id: str, ref: str) -> dict[str, Any]:
    left = validate_receipt(before)
    right = validate_receipt(after)
    if left != right:
        raise CallbackEnvironmentPreflightError("environment_drift_across_gate")
    expected = {
        "repository": REPOSITORY,
        "repository_id": REPOSITORY_ID,
        "repository_owner_id": REPOSITORY_OWNER_ID,
        "ref": "refs/heads/main",
    }
    observed = {
        "repository": repository,
        "repository_id": repository_id,
        "repository_owner_id": owner_id,
        "ref": ref,
    }
    if observed != expected:
        raise CallbackEnvironmentPreflightError("gate_github_context_mismatch")
    if not run_id.isdigit() or not run_attempt.isdigit():
        raise CallbackEnvironmentPreflightError("gate_run_identity_invalid")
    core = {
        "schema": GATE_SCHEMA,
        "classification": "W1_CALLBACK_GITHUB_ENVIRONMENT_GATE_PASSED_NONAUTHORITY",
        "environment": ENVIRONMENT,
        "preflight_receipt_sha256": left["receipt_sha256"],
        "post_gate_receipt_sha256": right["receipt_sha256"],
        "github_run_id": run_id,
        "github_run_attempt": run_attempt,
        "repository": repository,
        "repository_id": repository_id,
        "repository_owner_id": owner_id,
        "ref": ref,
        "environment_gate_job_started_after_protection_rules": True,
        "environment_metadata_stable_across_gate": True,
        "provider_credentials_used": False,
        "oidc_token_requested": False,
        "aws_execution_authorized": False,
        "supabase_mutation_authorized": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }
    result = dict(core)
    result["receipt_sha256"] = _sha_json(core)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    env = sub.add_parser("validate-environment")
    env.add_argument("--environment", type=Path, required=True)
    env.add_argument("--branch", type=Path, required=True)
    env.add_argument("--branch-policies", type=Path, required=True)
    env.add_argument("--custom-rules", type=Path, required=True)
    env.add_argument("--output", type=Path, required=True)

    receipt = sub.add_parser("validate-receipt")
    receipt.add_argument("--input", type=Path, required=True)

    gate = sub.add_parser("seal-gate")
    gate.add_argument("--before", type=Path, required=True)
    gate.add_argument("--after", type=Path, required=True)
    gate.add_argument("--run-id", required=True)
    gate.add_argument("--run-attempt", required=True)
    gate.add_argument("--repository", required=True)
    gate.add_argument("--repository-id", required=True)
    gate.add_argument("--owner-id", required=True)
    gate.add_argument("--ref", required=True)
    gate.add_argument("--output", type=Path, required=True)

    args = parser.parse_args(argv)
    try:
        if args.command == "validate-environment":
            result = validate_environment(
                environment=_read_json(args.environment, "environment"),
                branch=_read_json(args.branch, "branch"),
                branch_policies=_read_json(args.branch_policies, "branch_policies"),
                custom_rules=_read_json(args.custom_rules, "custom_rules"),
            )
            _write_json(args.output, result)
        elif args.command == "validate-receipt":
            validate_receipt(_read_json(args.input, "receipt"))
        else:
            result = seal_gate(
                before=_read_json(args.before, "before"),
                after=_read_json(args.after, "after"),
                run_id=args.run_id,
                run_attempt=args.run_attempt,
                repository=args.repository,
                repository_id=args.repository_id,
                owner_id=args.owner_id,
                ref=args.ref,
            )
            _write_json(args.output, result)
        return 0
    except CallbackEnvironmentPreflightError as exc:
        print(f"W1_CALLBACK_ENVIRONMENT_PREFLIGHT_REJECTED:{exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
