//go:build windows

package main

import (
	"os"
	"strings"
	"testing"
)

func TestInspectCurrentProcessExact(t *testing.T) {
	exe, err := os.Executable()
	if err != nil { t.Fatal(err) }
	rb := inspectProcess(os.Getpid(), exe)
	if rb.Status != "ALIVE" || rb.PID != os.Getpid() || len(rb.ExecutableSHA256) != 64 { t.Fatalf("unexpected %#v", rb) }
}

func TestInspectCurrentProcessWrongPath(t *testing.T) {
	rb := inspectProcess(os.Getpid(), `C:\\definitely-not-metaengine\\browser.exe`)
	if rb.Status != "WRONG_PROCESS" { t.Fatalf("unexpected %#v", rb) }
}

func TestSafeLaunchEnvironmentExcludesUnapprovedValues(t *testing.T) {
	t.Setenv("METAENGINE_TEST_SECRET", "secret")
	t.Setenv("LOCALAPPDATA", `C:\\Users\\runner\\AppData\\Local`)
	env := safeLaunchEnvironment()
	joined := strings.Join(env, "\n")
	if strings.Contains(joined, "METAENGINE_TEST_SECRET=") || strings.Contains(joined, "secret") { t.Fatalf("secret leaked into child environment: %s", joined) }
	if !strings.Contains(strings.ToUpper(joined), "LOCALAPPDATA=") { t.Fatalf("required local app data missing: %s", joined) }
}
