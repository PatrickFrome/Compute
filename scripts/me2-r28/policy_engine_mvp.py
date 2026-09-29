#!/usr/bin/env python3
# policy_engine_mvp.py — R28 / MANDATE v3 §policy-engine MVP (T0 allowlist + decision ledger)
# Policy-governed autonomy: evaluate(action, ctx) -> typed decision + append-only ledger entry.
# T0 = allowlisted read-only + supervised mutations; T1 = task-scoped mutations (lease required);
# T2 = privileged (operator/owner authority only). Circuit breaker: N DENY in window -> OPEN.
import json, time, hashlib, os, threading
from dataclasses import dataclass, field, asdict
from typing import Optional

LEDGER_PATH = os.environ.get("ME2_POLICY_LEDGER", "/tmp/me2-policy-ledger.jsonl")

T0_READONLY = {
    "CAPTURE", "CAPTURE_VIEW", "READ_TRANSCRIPT", "TAB_CENSUS", "TAB_TELEMETRY",
    "SYSTEM_TELEMETRY", "PROCESS_CENSUS", "PROCESS_EVENTS", "SEMANTIC_CENSUS",
    "SEMANTIC_EVENTS", "FLEET_STATUS", "GATE_STATUS", "SELF_UPDATE_STATUS",
    "DOWNLOAD_STATUS", "CONTROL_CAPABILITIES", "CONTROL_LATENCY_STATUS", "POLL",
    "DEV_PLANE_STATUS", "DEV_PLANE_HEALTH", "DEV_PLANE_CAPABILITIES",
    "DEV_PLANE_REPO_HEAD", "DEV_PLANE_PROCESS_METRICS",
}
T0_MUTATION_SUPERVISED = {  # allowlisted mutating actions (supervisor-issued only)
    "NEW_TAB", "SELECT_TAB", "CLOSE_TAB", "RELOAD", "SEMANTIC_FOCUS",
    "SEMANTIC_TYPE", "PRESS_KEY", "TYPED_CLICK", "SCROLL", "NAVIGATE",
    "BACK", "FORWARD",  # R28-fix 20260928: allowlist gap found by mt-419203-verify sweep (same class as NAVIGATE/RELOAD)
    "DOWNLOAD_CANCEL",  # R28-fix 20260928 (Job 419203): allowlist gap — отмена supervisor-initiated download; low-risk (не исполняет код, не чистит данные; DOWNLOAD_FILE остаётся T2)
    "FLEET_RECONCILE", "FLEET_SET_PROFILE", "SET_SUPERVISOR_MODE", "ARM",
    "SELF_UPDATE_CHECK", "AGENT_TOOL_RESULT_PERSIST",
}
T1_ACTIONS = {"FLEET_BRIEF_DISPATCH", "MIRROR_APPEND"}     # task-scoped, lease required
T2_ACTIONS = {  # never auto-allowed: owner authority / risk-bearing
    "DISARM", "GATE_ENABLE", "GATE_DISABLE", "GATE_ENABLE_ALL", "GATE_DISABLE_ALL",
    "SELF_UPDATE_APPLY", "SET_PROXY", "SET_SITE_PERMISSION", "CLEAR_SITE_DATA",
    "DOWNLOAD_FILE",
}
NEVER = {"WEBMCP_INVOKE", "CHATGPT_SET_SETTING", "CHATGPT_PROJECT_CONFIGURE"}  # absent from build or high-risk

@dataclass
class Decision:
    action: str
    verdict: str          # ALLOW | DENY | ESCALATE
    trust_tier: str       # T0 | T1 | T2 | NONE
    reason: str
    conditions: list = field(default_factory=list)
    ledger_sha: Optional[str] = None

class PolicyEngine:
    def __init__(self, ledger_path=LEDGER_PATH, deny_threshold=5, deny_window_s=300):
        self.ledger_path = ledger_path
        self.deny_threshold = deny_threshold
        self.deny_window_s = deny_window_s
        self._lock = threading.Lock()

    def evaluate(self, action: str, ctx: Optional[dict] = None) -> Decision:
        ctx = ctx or {}
        issuer = str(ctx.get("issuer", "unknown"))
        if action in NEVER:
            return self._finish(Decision(action, "DENY", "NONE", "action is never-allowlisted (absent from build or high-risk)"))
        if action in T2_ACTIONS:
            return self._finish(Decision(action, "ESCALATE", "T2",
                "owner-authority action requires operator/owner approval",
                conditions=["owner_override_id_required"]))
        if action in T0_READONLY:
            return self._finish(Decision(action, "ALLOW", "T0", "read-only allowlist"))
        if action in T0_MUTATION_SUPERVISED:
            conds = []
            if issuer and ("supervisor" in issuer or "zai" in issuer):
                pass
            else:
                return self._finish(Decision(action, "ESCALATE", "T0",
                    f"mutation issuer {issuer!r} not a recognized supervisor identity",
                    conditions=["supervisor_identity_required"]))
            if ctx.get("mutation_gap_ok") is not True:
                conds.append("enforce_mutation_gap_ge_15s")
            return self._finish(Decision(action, "ALLOW", "T0", "supervised mutation allowlist", conditions=conds))
        if action in T1_ACTIONS:
            if ctx.get("lease_held") is True:
                return self._finish(Decision(action, "ALLOW", "T1", "task-scoped mutation under dispatcher lease"))
            return self._finish(Decision(action, "ESCALATE", "T1", "dispatcher lease not held",
                                         conditions=["lease_required"]))
        # circuit breaker on recent denies
        if self._recent_denies() >= self.deny_threshold:
            return self._finish(Decision(action, "DENY", "NONE", "circuit breaker OPEN: deny threshold exceeded"))
        return self._finish(Decision(action, "DENY", "NONE", "action not in any allowlist tier"))

    # ---- ledger (append-only JSONL) ----
    def _finish(self, d: Decision) -> Decision:
        rec = {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **asdict(d)}
        rec.pop("ledger_sha", None)
        blob = json.dumps(rec, sort_keys=True, ensure_ascii=False)
        rec["ledger_sha"] = hashlib.sha256(blob.encode()).hexdigest()[:16]
        with self._lock:
            with open(self.ledger_path, "a") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        d.ledger_sha = rec["ledger_sha"]
        return d

    def _recent_denies(self) -> int:
        if not os.path.exists(self.ledger_path): return 0
        now = time.time(); n = 0
        with open(self.ledger_path) as f:
            for line in f:
                try: r = json.loads(line)
                except Exception: continue
                if r.get("verdict") == "DENY":
                    try: t = time.mktime(time.strptime(r["ts"], "%Y-%m-%dT%H:%M:%SZ"))
                    except Exception: t = 0
                    if now - t <= self.deny_window_s: n += 1
        return n

if __name__ == "__main__":
    pe = PolicyEngine(ledger_path="/tmp/me2-policy-ledger-smoke.jsonl")
    cases = [
        ("TAB_CENSUS", {"issuer": "zai-419718"}, "ALLOW/T0"),
        ("SEMANTIC_TYPE", {"issuer": "zai-419718-1215", "mutation_gap_ok": True}, "ALLOW/T0"),
        ("SEMANTIC_TYPE", {"issuer": "random-agent"}, "ESCALATE/T0"),
        ("SELF_UPDATE_APPLY", {"issuer": "zai-419718-1215"}, "ESCALATE/T2"),
        ("FLEET_BRIEF_DISPATCH", {"issuer": "z-419718", "lease_held": True}, "ALLOW/T1"),
        ("FLEET_BRIEF_DISPATCH", {"issuer": "z-419718", "lease_held": False}, "ESCALATE/T1"),
        ("WEBMCP_INVOKE", {}, "DENY/NONE"),
        ("MADE_UP_ACTION", {}, "DENY/NONE"),
    ]
    ok = 0
    for action, ctx, expect in cases:
        d = pe.evaluate(action, ctx)
        got = f"{d.verdict}/{d.trust_tier}"
        mark = "OK " if got == expect else "FAIL"
        ok += mark == "OK "
        print(f"{mark} {action:22s} -> {got:12s} (expected {expect:12s}) ledger={d.ledger_sha}")
    print(f"smoke: {ok}/{len(cases)} passed")
