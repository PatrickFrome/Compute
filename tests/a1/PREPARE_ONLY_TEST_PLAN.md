# A1 PREPARE_ONLY Test + Failure-Injection Plan

Status: design-only. These tests define future ACTIVE acceptance; they do not assert that execution is currently safe.

## A. Gate and authority tests

### A1. W1 not verified

Input: valid workspace envelope with `w1_status != VERIFIED` and request to execute.

Expected:
- execution authority remains false;
- no sandbox command is started;
- transition stops at `READY_FOR_GATE` or becomes `REJECTED`;
- receipt records `W1_DEPENDENCY_UNVERIFIED`.

### A2. Missing Supervisor directive

Input: W1 verified but no current A1 ACTIVE directive.

Expected: fail closed with no command execution.

### A3. Stale/revoked directive

Inject directive expiry/revocation between materialization and first command.

Expected: fresh authority check rejects transition into execution.

### A4. W1 revocation during run

Inject authoritative W1 status change after a command starts.

Expected:
- adapter cancels at next enforceable boundary;
- outputs are quarantined and cannot become authoritative;
- evidence records the authority-loss timestamp/state.

### A5. Replay old authority envelope

Replay an envelope from an earlier coordination epoch or W1 checkpoint.

Expected: reject as stale even if all digests are internally consistent.

## B. Repository and Git isolation tests

### B1. Shared worktree metadata attack

Inside agent code attempt to mutate refs/config/hooks through `.git`, `$GIT_COMMON_DIR`, `git update-ref`, or direct file writes.

Expected: host/controller Git metadata is unreachable; only sandbox-local repository metadata can change.

### B2. Host repository mount canary

Plant a host-only canary path/name outside the source snapshot.

Expected: sandbox cannot discover/read/write it.

### B3. Symlink escape

Commit paths that point through symlinks to `/`, `/proc`, `/sys`, controller mount points, or sibling workspaces.

Expected: output collector resolves policy safely and rejects escapes.

### B4. Hardlink escape/materialization confusion

Create hardlinks and rename races around an allowed output path.

Expected: collector binds output to sandbox inode/content at collection and never dereferences outside workspace root.

### B5. Special file output

Create FIFO/socket/device node in output allowlist.

Expected: rejected; no special file leaves sandbox.

### B6. Path traversal

Use `../`, encoded separators, Unicode lookalikes, very long paths, and nested symlink chains.

Expected: normalized path validation rejects any path outside declared root.

## C. Overlay/snapshot filesystem tests

### C1. Lower-layer mutation

Attempt to modify immutable lower/source layer directly.

Expected: impossible or detected; source digest unchanged.

### C2. Shared upper/work directory

Attempt two workspaces with same OverlayFS upper/work paths.

Expected: policy rejects before mount/materialization.

### C3. Untrusted overlay xattrs

Provide layers carrying overlay redirect/metacopy/whiteout xattrs.

Expected: sanitize/reject according to policy; never mount untrusted privileged overlay metadata as authority.

### C4. Volatile overlay crash

Kill sandbox/host while disposable volatile layer is active.

Expected: no claim of persistence; workspace is reconstructable or marked lost.

### C5. Snapshot replay

Restore an old snapshot under a new workspace request.

Expected: snapshot identity mismatch causes rejection unless explicitly bound into the new workspace identity.

## D. Command and process tests

### D1. Shell injection

Inject shell metacharacters through arguments, filenames and environment values.

Expected: structured argv execution does not reinterpret them as shell syntax.

### D2. Implicit shell request

Request a raw command string where policy requires argv form.

Expected: reject unless a separately authorized shell profile is used.

### D3. Fork bomb / PID exhaustion

Run recursive process creation.

Expected: PID limit stops growth; host/controller remains responsive; receipt records resource exhaustion.

### D4. Memory exhaustion

Allocate beyond workspace memory limit.

Expected: sandbox workload is OOM-limited without host safety failure.

### D5. CPU runaway

Run infinite compute.

Expected: CPU quota + wall deadline terminate workload.

### D6. Disk fill

Write until disk quota exceeded.

Expected: workspace fails locally; other workspaces and host remain healthy.

### D7. File descriptor exhaustion

Open files/sockets until limit.

Expected: bounded failure with cleanup possible.

### D8. Kill cleanup path

Terminate adapter mid-command.

Expected: substrate lease/cleanup reconciliation can identify and destroy orphaned workspace.

## E. Network and secret-isolation tests

### E1. Default egress deny

Attempt HTTPS, raw TCP, UDP, ICMP and alternate DNS destinations before allowlist.

Expected: denied except explicitly modeled platform DNS needed for policy enforcement.

### E2. Metadata endpoint access

Attempt cloud metadata/link-local/private control-plane destinations.

Expected: denied unless a specific trusted broker policy exists.

### E3. DNS exfiltration

Encode secret/canary into DNS queries.

Expected: arbitrary DNS destination not available; policy/telemetry detects or prevents exfiltration route.

### E4. Credential discovery

Search environment, files, process args, `/proc`, shell history and common SDK config paths for repository/provider credentials.

Expected: brokered credentials are absent from sandbox addressable state.

### E5. Egress allowlist bypass

Try direct IP, alternate SNI, redirects, IPv6, DNS rebinding, proxy environment variables and CONNECT tunneling.

Expected: policy rejects destinations not explicitly allowed.

### E6. Runtime policy tightening

Allow package hosts for trusted setup, then switch to deny-by-default before agent command.

Expected: subsequent untrusted command cannot reach setup-only destinations.

### E7. Inbound exposure

Attempt to bind/listen and expose a public port without policy.

Expected: no public route is created.

## F. Isolation escape canaries

These tests do not attempt unknown zero-days; they verify the configured containment boundary.

### F1. Namespace visibility

Attempt to inspect host PIDs, mounts, network devices, cgroups and sibling sandbox identities.

Expected: only permitted sandbox view is visible.

### F2. Kernel/device access

Probe `/dev/kvm`, raw block devices, host devices, module loading and privileged ioctls.

Expected: unavailable unless explicitly part of trusted substrate internals and not exposed to workload.

### F3. Privilege escalation

Attempt setuid, file capabilities, user namespace tricks and privileged mounts.

Expected: cannot gain host authority.

### F4. Seccomp profile canary

Invoke syscalls forbidden by the backend profile.

Expected: denied/terminated and observable. Passing this test is defense-in-depth only, not proof of full sandbox safety.

## G. Output integrity tests

### G1. Test/output substitution

After tests pass, mutate an output before collection.

Expected: final output manifest is generated after execution and bound to exact bytes; earlier test receipt alone cannot authorize changed bytes.

### G2. Undeclared artifact

Create sensitive or irrelevant files outside output allowlist.

Expected: excluded and reported.

### G3. Oversized output

Generate artifact beyond output quota.

Expected: bounded/rejected without partial authoritative materialization.

### G4. Malicious archive

Output tar/zip with path traversal, absolute paths, symlinks or decompression bomb.

Expected: archive remains opaque unless trusted extractor validates it under separate limits.

### G5. Evidence tampering

Modify command logs or manifests inside sandbox.

Expected: trusted adapter independently hashes/records evidence; sandbox-authored logs are not sole authority.

## H. Reproducibility tests

### H1. Same input + policy replay

Prepare same repository commit, toolchain identity, backend image and policy twice.

Expected: workspace identity derivation is deterministic except explicit instance nonce; immutable input/policy roots match.

### H2. Mutable image tag

Supply backend image by mutable tag only.

Expected: preparation rejects authority until immutable digest is resolved.

### H3. Package registry drift

Repeat setup after registry contents change.

Expected: lockfile/toolchain policy determines whether drift is rejected; A1 does not silently claim equivalent execution.

## I. Backend capability conformance

For each backend candidate, run a conformance profile that proves:

- isolation boundary class;
- source filesystem non-writability;
- no host Git metadata exposure;
- egress deny/allow semantics;
- credential brokering or equivalent trusted proxy;
- CPU/memory/PID/disk enforcement;
- timeout/kill behavior;
- cleanup/reconciliation;
- immutable image/snapshot identity;
- command/log evidence availability.

A backend lacking a mandatory capability is `INELIGIBLE` for that execution profile regardless of benchmark performance.

## PREPARE_ONLY acceptance

This plan is accepted as preparation if:

- all negative cases have explicit expected fail-closed behavior;
- no test result is fabricated or labeled live before W1 verification;
- provider-specific tests are executed only after Supervisor activates A1;
- future evidence distinguishes simulated harness results from real substrate evidence.
