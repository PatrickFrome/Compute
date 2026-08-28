from __future__ import annotations

import json
from pathlib import Path
import re
import subprocess
import tomllib
import unittest


ROOT = Path(__file__).resolve().parents[1]
KEY_DOC = ROOT / "infra/w1/ssm/Metaengine-W1-Callback-Key-Enroll-H205F22.json"
EXEC_DOC = ROOT / "infra/w1/ssm/Metaengine-W1-Execution-Marker-H205F22.json"
EDGE = ROOT / "supabase/functions/w1-execution-callback/index.ts"
CONFIG = ROOT / "supabase/config.toml"
SQL = ROOT / "supabase/prep/w1_callback_auth_v1.sql"


class CallbackAuthContractTests(unittest.TestCase):
    def test_key_enrollment_document_is_parameterless_private_key_nonexporting(self):
        doc = json.loads(KEY_DOC.read_text())
        self.assertEqual("2.2", doc["schemaVersion"])
        self.assertEqual({}, doc["parameters"])
        self.assertEqual(1, len(doc["mainSteps"]))
        step = doc["mainSteps"][0]
        self.assertEqual("aws:runShellScript", step["action"])
        self.assertEqual("enrollCallbackSigningKey", step["name"])
        script = "\n".join(step["inputs"]["runCommand"])
        self.assertIn("callback-es256-private.pem", script)
        self.assertIn("ec_paramgen_curve:P-256", script)
        self.assertIn("runuser -u \"$EXEC_USER\"", script)
        self.assertIn("'private_key_exported':False", script)
        self.assertIn("latest/api/token", script)
        self.assertNotIn("AWS-RunDocument", script)
        self.assertNotIn("aws:runDocument", script)
        self.assertNotIn("github.com", script)
        self.assertNotIn("s3://", script)
        self.assertNotIn("SUPABASE_", script)

    def test_execution_document_uses_only_nonsecret_env_interpolated_parameters(self):
        doc = json.loads(EXEC_DOC.read_text())
        self.assertEqual(
            {"WorkerId", "PackageSha256", "PayloadLockSha256", "ExecutionPayloadSha256", "ChallengeNonce"},
            set(doc["parameters"]),
        )
        for name, spec in doc["parameters"].items():
            self.assertEqual("String", spec["type"], name)
            self.assertEqual("ENV_VAR", spec["interpolationType"], name)
            self.assertIn("allowedPattern", spec, name)
        for name in ("PackageSha256", "PayloadLockSha256", "ExecutionPayloadSha256", "ChallengeNonce"):
            self.assertEqual("^[0-9a-f]{64}$", doc["parameters"][name]["allowedPattern"])
        script = "\n".join(doc["mainSteps"][0]["inputs"]["runCommand"])
        self.assertNotIn("{{", script)
        self.assertIn("SSM Agent 3.3.2746.0+ ENV_VAR interpolation required", script)
        self.assertIn("runuser -u \"$EXEC_USER\"", script)
        self.assertIn("callback-es256-private.pem", script)
        self.assertIn("ES256-P1363-SHA256", script)
        self.assertIn("METAENGINE:H205F22:W1:EXECUTION-CALLBACK:v1", script)
        self.assertIn(
            "https://xpeibufgzjknrhbhpffp.supabase.co/functions/v1/w1-execution-callback",
            script,
        )
        self.assertIn("-o \"$RESP\"", script)
        self.assertIn("METAENGINE_W1_EXECUTION_MARKER_JSON=", script)
        self.assertNotIn("AWS-RunDocument", script)
        self.assertNotIn("aws:runDocument", script)
        self.assertNotIn("SUPABASE_SECRET", script)
        self.assertNotIn("Authorization:", script)

    def test_root_transport_and_nonroot_signer_are_separate(self):
        doc = json.loads(EXEC_DOC.read_text())
        script = "\n".join(doc["mainSteps"][0]["inputs"]["runCommand"])
        sign_position = script.index("openssl','dgst','-sha256','-sign'")
        runuser_position = script.index('runuser -u "$EXEC_USER" -- env')
        callback_position = script.index("curl -fsS --connect-timeout 3")
        self.assertLess(runuser_position, sign_position)
        self.assertLess(sign_position, callback_position)
        signer_block = script[runuser_position:callback_position]
        self.assertNotIn("https://", signer_block)
        self.assertNotIn("curl ", signer_block)

    def test_edge_ingress_is_public_transport_but_self_authenticates_with_p256(self):
        cfg = tomllib.loads(CONFIG.read_text())
        self.assertIs(cfg["functions"]["w1-execution-callback"]["verify_jwt"], False)
        source = EDGE.read_text()
        self.assertIn('const ALGORITHM = "ES256-P1363-SHA256"', source)
        self.assertIn('namedCurve: "P-256"', source)
        self.assertIn("crypto.subtle.verify", source)
        self.assertIn("callback_key_id_digest_mismatch", source)
        self.assertIn("marker_freshness_invalid", source)
        self.assertIn("WORKER_ENROLLMENT_SIGNATURE_V1", source)
        self.assertIn("compute_fabric_get_w1_callback_key_h205f22", source)
        self.assertIn("compute_fabric_record_w1_execution_callback_h205f22", source)
        self.assertIn('"apikey": secretApiKey()', source)
        self.assertNotIn("Authorization:", source)
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", source)
        self.assertNotIn("worker_admitted: true", source)
        self.assertNotIn("w1_verified: true", source)
        self.assertNotIn("authority_effect: true", source)

    def test_prep_sql_is_service_role_only_security_invoker_nonauthority(self):
        source = SQL.read_text().lower()
        self.assertIn("compute_fabric_w1_callback_key_h205f22", source)
        self.assertIn("compute_fabric_w1_execution_callback_receipt_h205f22", source)
        self.assertIn("compute_fabric_register_w1_callback_key_h205f22", source)
        self.assertIn("compute_fabric_revoke_w1_callback_key_h205f22", source)
        self.assertIn("compute_fabric_get_w1_callback_key_h205f22", source)
        self.assertIn("compute_fabric_record_w1_execution_callback_h205f22", source)
        self.assertGreaterEqual(source.count("security invoker"), 4)
        self.assertNotIn("security definer", source)
        self.assertIn("enable row level security", source)
        self.assertIn("from public, anon, authenticated", source)
        self.assertIn("to service_role", source)
        self.assertNotIn("w1_verified = true", source)
        self.assertNotIn("worker_admitted = true", source)
        self.assertNotIn("authority_effect = true", source)
        self.assertNotRegex(source, r"grant\s+.*\s+to\s+(anon|authenticated)")

    def test_embedded_shell_is_syntax_valid(self):
        for path in (KEY_DOC, EXEC_DOC):
            doc = json.loads(path.read_text())
            script = "\n".join(doc["mainSteps"][0]["inputs"]["runCommand"])
            proc = subprocess.run(["bash", "-n"], input=script, text=True, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, check=False)
            self.assertEqual(0, proc.returncode, f"{path}: {proc.stderr}")

    def test_callback_key_registry_has_explicit_revocation_surface(self):
        source = SQL.read_text()
        self.assertIn("revoked_at timestamptz", source)
        self.assertIn("compute_fabric_revoke_w1_callback_key_h205f22", source)
        self.assertIn("and k.revoked_at is null", source)
        self.assertIn("and revoked_at is null", source)


if __name__ == "__main__":
    unittest.main()
