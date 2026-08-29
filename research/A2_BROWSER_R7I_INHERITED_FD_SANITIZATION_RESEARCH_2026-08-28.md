# A2 Browser R7I — Inherited FD Sanitization Research

Date: 2026-08-28
Trigger: exact-head candidate `72b8dec1c9d8eb5be191219a6c54625adf81c7cf` exposed extra inherited descriptors under ordinary Cargo `Command` process tests.

## Observed failure

The initial R7I policy rejected every descriptor above stderr before opening the skill root. That policy was intentionally fail-closed, but real `std::process::Command` launches under the test harness reached the helper with descriptors above 2. All four pre-existing R7G helper process tests therefore failed at the launch gate before protocol parsing.

This is not evidence that R7G or R7H regressed. It is evidence that the assumption “an ordinary parent process will always exec the helper with only fd 0/1/2 open” is too strong for a production launcher contract.

## Linux primitive

Linux `close_range(2)` is designed for this boundary. The current Linux man page explicitly recommends:

- close every fd from 3 through the maximum before exec;
- use `CLOSE_RANGE_UNSHARE` to detach the fd table first and avoid races with other threads sharing it;
- prefer this single kernel operation over enumerating `/proc/self/fd` and closing entries one by one.

R7H already hard-requires a much newer kernel capability than the Linux 5.9 baseline that introduced `close_range`, so requiring `close_range` does not materially increase the kernel floor of this helper line.

## Comparison with production sandboxes

### Firecracker jailer

The Firecracker jailer explicitly closes all inherited file descriptors except stdin/stdout/stderr before constructing the jail. This confirms that inherited-fd hygiene is a launcher responsibility, not an optional diagnostic check.

### Chromium

Chromium’s Linux sandbox tracks descriptors that must be closed around sandbox initialization and treats descriptor lifetime as part of the sandbox boundary. Its layered model also initializes the strongest sandbox while the process is single-threaded.

### Existing Rust pattern

`agent-bridle-fdguard` independently converges on the same design: one narrow unsafe seam wraps Linux `close_range` so callers can keep the surrounding Rust safe and fail closed if sanitization cannot be installed. It uses the primitive specifically because relying on CLOEXEC conventions is insufficient for an ambient-authority boundary.

Adding this young helper crate to A2 would increase supply-chain surface for a one-syscall wrapper, so R7I should not depend on it. We already exact-pin `libc=0.2.189`; `libc` exposes `CLOSE_RANGE_UNSHARE` and the Linux syscall number. A tiny locally audited scalar-only syscall wrapper is a smaller TCB.

## Revised R7I design

Replace **reject-before-sanitize** with **sanitize-then-verify**:

1. Parse only the single root argument; do not open the root yet.
2. Call Linux `close_range(3, UINT_MAX, CLOSE_RANGE_UNSHARE)` through one documented unsafe syscall seam.
3. Fail closed if the syscall fails.
4. Verify through `/proc/self/fd` that no descriptor above 2 remains after the sanitization call, allowing only the temporary descriptor opened by the verification scan itself.
5. Open the R7F root capability.
6. Install R7H Landlock.
7. Install R7I TSYNC Seccomp-BPF network/io_uring deny boundary.
8. Enter R7G IPC loop.

The helper therefore tolerates a sloppy parent only by destroying the ambient capabilities itself before it observes any untrusted IPC or opens its delegated root capability.

## Unsafe boundary

The implementation may contain exactly one explicit unsafe block in `launch_contract.rs`, wrapping `libc::syscall(SYS_close_range, ...)` with scalar arguments only. No pointers, borrowed memory, aliasing, or lifetime assumptions cross the boundary.

CI must enforce:

- exactly one `unsafe {` in `launch_contract.rs`;
- no unsafe blocks in `syscall_sandbox.rs` or the helper binary;
- the close-range call precedes root open;
- verification follows close-range and precedes root open.

## Updated adversarial proof

A child deliberately launched with non-CLOEXEC fd 9 must now **succeed**, because R7I sanitizes that capability before root acquisition. The test must still prove a normal R7G request receives a correct response after sanitization. This is stronger and more deployable than merely rejecting the process.

A separate unit/process probe should additionally confirm that the fd does not survive into post-bootstrap execution; however no filesystem target or descriptor number should be exposed in production errors.

## Remaining boundary

Self-sanitization starts at helper `main`, not in a pre-exec parent hook. A future Node launcher can move the same primitive into a pre-exec seam for an even earlier cut of ambient authority. That future launcher should preserve only stdio (or an explicit IPC fd allowlist), then exec the helper. R7I’s self-sanitization remains defense in depth.

This correction does not change the seccomp claim: R7I is a network/io_uring deny boundary, not a complete syscall allowlist and not a network namespace.