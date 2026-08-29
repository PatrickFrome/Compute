//go:build windows

package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const (
	processQueryLimitedInformation = 0x1000
	errorAlreadyExists             = 183
	createNewProcessGroup          = 0x00000200
	detachedProcess                = 0x00000008
)

var (
	kernel32                   = syscall.NewLazyDLL("kernel32.dll")
	procOpenProcess            = kernel32.NewProc("OpenProcess")
	procCloseHandle            = kernel32.NewProc("CloseHandle")
	procQueryFullProcessImageW = kernel32.NewProc("QueryFullProcessImageNameW")
	procCreateMutexW           = kernel32.NewProc("CreateMutexW")
)

func sha256File(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil { return "", err }
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil { return "", err }
	return hex.EncodeToString(h.Sum(nil)), nil
}

func processPath(pid int) (string, error) {
	if pid <= 0 { return "", errors.New("pid_invalid") }
	h, _, e := procOpenProcess.Call(processQueryLimitedInformation, 0, uintptr(uint32(pid)))
	if h == 0 { return "", e }
	defer procCloseHandle.Call(h)
	buf := make([]uint16, 32768)
	size := uint32(len(buf))
	r, _, e := procQueryFullProcessImageW.Call(h, 0, uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&size)))
	if r == 0 { return "", e }
	return syscall.UTF16ToString(buf[:size]), nil
}

func inspectProcess(pid int, expectedPath string) ProcessReadback {
	if pid <= 0 { return ProcessReadback{Status: "DEAD", PID: pid} }
	p, err := processPath(pid)
	if err != nil {
		if errno, ok := err.(syscall.Errno); ok && (errno == syscall.Errno(87) || errno == syscall.ERROR_ACCESS_DENIED) {
			if errno == syscall.ERROR_ACCESS_DENIED { return ProcessReadback{Status: "UNKNOWN", PID: pid} }
			return ProcessReadback{Status: "DEAD", PID: pid}
		}
		return ProcessReadback{Status: "UNKNOWN", PID: pid}
	}
	digest, err := sha256File(p)
	if err != nil { return ProcessReadback{Status: "UNKNOWN", PID: pid, ExecutablePath: p} }
	status := "ALIVE"
	if !strings.EqualFold(filepath.Clean(p), filepath.Clean(expectedPath)) { status = "WRONG_PROCESS" }
	return ProcessReadback{Status: status, PID: pid, ExecutablePath: p, ExecutableSHA256: digest}
}

func acquireSingleton() (func(), error) {
	name, _ := syscall.UTF16PtrFromString(`Local\METAENGINE_BROWSER_SENTINEL_V1`)
	h, _, e := procCreateMutexW.Call(0, 1, uintptr(unsafe.Pointer(name)))
	if h == 0 { return nil, e }
	if syscall.GetLastError() == syscall.Errno(errorAlreadyExists) {
		procCloseHandle.Call(h)
		return nil, errors.New("sentinel_already_running")
	}
	return func() { procCloseHandle.Call(h) }, nil
}

func boundedStateDir() (string, error) {
	base, err := os.UserCacheDir()
	if err != nil { return "", err }
	return filepath.Join(base, "METAENGINE", "BrowserSentinelV1"), nil
}

func readJSON(path string, out any) error {
	b, err := os.ReadFile(path)
	if err != nil { return err }
	if len(b) > 64*1024 { return errors.New("sentinel_state_too_large") }
	return json.Unmarshal(b, out)
}

func writeJSONAtomic(path string, value any) error {
	b, err := json.MarshalIndent(value, "", "  ")
	if err != nil { return err }
	if len(b) > 64*1024 { return errors.New("sentinel_state_too_large") }
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil { return err }
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(b, '\n'), 0600); err != nil { return err }
	return os.Rename(tmp, path)
}

func safeLaunchEnvironment() []string {
	allow := map[string]bool{"SYSTEMROOT": true, "WINDIR": true, "LOCALAPPDATA": true, "APPDATA": true, "TEMP": true, "TMP": true, "USERPROFILE": true, "HOMEDRIVE": true, "HOMEPATH": true}
	out := []string{}
	for _, row := range os.Environ() {
		k, _, ok := strings.Cut(row, "=")
		if ok && allow[strings.ToUpper(k)] { out = append(out, row) }
	}
	return out
}

func launchExact(targetPath string) (int, error) {
	cmd := exec.Command(targetPath)
	cmd.Dir = filepath.Dir(targetPath)
	cmd.Env = safeLaunchEnvironment()
	cmd.Stdin = nil
	cmd.Stdout = nil
	cmd.Stderr = nil
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNewProcessGroup | detachedProcess}
	if err := cmd.Start(); err != nil { return 0, err }
	pid := cmd.Process.Pid
	_ = cmd.Process.Release()
	return pid, nil
}

func sleepUntilNextTick() { time.Sleep(2 * time.Second) }
