# A2 Browser R7K — Pre-Exec Helper Launcher — Post-Implementation Research

Date: 2026-08-28
Parent verified runtime: R7J `efb3af6bad80b7efcccdeba24be9daef26eddb3d`
Candidate before final research seal: `00c9e92719f9de30554861d629c7c067799b39a9`
Candidate verification run: `33211924438`
Candidate artifact: `9701925693`

## Result

The dedicated launcher architecture works on the real Linux runner and moves the ambient authority cut ahead of the helper executable.

The release trace proved this exact order:

1. launcher `execve` — trace line 1;
2. launcher `close_range(3, ..., CLOSE_RANGE_UNSHARE)` — trace line 2;
3. real helper `execve` — trace line 3;
4. helper defense-in-depth `close_range(3, ..., CLOSE_RANGE_UNSHARE)` — trace line 4.

This is materially stronger than relying only on the helper's first instruction sequence: a separately built unsanitized fake sibling helper also passed an adversarial test in which the parent deliberately supplied fd 9 and an environment sentinel. The fake helper observed neither capability. That proof is independent of the real helper's R7I sanitation.

## What real verification changed

### The architecture assumption was confirmed

Linux documents `close_range(..., CLOSE_RANGE_UNSHARE)` followed by exec as the direct way to ensure descriptors above stderr do not survive into a new process image. R7K now demonstrates that ordering on the exact release binaries rather than merely following documentation.

Firecracker's jailer uses the same architectural direction: put ambient-process cleanup in a separate launcher/jailer before executing the confined workload. R7K adopts only the small capability-cut part, not the VM/namespace-sized jailer TCB.

### `CommandExt::pre_exec` remains the wrong integration boundary

The successful sibling launcher removes the main argument for a future post-fork `pre_exec` callback inside a multithreaded Node/daemon process. Rust documents that callback as unsafe and restricts what can safely happen after fork. A normal single-purpose launcher is easier to audit and test.

### CI failures were evidence-process failures, not architecture failures

The first two R7K runs stopped at `cargo fmt --check` because the new integration test file was not exactly rustfmt-formatted. No compilation/runtime/security gate had failed. The fixes changed only layout and preserved all assertions and launcher code. The third exact-head run then passed compile, lint, adversarial tests, real release tracing, regressions, deterministic evidence, Sigstore provenance, and upload.

## Candidate-green evidence

At `00c9e92719f9de30554861d629c7c067799b39a9`, GitHub Actions run `33211924438` passed:

- Linux x86_64 and Rust 1.98.0 target gate;
- exact unchanged Cargo.lock and 19-entry lock package closure;
- static fixed-sibling/pre-exec ordering contract;
- `cargo fmt --check`;
- `cargo clippy --locked --all-targets -- -D warnings`;
- all Rust unit/integration/adversarial tests;
- 4/4 focused launcher tests;
- inherited R7J positive-seccomp tests;
- inherited Landlock tests;
- release launcher + helper build;
- unsanitized fake-helper fd/environment cut proof;
- real release `execve`/`close_range` ordering proof;
- R7 package identity and registry JS regressions 16/16;
- deterministic evidence build;
- Sigstore build provenance;
- artifact upload.

Candidate release launcher SHA-256: `4f7659d1c1cde7cbf1acfe41e17701b2672f1ac724c8da55de759de068a73272`.

Candidate launcher size: 374,784 bytes.

Helper SHA-256 is unchanged from R7J: `fa839bed29b3dbd2709748b49206f5e3cc7adab9ace03ad3bfb153bb1ed382e9`.

Helper size remains 429,104 bytes.

Cargo.lock SHA-256 remains `ffdf4d85f832e92b20960ecdbc581103a113cf9ddfa93fa319ba124f21a3d003`.

Candidate artifact ZIP digest: `sha256:0aecb24df21af6ebe40452f278d6cd63c320fad5b87e34d7d26ede0f1744b0d3`.

Candidate attested tar digest: `sha256:6bc267640ce8e14319f2742600e1b89eeaa2de9a3824e9916352fc079877953d`.

Candidate GitHub attestation id: `43760005`; Rekor log index: `2629040606`.

## Comparison after implementation

### Linux close_range

The runtime proof matches the Linux manual's recommended `close_range(3, ~0U, CLOSE_RANGE_UNSHARE)` then `execve` pattern. R7K additionally performs an independent `/proc/self/fd` postcondition check before exec, retaining R7I's verify-after-sanitize separation.

### Firecracker jailer

R7K now resembles the smallest useful Firecracker jailer invariant: a single-purpose launcher closes ambient descriptors and clears inherited environment before exec. It intentionally does not import cgroups, namespace setup, chroot, privilege dropping, or VM-specific policy because the skill helper already has narrow read-only authority, Landlock, openat2 confinement, and a 14-syscall seccomp policy.

### Chromium

Chromium's multi-process sandbox/broker model remains stronger for renderer-sized hostile workloads, but R7K's dedicated tiny launcher is more auditable for this narrowly scoped helper. No browser authority moves into the launcher.

### Rust pre_exec

R7K confirms that `pre_exec` is unnecessary here. Keeping security-sensitive setup in normal single-threaded process code avoids the post-fork async-signal-safety restrictions documented by Rust.

## New security claims after final exact-head seal

R7K may claim, for the pinned Linux x86_64 build:

- ambient descriptors >=3 are cut by the launcher before the helper executable starts;
- the cut uses `CLOSE_RANGE_UNSHARE` and is independently verified before exec;
- inherited environment is cleared before helper exec;
- the launcher accepts no arbitrary executable path and targets only a fixed sibling helper name;
- symlink, missing, non-regular, and non-executable siblings fail closed;
- the helper retains its own descriptor sanitation after exec;
- R7J positive seccomp, R7H Landlock, R7F openat2 confinement, and bounded R7G IPC remain green;
- no new dependency package is added;
- no Node integration, browser authority, actuation authority, or network authority is introduced.

## Explicit non-claims / remaining weaknesses

- the sibling executable is still selected by pathname at exec time;
- `symlink_metadata` / regular-file / executable checks do not bind the later exec to the exact inode that was inspected;
- therefore an actor who can mutate the launcher's installation directory between check and exec is outside R7K's proved boundary;
- R7K does not prove install-directory ownership or non-writability by untrusted local users;
- no namespace/chroot/cgroup isolation is added;
- no cross-architecture proof is made;
- no Node/daemon lifecycle or restart policy is integrated yet.

## Post-research: executable identity is the next highest-value gap

Linux `execveat(fd, "", ..., AT_EMPTY_PATH)` can execute the object referenced by an already-open descriptor, including a descriptor obtained with `O_PATH`. `fexecve` similarly executes by file descriptor instead of pathname. This gives a direct way to remove the check/exec pathname race.

Firecracker production guidance makes the complementary operational point: the jailer's exec paths and their parent directories are trusted inputs and must not be writable by unprivileged users.

## Next milestone decision

`R7L_EXECUTABLE_IDENTITY_BINDING_V1` should precede Node integration.

Expected slice:

1. open the fixed sibling executable once through a confined directory-relative path;
2. reject symlink/mount/path escapes and capture exact inode/device/mode identity;
3. execute the already-open object with `execveat(..., AT_EMPTY_PATH)` or a rigorously justified equivalent;
4. preserve the executable fd while closing every unrelated descriptor, then ensure it does not leak into the final helper beyond exec semantics;
5. keep an empty inherited environment and exact root argv contract;
6. prove an adversarial rename/swap after open cannot redirect execution;
7. avoid accepting any caller-supplied executable identity;
8. keep Node/browser integration out of the slice.

This is a smaller and more direct hardening step than introducing namespaces, while closing the one concrete R7K TOCTOU boundary discovered by post-research.

Only after R7L is sealed should the long-lived Node/Compute Browser daemon be connected to the launcher/helper protocol.
