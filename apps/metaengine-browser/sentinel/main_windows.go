//go:build windows

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

var (
	expectedBrowserName   = ""
	expectedBrowserSHA256 = ""
	expectedSourceCommit  = ""
	expectedPackageSHA256 = ""
)

func targetPathFromSelf() (string, error) {
	if expectedBrowserName == "" || filepath.Base(expectedBrowserName) != expectedBrowserName || filepath.Ext(expectedBrowserName) != ".exe" {
		return "", fmt.Errorf("sentinel_target_name_invalid")
	}
	self, err := os.Executable()
	if err != nil { return "", err }
	self, err = filepath.EvalSymlinks(self)
	if err != nil { return "", err }
	// packaged layout: resources/sentinel/browser-sentinel.exe -> app root/METAENGINE Browser.exe
	root := filepath.Clean(filepath.Join(filepath.Dir(self), "..", ".."))
	target := filepath.Join(root, expectedBrowserName)
	if filepath.Base(target) != expectedBrowserName { return "", fmt.Errorf("sentinel_target_name_invalid") }
	return target, nil
}

func main() {
	release, err := acquireSingleton()
	if err != nil {
		if err.Error() == "sentinel_already_running" { return }
		fmt.Fprintln(os.Stderr, err); os.Exit(2)
	}
	defer release()
	p := defaultPolicy(strings.ToLower(expectedBrowserSHA256), strings.ToLower(expectedSourceCommit), strings.ToLower(expectedPackageSHA256))
	if err := p.Validate(); err != nil { fmt.Fprintln(os.Stderr, err); os.Exit(3) }
	target, err := targetPathFromSelf()
	if err != nil { fmt.Fprintln(os.Stderr, err); os.Exit(4) }
	dir, err := boundedStateDir()
	if err != nil { fmt.Fprintln(os.Stderr, err); os.Exit(5) }
	statePath := filepath.Join(dir, "state.json")
	heartbeatPath := filepath.Join(dir, "heartbeat.json")
	s := freshState()
	_ = readJSON(statePath, &s)
	for {
		digest, derr := sha256File(target)
		if derr != nil { digest = "" }
		var h *Heartbeat
		var parsed Heartbeat
		if readJSON(heartbeatPath, &parsed) == nil { h = &parsed }
		pid := s.BoundPID
		if s.PendingLaunch != nil && s.PendingLaunch.PID > 0 { pid = s.PendingLaunch.PID } else if h != nil && h.PID > 0 { pid = h.PID }
		rb := inspectProcess(pid, target)
		d, e := evaluate(time.Now(), p, s, h, rb, digest)
		if e != nil {
			s.LastDecision = "POLICY_ERROR_FUSED"; s.LastError = e.Error(); _ = writeJSONAtomic(statePath, s); sleepUntilNextTick(); continue
		}
		s = d.State
		if d.RetireAuthorized { _ = writeJSONAtomic(statePath, s); return }
		if d.LaunchAuthorized {
			// Persist intent before the physical effect. No second launch occurs while PendingLaunch remains.
			if err := writeJSONAtomic(statePath, s); err != nil { os.Exit(6) }
			launchedPID, lerr := launchExact(target)
			if lerr != nil {
				s.PendingLaunch.Ambiguous = true; s.LastDecision = "LAUNCH_AMBIGUOUS_RECONCILE_REQUIRED"; s.LastError = lerr.Error()
			} else {
				s.PendingLaunch.PID = launchedPID; s.LastDecision = "LAUNCHED_RECONCILE_REQUIRED"; s.LastError = ""
			}
		}
		_ = writeJSONAtomic(statePath, s)
		sleepUntilNextTick()
	}
}
