package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
)

const (
	sentinelSchema  = "metaengine.browser-sentinel.state.v1"
	heartbeatSchema = "metaengine.browser-sentinel.heartbeat.v1"
)

var (
	hex64         = regexp.MustCompile(`^[0-9a-f]{64}$`)
	hex40         = regexp.MustCompile(`^[0-9a-f]{40}$`)
	incarnationRE = regexp.MustCompile(`^[a-z0-9][a-z0-9._:-]{7,127}$`)
)

type Policy struct {
	ExpectedExecutableSHA256 string
	ExpectedSourceCommit     string
	ExpectedPackageSHA256    string
	HeartbeatTTL             time.Duration
	ReconcileGrace           time.Duration
	BackoffBase              time.Duration
	BackoffMax               time.Duration
	CrashWindow              time.Duration
	CrashFuseCount           int
	FuseDuration             time.Duration
	UpdateGrace              time.Duration
	StableReset              time.Duration
}

type Heartbeat struct {
	Schema               string `json:"schema"`
	BrowserIncarnationID string `json:"browser_incarnation_id"`
	PID                  int    `json:"pid"`
	ExecutableSHA256     string `json:"executable_sha256"`
	SourceCommitSHA      string `json:"source_commit_sha"`
	PackageSHA256        string `json:"package_sha256"`
	HeartbeatSeq         uint64 `json:"heartbeat_seq"`
	ObservedAtUnixMS     int64  `json:"observed_at_unix_ms"`
	UpdatePhase          string `json:"update_phase"`
	ShutdownIntent       string `json:"shutdown_intent"`
}

type ProcessReadback struct {
	Status           string
	PID              int
	ExecutablePath   string
	ExecutableSHA256 string
}

type LaunchIntent struct {
	IntentID        string `json:"intent_id"`
	CreatedAtUnixMS int64  `json:"created_at_unix_ms"`
	PID             int    `json:"pid,omitempty"`
	Ambiguous       bool   `json:"ambiguous"`
}

type State struct {
	Schema                    string        `json:"schema"`
	BoundIncarnationID        string        `json:"bound_incarnation_id,omitempty"`
	BoundPID                  int           `json:"bound_pid,omitempty"`
	LastHeartbeatSeq          uint64        `json:"last_heartbeat_seq,omitempty"`
	LastHealthyAtUnixMS       int64         `json:"last_healthy_at_unix_ms,omitempty"`
	NextLaunchNotBeforeUnixMS int64         `json:"next_launch_not_before_unix_ms,omitempty"`
	CrashWindowStartUnixMS    int64         `json:"crash_window_start_unix_ms,omitempty"`
	CrashCount                int           `json:"crash_count,omitempty"`
	FuseUntilUnixMS           int64         `json:"fuse_until_unix_ms,omitempty"`
	UpdateGraceUntilUnixMS    int64         `json:"update_grace_until_unix_ms,omitempty"`
	PendingLaunch             *LaunchIntent `json:"pending_launch,omitempty"`
	LastDecision              string        `json:"last_decision"`
	LastError                 string        `json:"last_error,omitempty"`
	IntentionalStopLatched    bool          `json:"intentional_stop_latched,omitempty"`
}

type Decision struct {
	Code             string
	LaunchAuthorized bool
	RetireAuthorized bool
	State            State
}

func defaultPolicy(exe, source, pkg string) Policy {
	return Policy{
		ExpectedExecutableSHA256: strings.ToLower(exe),
		ExpectedSourceCommit:     strings.ToLower(source),
		ExpectedPackageSHA256:    strings.ToLower(pkg),
		HeartbeatTTL:             8 * time.Second,
		ReconcileGrace:           15 * time.Second,
		BackoffBase:              2 * time.Second,
		BackoffMax:               2 * time.Minute,
		CrashWindow:              10 * time.Minute,
		CrashFuseCount:           5,
		FuseDuration:             30 * time.Minute,
		UpdateGrace:              2 * time.Minute,
		StableReset:              5 * time.Minute,
	}
}

func (p Policy) Validate() error {
	if !hex64.MatchString(p.ExpectedExecutableSHA256) {
		return errors.New("sentinel_executable_digest_invalid")
	}
	if !hex40.MatchString(p.ExpectedSourceCommit) {
		return errors.New("sentinel_source_commit_invalid")
	}
	if !hex64.MatchString(p.ExpectedPackageSHA256) {
		return errors.New("sentinel_package_digest_invalid")
	}
	if p.HeartbeatTTL < time.Second || p.ReconcileGrace < time.Second || p.BackoffBase < time.Second || p.BackoffMax < p.BackoffBase {
		return errors.New("sentinel_timing_policy_invalid")
	}
	if p.CrashFuseCount < 2 || p.CrashFuseCount > 20 || p.CrashWindow < p.BackoffBase || p.FuseDuration < p.BackoffBase {
		return errors.New("sentinel_crash_policy_invalid")
	}
	return nil
}

func freshState() State { return State{Schema: sentinelSchema, LastDecision: "INIT"} }

func validateHeartbeat(h *Heartbeat, p Policy) bool {
	if h == nil || h.Schema != heartbeatSchema || h.PID <= 0 || h.HeartbeatSeq == 0 || h.ObservedAtUnixMS <= 0 {
		return false
	}
	if !incarnationRE.MatchString(strings.ToLower(h.BrowserIncarnationID)) {
		return false
	}
	if strings.ToLower(h.ExecutableSHA256) != p.ExpectedExecutableSHA256 || strings.ToLower(h.SourceCommitSHA) != p.ExpectedSourceCommit || strings.ToLower(h.PackageSHA256) != p.ExpectedPackageSHA256 {
		return false
	}
	switch h.UpdatePhase {
	case "NONE", "DOWNLOADED_RESTART_PENDING", "INSTALLING", "RESTARTING":
	default:
		return false
	}
	switch h.ShutdownIntent {
	case "", "NONE", "USER_EXIT", "UPDATE_RESTART":
	default:
		return false
	}
	return true
}

func exactProcess(rb ProcessReadback, h *Heartbeat, p Policy) bool {
	if rb.Status != "ALIVE" || rb.PID <= 0 || strings.ToLower(rb.ExecutableSHA256) != p.ExpectedExecutableSHA256 {
		return false
	}
	return h == nil || rb.PID == h.PID
}

func backoff(p Policy, n int) time.Duration {
	if n <= 0 {
		return 0
	}
	d := p.BackoffBase
	for i := 1; i < n && d < p.BackoffMax; i++ {
		d *= 2
		if d > p.BackoffMax {
			return p.BackoffMax
		}
	}
	return d
}

func markCrash(now time.Time, p Policy, s State) State {
	ms := now.UnixMilli()
	if s.CrashWindowStartUnixMS == 0 || now.Sub(time.UnixMilli(s.CrashWindowStartUnixMS)) > p.CrashWindow {
		s.CrashWindowStartUnixMS = ms
		s.CrashCount = 0
	}
	s.CrashCount++
	s.NextLaunchNotBeforeUnixMS = now.Add(backoff(p, s.CrashCount)).UnixMilli()
	if s.CrashCount >= p.CrashFuseCount {
		s.FuseUntilUnixMS = now.Add(p.FuseDuration).UnixMilli()
	}
	s.BoundPID = 0
	s.BoundIncarnationID = ""
	return s
}

func evaluate(now time.Time, p Policy, input State, hb *Heartbeat, rb ProcessReadback, targetDigest string) (Decision, error) {
	if err := p.Validate(); err != nil {
		return Decision{}, err
	}
	s := input
	if s.Schema == "" {
		s = freshState()
	}
	if s.Schema != sentinelSchema {
		return Decision{}, errors.New("sentinel_state_schema_invalid")
	}
	targetDigest = strings.ToLower(targetDigest)
	if targetDigest != p.ExpectedExecutableSHA256 {
		if s.UpdateGraceUntilUnixMS > now.UnixMilli() && s.PendingLaunch == nil {
			s.LastDecision = "UPDATE_IMAGE_CHANGED_HANDOFF"
			s.LastError = ""
			return Decision{Code: s.LastDecision, RetireAuthorized: true, State: s}, nil
		}
		s.LastDecision = "IDENTITY_MISMATCH_FUSED"
		s.LastError = "target_executable_digest_mismatch"
		return Decision{Code: s.LastDecision, State: s}, nil
	}

	validHB := validateHeartbeat(hb, p)
	exactAlive := exactProcess(rb, hb, p)

	if s.PendingLaunch != nil {
		if exactAlive && validHB {
			s.PendingLaunch = nil
			s.BoundPID = hb.PID
			s.BoundIncarnationID = strings.ToLower(hb.BrowserIncarnationID)
			s.LastHeartbeatSeq = hb.HeartbeatSeq
			s.LastHealthyAtUnixMS = now.UnixMilli()
			s.LastDecision = "RECONCILED_HEALTHY"
			s.LastError = ""
			return Decision{Code: s.LastDecision, State: s}, nil
		}
		if rb.Status == "UNKNOWN" || s.PendingLaunch.Ambiguous {
			s.LastDecision = "LAUNCH_AMBIGUOUS_RECONCILE_REQUIRED"
			return Decision{Code: s.LastDecision, State: s}, nil
		}
		if rb.Status != "DEAD" || now.Sub(time.UnixMilli(s.PendingLaunch.CreatedAtUnixMS)) < p.ReconcileGrace {
			s.LastDecision = "LAUNCH_RECONCILE_REQUIRED"
			return Decision{Code: s.LastDecision, State: s}, nil
		}
		s.PendingLaunch = nil
		s = markCrash(now, p, s)
	}

	if exactAlive {
		if !validHB {
			s.LastDecision = "PROCESS_ALIVE_HEARTBEAT_UNTRUSTED_HOLD"
			return Decision{Code: s.LastDecision, State: s}, nil
		}
		age := now.Sub(time.UnixMilli(hb.ObservedAtUnixMS))
		if age <= p.HeartbeatTTL {
			previousHealthy := s.LastHealthyAtUnixMS
			s.BoundPID = hb.PID
			s.BoundIncarnationID = strings.ToLower(hb.BrowserIncarnationID)
			s.LastHeartbeatSeq = hb.HeartbeatSeq
			s.LastHealthyAtUnixMS = now.UnixMilli()
			if hb.ShutdownIntent == "USER_EXIT" {
				s.IntentionalStopLatched = true
				s.LastDecision = "INTENTIONAL_STOP_LATCHED"
			} else {
				s.IntentionalStopLatched = false
				if hb.UpdatePhase == "INSTALLING" || hb.UpdatePhase == "RESTARTING" || hb.UpdatePhase == "DOWNLOADED_RESTART_PENDING" || hb.ShutdownIntent == "UPDATE_RESTART" {
					s.UpdateGraceUntilUnixMS = now.Add(p.UpdateGrace).UnixMilli()
					s.LastDecision = "HEALTHY_UPDATE_GRACE_ARMED"
				} else {
					s.LastDecision = "HEALTHY"
				}
			}
			if s.CrashCount > 0 && previousHealthy > 0 && now.Sub(time.UnixMilli(previousHealthy)) >= p.StableReset {
				s.CrashCount = 0
				s.CrashWindowStartUnixMS = 0
			}
			s.LastError = ""
			return Decision{Code: s.LastDecision, State: s}, nil
		}
		s.LastDecision = "PROCESS_ALIVE_HEARTBEAT_STALE_HOLD"
		return Decision{Code: s.LastDecision, State: s}, nil
	}

	if rb.Status == "WRONG_PROCESS" {
		s.LastDecision = "PROCESS_IDENTITY_MISMATCH_HOLD"
		return Decision{Code: s.LastDecision, State: s}, nil
	}
	if rb.Status == "UNKNOWN" {
		s.LastDecision = "PROCESS_READBACK_UNKNOWN_HOLD"
		return Decision{Code: s.LastDecision, State: s}, nil
	}
	if s.BoundPID > 0 && rb.Status == "DEAD" {
		s = markCrash(now, p, s)
	}
	if s.IntentionalStopLatched {
		s.LastDecision = "INTENTIONAL_STOP_HOLD"
		return Decision{Code: s.LastDecision, State: s}, nil
	}
	if s.UpdateGraceUntilUnixMS > now.UnixMilli() {
		s.LastDecision = "UPDATE_GRACE_HOLD"
		return Decision{Code: s.LastDecision, State: s}, nil
	}
	if s.FuseUntilUnixMS > now.UnixMilli() {
		s.LastDecision = "CRASH_LOOP_FUSED"
		return Decision{Code: s.LastDecision, State: s}, nil
	}
	if s.NextLaunchNotBeforeUnixMS > now.UnixMilli() {
		s.LastDecision = "BACKOFF_HOLD"
		return Decision{Code: s.LastDecision, State: s}, nil
	}

	seed := fmt.Sprintf("%s:%d:%d:%d", p.ExpectedExecutableSHA256, now.UnixNano(), s.CrashCount, s.LastHeartbeatSeq)
	sum := sha256.Sum256([]byte(seed))
	s.PendingLaunch = &LaunchIntent{IntentID: "launch_" + hex.EncodeToString(sum[:12]), CreatedAtUnixMS: now.UnixMilli()}
	s.LastDecision = "LAUNCH_ONCE_AUTHORIZED"
	return Decision{Code: s.LastDecision, LaunchAuthorized: true, State: s}, nil
}
