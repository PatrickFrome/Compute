from __future__ import annotations

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/w1-aws-provider-reboot-proof.yml"
BROKER = ROOT / "supabase/functions/metaengine-w1-authority-broker-h205f22/index.ts"
PREFLIGHT_SQL = ROOT / "supabase/prep/w1_effective_execution_preflight_v1.sql"
SELF_CHECK = "      - name: Validate live W1 credential and trust-zone contract"
NEXT_JOB = "\n  preflight-environment:"


def execution_workflow() -> str:
    """Return workflow text with the inline policy checker removed.

    The checker necessarily quotes forbidden tokens and step names as assertions;
    treating those policy literals as runtime consumers creates false positives.
    """
    raw = WORKFLOW.read_text(encoding="utf-8")
    before, remainder = raw.split(SELF_CHECK, 1)
    _checker, after = remainder.split(NEXT_JOB, 1)
    return before + NEXT_JOB + after


class ProviderDispatchAuthorityBrokerContractTests(unittest.TestCase):
    def test_broker_verifies_github_oidc_and_live_db_preflight(self):
        text = BROKER.read_text(encoding="utf-8")
        self.assertIn('createRemoteJWKSet', text)
        self.assertIn('jwtVerify', text)
        self.assertIn('https://token.actions.githubusercontent.com', text)
        self.assertIn('metaengine-h205f22-w1-authority-broker', text)
        self.assertIn('repository_id: "1341371143"', text)
        self.assertIn('repository_owner_id: "20597814"', text)
        self.assertIn('refs/heads/main', text)
        self.assertIn('w1-persistent-host-proof', text)
        self.assertIn('workflow_dispatch', text)
        self.assertIn('runner_environment', text)
        self.assertIn('h205f22_a2_acceptance_consume_oidc_jti_v1', text)
        self.assertIn('h205f22_w1_effective_execution_preflight_v1', text)
        self.assertIn('PASS_EFFECTIVE_EXECUTION_PREFLIGHT_NONAUTHORITY', text)
        self.assertIn('RECEIPT_TTL_MS = 90_000', text)
        self.assertIn('broker_mints_authority: false', text)
        self.assertIn('authority_effect: false', text)

    def test_elevated_database_key_stays_server_side(self):
        broker = BROKER.read_text(encoding="utf-8")
        workflow = execution_workflow()
        self.assertIn('SUPABASE_SERVICE_ROLE_KEY', broker)
        self.assertNotIn('SUPABASE_SERVICE_ROLE_KEY', workflow)
        self.assertNotIn('SUPABASE_SECRET_KEYS', workflow)
        self.assertNotIn('secrets.SUPABASE', workflow)
        self.assertNotIn('sb_secret_', workflow)

    def test_real_provider_mutation_is_structurally_after_external_gate(self):
        workflow = execution_workflow()
        gate = workflow.index('      - name: Acquire fresh external W1 authority receipt')
        verify = workflow.index('provider_dispatch_authority_guard.py', gate)
        reboot_step = workflow.index('      - name: Execute independent provider reboot', gate)
        real_command = workflow.index('aws ec2 reboot-instances --instance-ids "$INSTANCE_ID"', reboot_step)
        self.assertLess(gate, verify)
        self.assertLess(verify, reboot_step)
        self.assertLess(reboot_step, real_command)
        self.assertEqual(workflow.count('aws ec2 reboot-instances --instance-ids "$INSTANCE_ID"\n'), 1)
        self.assertIn('ACTIONS_ID_TOKEN_REQUEST_URL', workflow[gate:reboot_step])
        self.assertIn('metaengine-h205f22-w1-authority-broker', workflow[gate:reboot_step])
        self.assertIn('h205f22_w1_effective_execution_preflight_v1', PREFLIGHT_SQL.read_text(encoding="utf-8"))

    def test_real_reboot_requires_explicit_claim_and_directive_coordinates(self):
        workflow = execution_workflow()
        self.assertIn('claim_id:', workflow)
        self.assertIn('directive_id:', workflow)
        self.assertIn('CLAIM_ID: ${{ inputs.claim_id }}', workflow)
        self.assertIn('DIRECTIVE_ID: ${{ inputs.directive_id }}', workflow)
        self.assertIn('[[ "$CLAIM_ID" =~ ^[0-9]+$ ]]', workflow)
        self.assertIn('[[ "$DIRECTIVE_ID" =~ ^[0-9]+$ ]]', workflow)

    def test_broker_url_is_pinned_to_project_not_user_supplied(self):
        workflow = execution_workflow()
        expected = 'https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/metaengine-w1-authority-broker-h205f22'
        self.assertIn(expected, workflow)
        self.assertNotIn('inputs.authority_broker_url', workflow)
        self.assertNotIn('vars.W1_AUTHORITY_BROKER_URL', workflow)


if __name__ == "__main__":
    unittest.main()
