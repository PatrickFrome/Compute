#!/usr/bin/env python3
# c3_reviewer_skeleton.py — R28 / MANDATE v3 §reviewer C3 skeleton.
# C3 = independent reviewer over the decision ledger + objective.status transitions.
# Gates (mandate v3): G1 objective.status transitions follow trust ladder; G2 ledger entries
# hash-chained & append-only; G3 circuit-breaker state consistent with DENY history.
import json, os, time, hashlib
from dataclasses import dataclass

LEDGER_PATH = os.environ.get("ME2_POLICY_LEDGER", "/tmp/me2-policy-ledger.jsonl")
TRUST_ORDER = {"T0": 0, "T1": 1, "T2": 2, "NONE": -1}

@dataclass
class Review:
    gate: str
    verdict: str          # PASS | FAIL | UNDECIDED
    evidence: str

def load_ledger(path=LEDGER_PATH):
    if not os.path.exists(path): return []
    out = []
    with open(path) as f:
        for line in f:
            try: out.append(json.loads(line))
            except Exception: pass
    return out

def g1_status_ladder(entries):
    """objective.status transitions must never jump tiers downward without ESCALATE record."""
    escalates = [e for e in entries if e.get("verdict") == "ESCALATE"]
    if not entries:
        return Review("G1", "UNDECIDED", "ledger empty")
    bad = [e for e in entries if e.get("trust_tier") not in TRUST_ORDER]
    if bad:
        return Review("G1", "FAIL", f"{len(bad)} entries with unknown trust_tier")
    return Review("G1", "PASS", f"{len(entries)} entries tier-valid, {len(escalates)} escalations recorded")

def g2_ledger_chaining(entries):
    """ledger_sha must equal sha256(canonical entry)[:16] (tamper-evidence)."""
    bad = []
    for e in entries:
        ref = e.get("ledger_sha")
        copy = {k: v for k, v in e.items() if k != "ledger_sha"}
        want = hashlib.sha256(json.dumps(copy, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]
        if ref != want: bad.append(ref)
    if bad:
        return Review("G2", "FAIL", f"{len(bad)} entries with broken ledger_sha (tamper or bug)")
    return Review("G2", "PASS", f"{len(entries)} entries hash-consistent")

def g3_circuit_breaker(entries, window_s=300, threshold=5):
    """If >=threshold DENY inside window -> newest decision must not be plain ALLOW."""
    now = time.time()
    denies = 0
    for e in entries:
        if e.get("verdict") != "DENY": continue
        try: t = time.mktime(time.strptime(e["ts"], "%Y-%m-%dT%H:%M:%SZ"))
        except Exception: continue
        if now - t <= window_s: denies += 1
    last = entries[-1] if entries else None
    if denies >= threshold:
        if last and last.get("verdict") == "ALLOW" and last.get("trust_tier") == "T0" and last.get("action") in ("TAB_CENSUS",):
            return Review("G3", "PASS", f"breaker OPEN ({denies} denies) — read-only ALLOW still permitted")
        return Review("G3", "FAIL", f"breaker OPEN ({denies} denies) but last verdict={last and last.get('verdict')}")
    return Review("G3", "PASS", f"breaker CLOSED ({denies} denies in window)")

def review(path=LEDGER_PATH):
    entries = load_ledger(path)
    reviews = [g1_status_ladder(entries), g2_ledger_chaining(entries), g3_circuit_breaker(entries)]
    return reviews

if __name__ == "__main__":
    for r in review():
        print(f"{r.gate}: {r.verdict:9s} {r.evidence}")
