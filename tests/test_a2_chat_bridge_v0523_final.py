import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXT = ROOT / 'coordination' / 'chat-control-plane' / 'extension'

class Final0523(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.manifest = json.loads((EXT/'manifest.json').read_text())
        cls.entry = (EXT/'background-entry.js').read_text()
        cls.bg = (EXT/'background.js').read_text()
        cls.glm = (EXT/'trusted-glm.js').read_text()
        cls.gpt = (EXT/'trusted-chatgpt.js').read_text()
        cls.content = (EXT/'content.js').read_text()
        cls.vault = (EXT/'secret-vault.js').read_text()
        cls.client = (EXT/'bridge-client.js').read_text()

    def test_01_manifest(self):
        self.assertEqual(self.manifest['manifest_version'], 3); self.assertEqual(self.manifest['version'], '0.5.23'); self.assertEqual(self.manifest['incognito'], 'not_allowed')
    def test_02_entry_order(self):
        order=['secret-vault.js','bridge-client.js','trusted-chatgpt.js','trusted-glm.js','background.js']
        pos=[self.entry.index(x) for x in order]; self.assertEqual(pos, sorted(pos))
    def test_03_no_legacy_runtime(self):
        self.assertFalse((EXT/'auth-fetch.js').exists()); self.assertFalse((EXT/'durable-fetch.js').exists()); self.assertFalse((EXT/'background-v0522.js').exists())
    def test_04_content_read_only(self):
        self.assertNotIn('EXECUTE_CHAT_SEND', self.content); self.assertNotIn('.click()', self.content); self.assertNotIn('Input.dispatch', self.content)
    def test_05_glm_trusted_only(self):
        self.assertIn('A2_GLM_TRUSTED_SEND', self.bg); self.assertNotIn('EXECUTE_CHAT_SEND', self.bg); self.assertIn('Input.dispatchMouseEvent', self.glm)
    def test_06_glm_press_durable_release_order(self):
        press=self.glm.index('type: "mousePressed"'); dispatched=self.glm.index('await postProgress(commandId, transportTraceId, "DISPATCHED")'); durable=self.glm.index('state: "DISPATCHED"', dispatched); release=self.glm.index('type: "mouseReleased"', durable); self.assertLess(press,dispatched); self.assertLess(dispatched,durable); self.assertLess(durable,release)
    def test_07_actuated_after_release(self):
        release=self.glm.index('type: "mouseReleased"'); actuated=self.glm.index('await markActuated', release); self.assertLess(release,actuated)
    def test_08_network_capture_before_release(self):
        marker=self.glm.index('tracker.releaseInitiatedAt = Date.now()'); release=self.glm.index('type: "mouseReleased"', marker); self.assertLess(marker,release)
    def test_09_no_glm_reload_retry(self):
        for text in (self.bg,self.glm): self.assertNotIn('chrome.tabs.reload',text)
    def test_10_strict_predecessor_forwarding(self):
        self.assertIn('glm_predecessor_command_id:pred', self.bg); self.assertIn('A2_ON_GLM_ACTUATED=(commandId)', self.bg); self.assertIn('PREDECESSOR_KEY', self.bg)
    def test_11_pending_command_journal(self):
        self.assertIn('PENDING_KEY', self.bg); self.assertIn('resumePending()', self.bg); self.assertLess(self.bg.index('chrome.storage.local.set({[PENDING_KEY]:body.command})'), self.bg.index('await execute(body.command)'))
    def test_12_gpt_trusted_enter(self):
        self.assertIn('Input.dispatchKeyEvent',self.gpt); self.assertIn('key: "Enter"',self.gpt); self.assertIn('PRE_ENTER_DURABLE', self.gpt)
    def test_13_exclusive_debugger(self):
        self.assertIn('chrome.debugger.getTargets()',self.glm); self.assertIn('already_attached',self.glm); self.assertIn('chrome.debugger.getTargets()',self.gpt)
    def test_14_secret_vault(self):
        self.assertIn('indexedDB.open',self.vault); self.assertNotIn('bridgeSecret', self.bg); self.assertIn('A2_GET_PAIRING_SECRET',self.vault); self.assertIn('A2_GET_PAIRING_SECRET',self.client)
    def test_15_trace_privacy(self):
        self.assertIn('/^[0-9a-f]{32}$/',self.glm); self.assertNotIn('Network.getResponseBody',self.glm); self.assertNotIn('Fetch.enable',self.glm)

if __name__ == '__main__': unittest.main()
