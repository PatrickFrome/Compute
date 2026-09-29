#!/usr/bin/env python3
# persist-verdicts-1046.py — store AGENT_FLEET_VERDICTS_1046 into mirror (coordination plane)
import sys, json, importlib.util
spec = importlib.util.spec_from_file_location("ahv1", "/home/z/my-project/scripts/swarm/agent-harness-v1.py")
h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)

payload = {
    "cycle": "TOOLRESULT-1046",
    "loop_status": "CLOSED_E2E_SEGMENT",
    "RESEARCHER": "TOOL_RESULT for adac6557-systel-01 delivered (marker visible); agent producing verification-schema work (result_sha256/nonce/mirror_seq/release_signal fields visible in transcript)",
    "CRITIC": "task-only brief delivered; critique in progress covering exactly requested failure modes: spoofed request, result replay/stale cross-delivery, prompt injection via delivered results; extends to fencing/fabrication refusal",
    "IMPLEMENTER": "task-only brief delivered on 2nd attempt (1st: 502 binding failure non-delivery proven by readback; AMBIGUOUS_AFTER_ENTER receipts again unreliable); harness-v1 spec task accepted",
    "receipt_reliability": "fleet SEMANTIC_TYPE receipts unreliable (AMBIGUOUS_AFTER_ENTER on both delivered and non-delivered cases) - transcript readback is the ONLY delivery truth",
    "harness_v1": "LIVE: poll->allowlist execute->TOOL_RESULT persist->heartbeat; first heartbeat seq=90014608; 0 pending requests",
    "security_note": "IMPLEMENTER transcript still contains plaintext secrets from old capsule brief (standing rotation requirement, operator-only action)",
    "no_secrets_in_new_briefs": True,
}
ok, ts = h.post_event("AGENT_FLEET_VERDICTS_1046", "supervisor-im-cron", payload)
print("persist:", ok, "ts:", ts)
