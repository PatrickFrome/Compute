from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
import unittest

from controller.w1 import w1_callback_environment_preflight_guard as environment_guard
from controller.w1 import w1_callback_protected_binding_guard as guard

ROOT = Path(__file__).resolve().parents[1]
NEW_WORKFLOW = ROOT / ".github/workflows/w1-callback-protected-binding.yml"
LEGACY_WORKFLOWS = (
    ROOT / ".github/workflows/w1-callback-protected-readback.yml",
    ROOT / ".github/workflows/w1-callback-protected-readback-v2.yml",
)

GIT_SHA = "1" * 40
TREE_SHA = "2" * 40
ACCOUNT = "123456789012"
REGION = "us-east-2"
ROLE_ARN = f"arn:aws:iam::{ACCOUNT}:role/metaengine/w1-callback-readback"


def environment_receipt() -> dict:
    return environment_guard.validate_environment(
        environment={
            "id": 77,
            "name": environment_guard.ENVIRONMENT,
            "can_admins_bypass": False,
            "protection_rules": [
                {
                    "type": "required_reviewers",
                    "prevent_self_review": True,
                    "reviewers": [{"type": "User", "reviewer": {"id": 88, "login": "reviewer"}}],
                },
                {"type": "branch_policy"},
            ],
            "deployment_branch_policy": {"protected_branches": False, "custom_branch_policies": True},
        },
        branch={"name": "main", "protected": True, "commit": {"sha": "3" * 40}},
        branch_policies={"total_count": 1, "branch_policies": [{"id": 99, "name": "main", "type": "branch"}]},
        custom_rules={"total_count": 0, "custom_deployment_protection_rules": []},
    )


def gate_receipt(env: dict | None = None) -> dict:
    env = env or environment_receipt()
    return environment_guard.seal_gate(
        before=env,
        after=copy.deepcopy(env),
        run_id="12345",
        run_attempt="1",
        repository=environment_guard.REPOSITORY,
        repository_id=environment_guard.REPOSITORY_ID,
        owner_id=environment_guard.REPOSITORY_OWNER_ID,
        ref="refs/heads/main",
    )


def oidc_config() -> dict:
    return guard.validate_oidc_config({"use_default": True, "include_claim_keys": [], "use_immutable_subject": True})


def raw_claims() -> dict:
    # GitHub's documented token example has nbf before iat. The guard must accept that ordering.
    return {
        "iss": guard.ISSUER,
        "aud": guard.AUDIENCE,
        "sub": guard.EXPECTED_SUBJECT,
        "repository": guard.REPOSITORY,
        "repository_id": guard.REPOSITORY_ID,
        "repository_owner_id": guard.REPOSITORY_OWNER_ID,
        "environment": guard.ENVIRONMENT,
        "ref": "refs/heads/main",
        "ref_type": "branch",
        "event_name": "workflow_dispatch",
        "sha": GIT_SHA,
        "workflow_ref": guard.EXPECTED_WORKFLOW_REF,
        "workflow_sha": GIT_SHA,
        "run_id": "12345",
        "run_attempt": "1",
        "runner_environment": "github-hosted",
        "jti": "oidc-jti-12345678",
        "nbf": 400,
        "iat": 1000,
        "exp": 1300,
        "token_sha256": "4" * 64,
    }


def claims_receipt() -> dict:
    return guard.validate_oidc_claims(raw_claims(), gate=gate_receipt(), oidc_config=oidc_config(), git_sha=GIT_SHA, now_epoch=1100)


def policy_receipt() -> dict:
    return guard.build_aws_session_policy(role_arn=ROLE_ARN, account_id=ACCOUNT, region=REGION)


def exact_get_role() -> dict:
    return {
        "Role": {
            "RoleName": "w1-callback-readback",
            "Arn": ROLE_ARN,
            "MaxSessionDuration": 3600,
            "AssumeRolePolicyDocument": {
                "Version": "2012-10-17",
                "Statement": [{
                    "Effect": "Allow",
                    "Principal": {"Federated": f"arn:aws:iam::{ACCOUNT}:oidc-provider/token.actions.githubusercontent.com"},
                    "Action": "sts:AssumeRoleWithWebIdentity",
                    "Condition": {"StringEquals": {
                        "token.actions.githubusercontent.com:aud": guard.AUDIENCE,
                        "token.actions.githubusercontent.com:sub": guard.EXPECTED_SUBJECT,
                    }},
                }],
            },
        }
    }


def sts_proof() -> dict:
    session = "w1-callback-bind-12345-1"
    arn = f"arn:aws:sts::{ACCOUNT}:assumed-role/w1-callback-readback/{session}"
    return {
        "subject_from_web_identity_token": guard.EXPECTED_SUBJECT,
        "audience": guard.AUDIENCE,
        "provider": "token.actions.githubusercontent.com",
        "assumed_role_arn": arn,
        "assumed_role_id": "AROATEST:session",
        "packed_policy_size": 4,
        "account_id": ACCOUNT,
        "caller_arn": arn,
        "token_sha256": "4" * 64,
        "role_session_name": session,
    }


def aws_attestation() -> dict:
    return guard.validate_aws_attestation(
        claims=claims_receipt(),
        session_policy=policy_receipt(),
        sts_proof=sts_proof(),
        get_role=exact_get_role(),
        role_arn=ROLE_ARN,
        account_id=ACCOUNT,
        region=REGION,
    )


def provider_readback(status: str = "NOT_READY") -> dict:
    ready = status == "READY_CANDIDATE_NON_AUTHORITY"
    reasons = [] if ready else ["CALLBACK_KEY_TABLE_ABSENT"]
    evidence = {
        "source": {"git_sha": GIT_SHA, "tree_sha": TREE_SHA},
        "database": {"provenance_class": "PROTECTED_SUPABASE_SQL_READBACK"},
        "edge": {"provenance_class": "PROTECTED_SUPABASE_EDGE_API_READBACK"},
        "aws": {"provenance_class": "PROTECTED_AWS_SSM_API_READBACK"},
    }
    return {
        "schema": guard.PROVIDER_SCHEMA,
        "classification": "W1_CALLBACK_PROTECTED_PROVIDER_READBACK_V2_NONAUTHORITY",
        "absence_requires_authenticated_inventory": True,
        "provider_error_treated_as_absence": False,
        "readiness": {
            "schema": guard.READINESS_SCHEMA,
            "status": status,
            "ready_candidate": ready,
            "reasons": reasons,
            "evidence": evidence,
            "evidence_sha256": hashlib.sha256(json.dumps(evidence, sort_keys=True, separators=(",", ":")).encode()).hexdigest(),
            "database_mutation_authorized": False,
            "edge_deployment_authorized": False,
            "aws_mutation_authorized": False,
            "send_command_authorized": False,
            "provider_identity_verified": False,
            "persistent_worker_proof": False,
            "worker_admitted": False,
            "w1_verified": False,
            "canonical": False,
            "authority_effect": False,
        },
        "database_mutation_authorized": False,
        "edge_deployment_authorized": False,
        "aws_mutation_authorized": False,
        "send_command_authorized": False,
        "worker_admitted": False,
        "w1_verified": False,
        "canonical": False,
        "authority_effect": False,
    }


class CallbackProtectedBindingTests(unittest.TestCase):
    def test_expected_subject_uses_immutable_repository_and_owner_ids(self):
        self.assertEqual(
            "repo:PatrickFrome@20597814/Compute@1341371143:environment:w1-callback-readback",
            guard.EXPECTED_SUBJECT,
        )
        self.assertNotEqual("repo:PatrickFrome/Compute:environment:w1-callback-readback", guard.EXPECTED_SUBJECT)

    def test_default_oidc_config_is_required_and_custom_template_rejected(self):
        receipt = guard.validate_oidc_config({"use_default": True, "include_claim_keys": [], "use_immutable_subject": True})
        self.assertEqual(guard.EXPECTED_SUBJECT, receipt["expected_subject"])
        self.assertFalse(receipt["authority_effect"])
        with self.assertRaisesRegex(guard.CallbackProtectedBindingError, "default_subject_required"):
            guard.validate_oidc_config({"use_default": False, "include_claim_keys": ["repository_id"]})
        with self.assertRaisesRegex(guard.CallbackProtectedBindingError, "immutable_subject_explicitly_disabled"):
            guard.validate_oidc_config({"use_default": True, "use_immutable_subject": False})

    def test_oidc_config_must_not_drift_across_environment_gate(self):
        before = oidc_config()
        after = copy.deepcopy(before)
        after["expected_subject"] = "bad"
        core = dict(after); core.pop("receipt_sha256")
        after["receipt_sha256"] = hashlib.sha256(json.dumps(core, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        with self.assertRaises(guard.CallbackProtectedBindingError):
            guard.compare_oidc_config(before, after)

    def test_documented_github_nbf_before_iat_is_accepted(self):
        receipt = claims_receipt()
        self.assertEqual(400, receipt["not_before"])
        self.assertEqual(1000, receipt["issued_at"])
        self.assertFalse(receipt["jwt_signature_locally_verified"])
        self.assertTrue(receipt["cloud_provider_acceptance_required"])

    def test_name_only_or_wrong_workflow_oidc_identity_is_rejected(self):
        for field, value in (
            ("sub", "repo:PatrickFrome/Compute:environment:w1-callback-readback"),
            ("workflow_ref", "PatrickFrome/Compute/.github/workflows/other.yml@refs/heads/main"),
            ("runner_environment", "self-hosted"),
        ):
            raw = raw_claims(); raw[field] = value
            with self.assertRaisesRegex(guard.CallbackProtectedBindingError, "oidc_claim_mismatch"):
                guard.validate_oidc_claims(raw, gate=gate_receipt(), oidc_config=oidc_config(), git_sha=GIT_SHA, now_epoch=1100)

    def test_expired_or_overlong_oidc_token_is_rejected(self):
        raw = raw_claims(); raw["exp"] = 500
        with self.assertRaises(guard.CallbackProtectedBindingError):
            guard.validate_oidc_claims(raw, gate=gate_receipt(), oidc_config=oidc_config(), git_sha=GIT_SHA, now_epoch=1100)
        raw = raw_claims(); raw["exp"] = 2500
        with self.assertRaisesRegex(guard.CallbackProtectedBindingError, "lifetime_too_long"):
            guard.validate_oidc_claims(raw, gate=gate_receipt(), oidc_config=oidc_config(), git_sha=GIT_SHA, now_epoch=1100)

    def test_aws_session_policy_is_read_only_exact_and_within_sts_limit(self):
        receipt = policy_receipt()
        self.assertLessEqual(receipt["session_policy_chars"], 2048)
        policy = receipt["session_policy"]
        actions = []
        for statement in policy["Statement"]:
            action = statement["Action"]
            actions.extend(action if isinstance(action, list) else [action])
        self.assertEqual({"iam:GetRole", "ssm:ListDocuments", "ssm:DescribeDocument", "ssm:GetDocument", "ssm:DescribeDocumentPermission"}, set(actions))
        for forbidden in ("ssm:SendCommand", "ec2:RebootInstances", "iam:UpdateAssumeRolePolicy", "ssm:StartSession"):
            self.assertNotIn(forbidden, actions)

    def test_exact_role_trust_accepts_only_one_exact_github_statement(self):
        trust = guard.validate_exact_role_trust(get_role=exact_get_role(), role_arn=ROLE_ARN, account_id=ACCOUNT, region=REGION)
        self.assertEqual(guard.EXPECTED_SUBJECT, trust["subject"])
        tampered = exact_get_role()
        tampered["Role"]["AssumeRolePolicyDocument"]["Statement"][0]["Condition"] = {
            "StringLike": {"token.actions.githubusercontent.com:sub": "repo:PatrickFrome@20597814/Compute@1341371143:*"}
        }
        with self.assertRaises(guard.CallbackProtectedBindingError):
            guard.validate_exact_role_trust(get_role=tampered, role_arn=ROLE_ARN, account_id=ACCOUNT, region=REGION)
        extra = exact_get_role()
        extra["Role"]["AssumeRolePolicyDocument"]["Statement"].append(copy.deepcopy(extra["Role"]["AssumeRolePolicyDocument"]["Statement"][0]))
        with self.assertRaisesRegex(guard.CallbackProtectedBindingError, "exactly_one_statement"):
            guard.validate_exact_role_trust(get_role=extra, role_arn=ROLE_ARN, account_id=ACCOUNT, region=REGION)

    def test_sts_response_binds_same_checked_subject_token_hash_and_session(self):
        receipt = aws_attestation()
        self.assertTrue(receipt["same_checked_oidc_token_submitted_to_sts"])
        self.assertTrue(receipt["aws_sts_accepted_subject"])
        self.assertTrue(receipt["aws_role_trust_policy_exact"])
        bad = sts_proof(); bad["token_sha256"] = "9" * 64
        with self.assertRaisesRegex(guard.CallbackProtectedBindingError, "token_hash"):
            guard.validate_aws_attestation(claims=claims_receipt(), session_policy=policy_receipt(), sts_proof=bad,
                                           get_role=exact_get_role(), role_arn=ROLE_ARN, account_id=ACCOUNT, region=REGION)

    def test_final_binding_accepts_not_ready_without_authority_upgrade(self):
        result = guard.seal_binding(
            environment=environment_receipt(), gate=gate_receipt(), oidc_config_before=oidc_config(),
            oidc_config_after=oidc_config(), claims=claims_receipt(), aws_attestation=aws_attestation(),
            provider_readback=provider_readback("NOT_READY"), git_sha=GIT_SHA, tree_sha=TREE_SHA,
        )
        self.assertEqual("NOT_READY", result["callback_readiness_status"])
        self.assertFalse(result["callback_ready_candidate"])
        self.assertTrue(result["authenticated_provider_readback_bound"])
        for field in guard.AUTHORITY_FALSE:
            self.assertIs(result[field], False, field)
        guard.validate_binding_receipt(result)

    def test_final_binding_rejects_provider_source_drift_or_authority_injection(self):
        provider = provider_readback(); provider["readiness"]["evidence"]["source"]["git_sha"] = "9" * 40
        with self.assertRaisesRegex(guard.CallbackProtectedBindingError, "source_revision_mismatch"):
            guard.validate_provider_readback(provider, git_sha=GIT_SHA, tree_sha=TREE_SHA)
        provider = provider_readback(); provider["readiness"]["w1_verified"] = True
        with self.assertRaisesRegex(guard.CallbackProtectedBindingError, "w1_verified_must_be_false"):
            guard.validate_provider_readback(provider, git_sha=GIT_SHA, tree_sha=TREE_SHA)

    def test_new_workflow_is_single_manual_live_entrypoint_and_legacy_paths_are_contract_only(self):
        source = NEW_WORKFLOW.read_text()
        self.assertIn("workflow_dispatch:", source)
        self.assertIn("environment: w1-callback-readback", source)
        self.assertIn("id-token: write", source)
        self.assertIn("actions/oidc/customization/sub", source)
        self.assertIn("assume-role-with-web-identity", source)
        self.assertIn("file:///tmp/w1-callback-oidc.jwt", source)
        self.assertIn("aws iam get-role", source)
        self.assertIn("aws ssm list-documents", source)
        self.assertIn("/v1/projects/${SUPABASE_PROJECT_REF}/functions", source)
        self.assertIn("/v1/projects/${SUPABASE_PROJECT_REF}/functions/${EDGE_SLUG}/body", source)
        self.assertNotIn("configure-aws-credentials", source)
        self.assertNotIn("npx ", source)
        self.assertNotIn("supabase functions download", source)
        self.assertNotIn("W1_AWS_OIDC_SUB", source)
        for forbidden in ("ssm:SendCommand", "ec2:RebootInstances", "ssm:StartSession", "supabase functions deploy", "supabase db push"):
            self.assertNotIn(forbidden, source)
        for legacy in LEGACY_WORKFLOWS:
            old = legacy.read_text()
            self.assertNotIn("workflow_dispatch:", old, legacy.name)
            self.assertNotIn("id-token: write", old, legacy.name)
            self.assertNotIn("secrets.W1_", old, legacy.name)
            self.assertNotIn("configure-aws-credentials", old, legacy.name)

    def test_pre_gate_job_has_no_provider_secret_or_oidc_token_surface(self):
        source = NEW_WORKFLOW.read_text()
        pre = source.split("  credential-free-preflight:", 1)[1].split("  protected-binding:", 1)[0]
        self.assertNotIn("secrets.", pre)
        self.assertNotIn("W1_AWS_", pre)
        self.assertNotIn("ACTIONS_ID_TOKEN_REQUEST", pre)
        self.assertNotIn("id-token: write", pre)
        self.assertIn("actions/oidc/customization/sub", pre)


if __name__ == "__main__":
    unittest.main()
