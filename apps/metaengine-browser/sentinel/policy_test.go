package main

import (
	"strings"
	"testing"
	"time"
)

func policyForTest() Policy {
	return defaultPolicy(strings.Repeat("a", 64), strings.Repeat("b", 40), strings.Repeat("c", 64))
}
func hb(now time.Time, phase string) *Heartbeat {
	return &Heartbeat{Schema: heartbeatSchema, BrowserIncarnationID: "inc.browser.0001", PID: 42, ExecutableSHA256: strings.Repeat("a", 64), SourceCommitSHA: strings.Repeat("b", 40), PackageSHA256: strings.Repeat("c", 64), HeartbeatSeq: 7, ObservedAtUnixMS: now.UnixMilli(), UpdatePhase: phase, ShutdownIntent: "NONE"}
}
func alive() ProcessReadback {
	return ProcessReadback{Status: "ALIVE", PID: 42, ExecutableSHA256: strings.Repeat("a", 64)}
}

func TestHealthyExactBinding(t *testing.T) {
	now := time.Unix(1000, 0)
	d, err := evaluate(now, policyForTest(), freshState(), hb(now, "NONE"), alive(), strings.Repeat("a", 64))
	if err != nil { t.Fatal(err) }
	if d.Code != "HEALTHY" || d.LaunchAuthorized || d.State.BoundPID != 42 || d.State.BoundIncarnationID != "inc.browser.0001" { t.Fatalf("unexpected %#v", d) }
}
func TestDigestMismatchNeverLaunches(t *testing.T) {
	now := time.Unix(1000, 0)
	d, _ := evaluate(now, policyForTest(), freshState(), nil, ProcessReadback{Status: "DEAD"}, strings.Repeat("d", 64))
	if d.Code != "IDENTITY_MISMATCH_FUSED" || d.LaunchAuthorized { t.Fatalf("unexpected %#v", d) }
}
func TestUnknownReadbackNeverLaunches(t *testing.T) {
	now := time.Unix(1000, 0)
	d, _ := evaluate(now, policyForTest(), freshState(), nil, ProcessReadback{Status: "UNKNOWN"}, strings.Repeat("a", 64))
	if d.Code != "PROCESS_READBACK_UNKNOWN_HOLD" || d.LaunchAuthorized { t.Fatalf("unexpected %#v", d) }
}
func TestOneLaunchThenMandatoryReconcile(t *testing.T) {
	now := time.Unix(1000, 0)
	d, _ := evaluate(now, policyForTest(), freshState(), nil, ProcessReadback{Status: "DEAD"}, strings.Repeat("a", 64))
	if !d.LaunchAuthorized || d.State.PendingLaunch == nil { t.Fatalf("expected launch %#v", d) }
	next, _ := evaluate(now.Add(time.Second), policyForTest(), d.State, nil, ProcessReadback{Status: "UNKNOWN"}, strings.Repeat("a", 64))
	if next.LaunchAuthorized || next.Code != "LAUNCH_AMBIGUOUS_RECONCILE_REQUIRED" && next.Code != "LAUNCH_RECONCILE_REQUIRED" { t.Fatalf("blind retry %#v", next) }
}
func TestUpdateGraceSuppressesConfirmedDeadRelaunch(t *testing.T) {
	p := policyForTest(); now := time.Unix(1000, 0)
	d, _ := evaluate(now, p, freshState(), hb(now, "RESTARTING"), alive(), strings.Repeat("a", 64))
	if d.Code != "HEALTHY_UPDATE_GRACE_ARMED" { t.Fatal(d.Code) }
	dead := d.State; dead.BoundPID = 42
	x, _ := evaluate(now.Add(10*time.Second), p, dead, nil, ProcessReadback{Status: "DEAD", PID: 42}, strings.Repeat("a", 64))
	if x.LaunchAuthorized || x.Code != "UPDATE_GRACE_HOLD" { t.Fatalf("unexpected %#v", x) }
}
func TestCrashLoopFuse(t *testing.T) {
	p := policyForTest(); now := time.Unix(1000, 0); s := freshState()
	for i := 0; i < p.CrashFuseCount; i++ { s.BoundPID = 42; s = markCrash(now.Add(time.Duration(i)*time.Second), p, s) }
	d, _ := evaluate(now.Add(20*time.Second), p, s, nil, ProcessReadback{Status: "DEAD"}, strings.Repeat("a", 64))
	if d.LaunchAuthorized || d.Code != "CRASH_LOOP_FUSED" { t.Fatalf("unexpected %#v", d) }
}
func TestTaintedHeartbeatCannotOverrideProvenance(t *testing.T) {
	p := policyForTest(); now := time.Unix(1000, 0); bad := hb(now, "NONE"); bad.SourceCommitSHA = strings.Repeat("d", 40)
	d, _ := evaluate(now, p, freshState(), bad, alive(), strings.Repeat("a", 64))
	if d.LaunchAuthorized || d.Code != "PROCESS_ALIVE_HEARTBEAT_UNTRUSTED_HOLD" { t.Fatalf("unexpected %#v", d) }
}
func TestIntentionalUserQuitNeverRelaunches(t *testing.T) {
	p := policyForTest(); now := time.Unix(1000, 0); h := hb(now, "NONE"); h.ShutdownIntent = "USER_EXIT"
	d, _ := evaluate(now, p, freshState(), h, alive(), strings.Repeat("a", 64))
	if d.Code != "INTENTIONAL_STOP_LATCHED" { t.Fatal(d.Code) }
	x, _ := evaluate(now.Add(10*time.Second), p, d.State, nil, ProcessReadback{Status: "DEAD", PID: 42}, strings.Repeat("a", 64))
	if x.LaunchAuthorized || x.Code != "INTENTIONAL_STOP_HOLD" { t.Fatalf("unexpected %#v", x) }
}
func TestWrongProcessReadbackCannotAuthorizeLaunch(t *testing.T) {
	p := policyForTest(); now := time.Unix(1000, 0)
	d, _ := evaluate(now, p, freshState(), nil, ProcessReadback{Status: "WRONG_PROCESS", PID: 42, ExecutableSHA256: strings.Repeat("d", 64)}, strings.Repeat("a", 64))
	if d.LaunchAuthorized || d.Code != "PROCESS_IDENTITY_MISMATCH_HOLD" { t.Fatalf("unexpected %#v", d) }
}
func TestUpdateImageChangeRetiresOldSentinelWithoutLaunching(t *testing.T) {
	p := policyForTest(); now := time.Unix(1000, 0)
	d, _ := evaluate(now, p, freshState(), hb(now, "RESTARTING"), alive(), strings.Repeat("a", 64))
	if d.Code != "HEALTHY_UPDATE_GRACE_ARMED" { t.Fatal(d.Code) }
	x, _ := evaluate(now.Add(time.Second), p, d.State, nil, ProcessReadback{Status: "UNKNOWN"}, strings.Repeat("d", 64))
	if x.LaunchAuthorized || !x.RetireAuthorized || x.Code != "UPDATE_IMAGE_CHANGED_HANDOFF" { t.Fatalf("unexpected %#v", x) }
}
