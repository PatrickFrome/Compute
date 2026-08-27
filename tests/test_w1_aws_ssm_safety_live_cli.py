from __future__ import annotations

import contextlib
import io
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

from controller.w1 import aws_ssm_safety_live_cli as cli


class LiveCliTests(unittest.TestCase):
    def _json(self, root: Path, name: str, value) -> str:
        path = root / name
        path.write_text(json.dumps(value), encoding="utf-8")
        return str(path)

    def test_validate_remote_delegates_to_reviewed_guards_and_writes_outputs(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            args = SimpleNamespace(
                managed_node=self._json(root, "node.json", {"node": 1}),
                description=self._json(root, "description.json", {"description": 1}),
                get_document=self._json(root, "get.json", {"get": 1}),
                instance_id="i-0123456789abcdef0",
                account_id="123456789012",
                remote_output=str(root / "remote.json"),
                plan_output=str(root / "plan.json"),
            )
            remote = {"aws_document_sha256": "a" * 64, "remote_content_matches_generated_document": True}
            plan = {"schema": "plan", "document_hash": "a" * 64, "instance_ids": [args.instance_id]}
            with patch.object(cli.transport, "validate_managed_node", return_value={"ok": True}) as node_guard, \
                 patch.object(cli.transport, "validate_remote_document", return_value=remote) as remote_guard, \
                 patch.object(cli.transport, "build_command_plan", return_value=plan) as plan_guard:
                cli.validate_remote(args)
            node_guard.assert_called_once()
            remote_guard.assert_called_once()
            plan_guard.assert_called_once_with(instance_id=args.instance_id, aws_document_sha256="a" * 64)
            self.assertEqual(remote, json.loads((root / "remote.json").read_text()))
            self.assertEqual(plan, json.loads((root / "plan.json").read_text()))

    def test_main_returns_two_only_for_explicit_cloudtrail_eventual_consistency(self):
        argv = [
            "check-cloudtrail",
            "--lookup", "lookup.json",
            "--description", "description.json",
            "--get-document", "get.json",
            "--metadata", "metadata.json",
            "--instance-id", "i-0123456789abcdef0",
            "--account-id", "123456789012",
            "--region", "us-east-2",
            "--output", "out.json",
        ]
        err = io.StringIO()
        with patch.object(cli, "check_cloudtrail", side_effect=cli.strict.CloudTrailEventNotYetVisible("not yet")), \
             contextlib.redirect_stderr(err):
            rc = cli.main(argv)
        self.assertEqual(2, rc)
        self.assertIn("W1_CLOUDTRAIL_RETRYABLE", err.getvalue())

    def test_compose_accepts_only_provisioning_proof_and_preserves_all_downstream_nonclaims(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            metadata = self._json(root, "metadata.json", {
                "provisioner_role_arn": "arn:aws:iam::123456789012:role/w1-provision",
                "role_session": "w1-prov-1-1",
                "requested_at": "2026-08-27T22:00:00+00:00",
                "api_returned_at": "2026-08-27T22:00:01+00:00",
            })
            paths = {name: self._json(root, f"{name}.json", {}) for name in (
                "cloudtrail", "verifier_caller", "preflight_bundle", "managed_node",
                "description", "get_document", "invocation", "verified_iid",
            )}
            args = SimpleNamespace(
                metadata=metadata,
                cloudtrail=paths["cloudtrail"],
                verifier_caller=paths["verifier_caller"],
                preflight_bundle=paths["preflight_bundle"],
                managed_node=paths["managed_node"],
                description=paths["description"],
                get_document=paths["get_document"],
                invocation=paths["invocation"],
                verified_iid=paths["verified_iid"],
                instance_id="i-0123456789abcdef0",
                worker_id="w1-worker-01",
                account_id="123456789012",
                region="us-east-2",
                output=str(root / "out.json"),
            )
            result = {
                "package_provisioning_verified": True,
                "strict_send_command_semantics_verified": True,
                "capture_executed": False,
                "host_safety_verified": False,
                "reboot_completion_proven": False,
                "persistent_worker_proof": False,
                "worker_admitted": False,
                "w1_verified": False,
                "database_mutation": False,
                "canonical": False,
                "authority_effect": False,
            }
            with patch.object(cli.strict, "compose_strict_provisioning_provenance", return_value=result):
                cli.compose(args)
            self.assertEqual(result, json.loads((root / "out.json").read_text()))

            escalated = dict(result)
            escalated["w1_verified"] = True
            with patch.object(cli.strict, "compose_strict_provisioning_provenance", return_value=escalated):
                with self.assertRaisesRegex(RuntimeError, "downstream_authority_nonclaim_failed:w1_verified"):
                    cli.compose(args)

    def test_source_has_no_provider_or_database_client_surface(self):
        source = Path(cli.__file__).read_text(encoding="utf-8").lower()
        for forbidden in (
            "import boto3", "from boto3", "requests.", "urllib.", "socket.socket",
            "subprocess.", "os.system", "supabase", "service_role", "reboot-instances",
        ):
            self.assertNotIn(forbidden, source, forbidden)


if __name__ == "__main__":
    unittest.main()
