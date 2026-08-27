from __future__ import annotations

from pathlib import Path
import unittest

from controller.w1 import provider_mutation_authority_gap_audit as audit


ROOT = Path(__file__).resolve().parents[1]


def gated_aws() -> str:
    return """
name: gated
steps:
  - name: Acquire fresh external W1 authority receipt
    run: curl https://example/metaengine-w1-authority-broker-h205f22
  - name: Verify
    run: python controller/w1/provider_dispatch_authority_guard.py
  - name: mutate
    run: aws ec2 reboot-instances --instance-ids "$INSTANCE_ID"
"""


class ProviderMutationAuthorityGapAuditTests(unittest.TestCase):
    def test_ungated_aws_mutation_blocks(self):
        result = audit.evaluate({".github/workflows/w1-x.yml": "run: aws ec2 reboot-instances --instance-ids i-1\n"}, {})
        self.assertFalse(result["audit_passed"])
        self.assertEqual(result["outcome"], "BLOCK_PROVIDER_MUTATION_AUTHORITY_GAP")
        self.assertEqual(result["evidence"]["ungated_workflow_mutation_count"], 1)

    def test_gated_aws_mutation_passes_as_nonauthority(self):
        result = audit.evaluate({".github/workflows/w1-x.yml": gated_aws()}, {"controller/w1/safe.py": "x=1\n"})
        self.assertTrue(result["audit_passed"])
        self.assertEqual(result["evidence"]["gated_workflow_mutation_count"], 1)
        self.assertFalse(result["provider_mutation_authorized"])
        self.assertFalse(result["authority_effect"])
        self.assertFalse(result["w1_verified"])

    def test_codespaces_direct_python_post_blocks(self):
        source = "result = _call(method='POST', url=_endpoint(name, '/stop'), token=token, timeout=30)\n"
        result = audit.evaluate({".github/workflows/w1-x.yml": "name: safe\n"}, {"controller/w1/codespace.py": source})
        self.assertFalse(result["audit_passed"])
        self.assertEqual(result["evidence"]["direct_code_mutation_count"], 1)

    def test_codespaces_plan_literals_do_not_become_mutation_surface(self):
        source = "plan={'provider':'codespace','sequence':[{'method':'POST','url':'/stop'}]}\n"
        result = audit.evaluate({".github/workflows/w1-x.yml": "name: safe\n"}, {"controller/w1/codespace.py": source})
        self.assertTrue(result["audit_passed"])
        self.assertEqual(result["evidence"]["direct_code_mutation_count"], 0)

    def test_codespaces_cli_mutation_in_workflow_blocks(self):
        result = audit.evaluate({".github/workflows/w1-x.yml": "run: gh codespace stop -c target\n"}, {"controller/w1/safe.py": "x=1\n"})
        self.assertFalse(result["audit_passed"])
        self.assertEqual(result["evidence"]["workflow_mutation_surfaces"][0]["kind"], "GITHUB_CODESPACE_CLI")

    def test_vercel_sandbox_mutation_in_workflow_blocks(self):
        result = audit.evaluate({".github/workflows/w1-x.yml": "run: vercel sandbox create demo\n"}, {"controller/w1/safe.py": "x=1\n"})
        self.assertFalse(result["audit_passed"])
        self.assertEqual(result["evidence"]["workflow_mutation_surfaces"][0]["kind"], "VERCEL_SANDBOX_CLI")

    def test_service_role_in_runtime_provider_mutation_workflow_blocks(self):
        text = gated_aws() + "env:\n  SUPABASE_SERVICE_ROLE_KEY: forbidden\n"
        result = audit.evaluate({".github/workflows/w1-x.yml": text}, {"controller/w1/safe.py": "x=1\n"})
        self.assertFalse(result["audit_passed"])
        self.assertEqual(result["evidence"]["service_role_consumers"], [".github/workflows/w1-x.yml"])

    def test_current_rail_has_only_externally_gated_provider_mutation(self):
        workflows, sources = audit.collect(ROOT)
        result = audit.evaluate(workflows, sources)
        self.assertTrue(result["audit_passed"], result)
        self.assertGreater(result["evidence"]["workflow_count"], 0)
        self.assertGreater(result["evidence"]["controller_source_count"], 0)
        self.assertGreaterEqual(result["evidence"]["gated_workflow_mutation_count"], 1)
        self.assertEqual(result["evidence"]["ungated_workflow_mutation_count"], 0)
        self.assertEqual(result["evidence"]["direct_code_mutation_count"], 0)
        self.assertEqual(result["evidence"]["service_role_consumers"], [])


if __name__ == "__main__":
    unittest.main()
