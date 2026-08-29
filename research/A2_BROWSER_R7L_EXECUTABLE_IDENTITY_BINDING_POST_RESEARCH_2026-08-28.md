# A2 Browser R7L — Executable Identity Binding — Post-Implementation Research

Date: 2026-08-29 (seal file keeps the milestone's 2026-08-28 workflow identity)

Parent verified runtime: R7K `cbdb70e9be5a99251d57a7be7d0c43a95683ebae`

Implementation candidates evaluated: R7L `afdf46c231ad2ac20c9f49b6192d421ba017e5f4` and seal head `5b54401519f6c42c985b3acac23a8fd5642c7ac2`

## Outcome

The pre-implementation decision is confirmed. The launcher now acquires the fixed helper through a confined `openat2` lookup, validates the opened object, proves the production pre-exec descriptor contract, and invokes `fexecve` on that same descriptor. The exact-head Linux trace observed `openat2` followed by `execveat(..., AT_EMPTY_PATH)` and no second pathname-based helper exec.

The implementation closes the R7K check/exec pathname race without adding a dependency or broadening helper authority. R7H Landlock, R7I descriptor/network sanitation, and R7J positive seccomp allowlisting remain in force. A post-green independent mailbox review then found that the launcher did not set `no_new_privs` until the helper installed seccomp after exec. That finding blocks promotion of `5b54401519f6c42c985b3acac23a8fd5642c7ac2` and is corrected by setting the irreversible bit after the ambient-FD cut and before helper capability acquisition.

## Primary-source recheck

- Linux `fexecve(3)` explicitly identifies pathname or directory-prefix exchange between verification and `execve(path)` as the race that descriptor-bound execution avoids. It also recommends close-on-exec for the executable descriptor and states the remaining limitation: another actor able to modify the already-open inode can still change its contents. Source: https://man7.org/linux/man-pages/man3/fexecve.3.html
- Linux `openat2(2)` defines `RESOLVE_BENEATH`, `RESOLVE_NO_SYMLINKS`, `RESOLVE_NO_MAGICLINKS`, and `RESOLVE_NO_XDEV` as fail-closed path-resolution constraints for trusted programs handling untrusted paths or directories. Source: https://man7.org/linux/man-pages/man2/openat2.2.html
- Chromium's sandbox design separates a privileged broker from restricted targets and treats transferred handles, rather than ambient pathname access, as the authority-bearing objects. R7L applies the same capability principle to helper launch while keeping the Node/browser layer outside the security boundary. Source: https://chromium.googlesource.com/chromium/src/+/HEAD/docs/design/sandbox.md
- Firecracker production guidance continues to require execution inside a jail and trusted deployment ownership/permissions. FD-bound exec complements, but does not replace, that operational trust boundary. Source: https://github.com/firecracker-microvm/firecracker/blob/main/docs/prod-host-setup.md
- Linux kernel documentation defines `no_new_privs` as irreversible, inherited across fork/clone/exec, and as preventing `execve` from gaining privileges through set-user-ID, set-group-ID, file capabilities, or an LSM relaxation. Source: https://docs.kernel.org/userspace-api/no_new_privs.html
- Linux `execve(2)` confirms that set-ID transformations and file capabilities are ignored when `no_new_privs` is set. Source: https://www.kernel.org/doc/man-pages/online/pages/man2/execve.2.html

## Evidence observed before this seal commit

- source commit: `afdf46c231ad2ac20c9f49b6192d421ba017e5f4`
- source tree: `a906e8ab93af250b5d1953a61e183e3f168b0697`
- workflow run: `33214791783`, conclusion `success`
- artifact: `9702939817`
- artifact ZIP digest: `sha256:88e680237581abae6120a24afaab38fe9f7a7aa724515e57bab7ca6fb49dcd2c`
- attested deterministic tar digest: `sha256:c1816060995889d51003588e1bbf1e923ea90c17c420d709b4bab4d047db3619`
- GitHub attestation: `43766535`
- Rekor log index: `2629641126`
- Cargo.lock digest: `ffdf4d85f832e92b20960ecdbc581103a113cf9ddfa93fa319ba124f21a3d003`
- release launcher digest: `7f3193e5545f681ea393396804fd3fba926374157ffb99032fa87c002a18b059`
- release helper digest: `fa839bed29b3dbd2709748b49206f5e3cc7adab9ace03ad3bfb153bb1ed382e9`
- Rust all-target, executable-identity, R7K launcher, R7J network-boundary, and R7H Landlock suites passed.
- JavaScript package-identity and ambient-free registry regressions passed: 16/16.

This document changes the source tree and is included in the deterministic evidence archive. Therefore the commit containing it must receive a fresh exact-head CI run, artifact digest, and attestation before authoritative promotion; the evidence above proves the evaluated implementation candidate, not this seal commit in advance.

The later exact-head run `33229455889` for seal head `5b54401519f6c42c985b3acac23a8fd5642c7ac2` also passed and produced artifact `9708001993`, but mailbox observation `OBS-R7L-1` identified the missing pre-exec `no_new_privs` boundary. Green evidence for that head is therefore necessary but not sufficient for promotion. The correction must receive its own exact-head evidence.

## Failure-driven architecture findings

The final pre-seal failure was a compile/lint failure: the isolated integration-test build considered `verify_preexec_fd_contract` unused. The correction did not suppress the lint or relax the production launcher. It added a negative contract test that calls the method under the test harness.

That test exposed an important scope distinction:

- the production launcher must see exactly stdin, stdout, stderr, plus the executable capability before `fexecve`;
- a Rust `libtest` process may legitimately own harness descriptors, so the isolated test accepts only either a clean contract or the typed fail-closed error `skill_launcher_preexec_fd_unexpected`;
- the real launcher runtime trace remains the authoritative positive proof of the exact production descriptor set.

This is stronger than forcing a mock or unit harness to imitate production process state.

## Mailbox correction decision

**DECISION:** set `rustix::thread::set_no_new_privs(true)` fail-closed after the launcher has sanitized and verified inherited descriptors, and before it opens the helper executable capability. Require both a static ordering proof and a real Linux trace proving `close_range(CLOSE_RANGE_UNSHARE) → prctl(PR_SET_NO_NEW_PRIVS, 1) → openat2(helper) → execveat(AT_EMPTY_PATH)`.

**WHY:** this closes the privilege-gain race even if an actor able to mutate the already-open inode adds set-ID bits or file capabilities between metadata revalidation and `fexecve`. It reuses the already pinned `rustix` dependency; enabling its `thread` feature adds no package and avoids a new unsafe/raw-`prctl` seam.

**REJECTED ALTERNATIVES:** retaining metadata-only rejection leaves a race; calling raw `libc::prctl` duplicates a safe pinned wrapper and enlarges audited unsafe/FFI surface; setting the bit only inside the helper is too late; importing the parallel GLM branch would reverse the stronger ambient-cut-before-acquisition invariant and mix unrelated refactors/tests into this seal.

**NEW INVARIANTS:** `NO_NEW_PRIVS_SET_AFTER_AMBIENT_CUT_AND_BEFORE_EXECUTABLE_ACQUISITION`; `NO_NEW_PRIVS_FAILURE_IS_TERMINAL`; `NO_PRIVILEGE_GAIN_THROUGH_HELPER_EXEC`; zero new dependency packages.

`no_new_privs` does not drop privileges already held by the launcher and may prevent an LSM from relaxing policy across exec; neither behavior conflicts with this dedicated unprivileged helper launcher, but privilege dropping remains a deployment responsibility and explicit non-claim.

## Alternatives after runtime evidence

| Approach | Security | Reliability | TCB size | Complexity | Supply chain | Portability | Observability | Testability | Dominant failure mode |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| metadata(path) then exec(path) | Low | Medium | Small | Low | None | High | Medium | Easy | pathname swap redirects exec |
| digest(path) then exec(path) | Low | Medium | Small | Medium | None | High | Medium | Easy | checked object differs from executed object |
| raw `execveat` syscall | High | Medium | Small | Medium | None | Linux-only | High | High | architecture/libc seam mistakes |
| confined `openat2`, pre-open NNP, plus libc `fexecve` | High | High | Small | Medium | Zero new packages | Linux/POSIX-glibc boundary | High | High | content mutation of already-open inode or untrusted installation root |
| copy into sealed `memfd` then exec | High | Medium | Larger | High | Potentially none | Linux-only | Medium | Medium | new copy/seal/parser/resource lifecycle TCB |

After the mailbox review, retaining the prior green implementation is not acceptable because pre-exec NNP has unusually high security gain per line and no new package cost. A sealed `memfd` could additionally address content mutation of a writable opened inode, but it would introduce a copy-and-seal lifecycle and remains inferior to enforcing trusted, non-writable deployment ownership at this layer.

## Confirmed invariants

- `EXECUTED_HELPER_IS_OPENED_OBJECT_NOT_RELOOKED_PATH`.
- `AMBIENT_FDS_CLOSED_BEFORE_EXECUTABLE_CAPABILITY_ACQUISITION`.
- `NO_NEW_PRIVS_SET_AFTER_AMBIENT_CUT_AND_BEFORE_EXECUTABLE_CAPABILITY_ACQUISITION`.
- `SETID_AND_FILE_CAPABILITY_GAIN_BLOCKED_ACROSS_HELPER_EXEC`.
- `FIXED_HELPER_LOOKUP_IS_OPENAT2_CONFINED`.
- `EXACTLY_ONE_NON_STDIO_EXEC_FD_BEFORE_FEXECVE` in the production launcher.
- `EXEC_FD_IS_CLOEXEC_AND_DOES_NOT_LEAK_TO_HELPER`.
- `NO_ARBITRARY_EXEC_PATH`.
- `EMPTY_INHERITED_ENVIRONMENT`.
- `TEST_HARNESS_AMBIENT_FDS_FAIL_WITH_A_TYPED_ERROR`.
- R7H/R7I/R7J/R7K defenses remain regression-gated.
- zero new dependency packages.

## Remaining weaknesses and explicit non-claims

- The initial installation-directory pathname and its ownership remain trusted deployment inputs.
- R7L cannot prevent mutation through an already-writable opened inode; installed launcher/helper binaries must not be writable by untrusted users.
- `no_new_privs` does not drop privileges the launcher already holds; an unprivileged service account remains a deployment requirement.
- Verification is Linux x86_64 only.
- No namespace, chroot, cgroup, or remote-browser-pool isolation is claimed.
- No Node/Compute Browser integration, restart policy, browser authority, network authority, or actuation authority is introduced.
- An unsigned Git commit is compensated by exact-head GitHub Actions provenance for the deterministic artifact; commit signing itself is not claimed.

## Next highest-gain hardening step

`R7M_NODE_SOURCE_ADAPTER_V1` should connect the long-lived Compute Browser daemon to the already-confined launcher/helper without transferring filesystem or executable-path authority into planner-facing code.

The adapter should have exactly two semantic operations (`listSkillNames`, `readSkillPackage`), a single outstanding request, bounded stdout/stderr and timers, explicit backpressure, no shell, a cleared/fixed environment, exact helper/launcher identity configuration, terminal handling of malformed or desynchronized frames, and no silent mid-refresh restart. It should remain a transport adapter for the R7E transactional registry rather than a new capability owner.
