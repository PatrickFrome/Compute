import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase" / "migrations" / "20260825050000_a2_chat_bridge_receipts_v1.sql"


class A2ChatBridgeReceiptContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text()
        cls.lower = cls.sql.lower()

    def test_receipt_table_is_rls_and_direct_access_closed(self):
        self.assertIn(
            "alter table destruktion_meta.compute_fabric_a2_chat_bridge_receipt_h205f22 enable row level security",
            self.lower,
        )
        self.assertIn(
            "revoke all on table destruktion_meta.compute_fabric_a2_chat_bridge_receipt_h205f22 from public, anon, authenticated, service_role",
            self.lower,
        )

    def test_receipts_are_permanently_nonauthority(self):
        self.assertIn("check (canonical = false)", self.lower)
        self.assertIn("check (authority_effect = false)", self.lower)
        self.assertIn("'canonical',false", self.lower)
        self.assertIn("'authority_effect',false", self.lower)

    def test_no_raw_chat_or_prompt_columns_exist(self):
        table = self.lower.split("create table if not exists", 1)[1].split(");", 1)[0]
        forbidden_columns = [
            r"\bprompt\s+text\b",
            r"\bchat_text\b",
            r"\bmessages\s+jsonb\b",
            r"\bcookies?\b",
            r"\bcredentials?\b",
            r"\bbrowser_token\b",
        ]
        for pattern in forbidden_columns:
            self.assertIsNone(re.search(pattern, table), pattern)
        self.assertIn("prompt_sha256 text", table)
        self.assertIn("snapshot_sha256 text", table)

    def test_security_definer_execute_is_service_role_only(self):
        self.assertIn("security definer", self.lower)
        for fn in [
            "h205f22_a2_chat_bridge_receipt_ingest_v1",
            "h205f22_a2_chat_bridge_receipt_read_v1",
        ]:
            self.assertRegex(
                self.lower,
                rf"revoke execute on function public\.{fn}[^;]+from public, anon, authenticated;",
            )
            self.assertRegex(
                self.lower,
                rf"grant execute on function public\.{fn}[^;]+to service_role;",
            )

    def test_hashes_and_target_pair_are_fail_closed(self):
        self.assertGreaterEqual(self.sql.count("^[0-9a-f]{64}$"), 5)
        self.assertIn("bridge_target_pair_invalid", self.sql)
        self.assertIn("target_agent = 'GPT' and target_platform = 'CHATGPT'", self.sql)
        self.assertIn("target_agent = 'GLM' and target_platform = 'GLM_ZAI'", self.sql)

    def test_command_receipts_bind_idempotency_and_prompt_hash(self):
        self.assertIn("idempotency_key_sha256", self.sql)
        self.assertIn("prompt_sha256", self.sql)
        self.assertIn("command_id", self.sql)
        self.assertIn("dom_send_verified", self.sql)
        self.assertIn("clicked_send_button", self.sql)


if __name__ == "__main__":
    unittest.main()
