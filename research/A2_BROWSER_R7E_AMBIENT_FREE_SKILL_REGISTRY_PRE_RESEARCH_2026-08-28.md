# A2 Browser Operator R7E — Daemon-owned ambient-free skill registry pre-research

Date: 2026-08-28
Scope: architecture and code constraints for the first runtime registry over R7A–R7D skill identities.

## Question

How should A2 expose installed skills to the planner without turning filesystem paths, discovery races, scripts, or package metadata into browser/execution authority?

## Best analogues reviewed

### Agent Skills progressive disclosure

Agent Skills defines a small startup metadata layer, then full `SKILL.md` instructions only after activation, then resources on demand. It also recommends one-level relative references. This is a strong fit for A2's existing R7A/R7B shape, but A2 deliberately does **not** honor the experimental `allowed-tools` declaration as authority and does not execute bundled scripts.

Source: https://agentskills.io/specification

### OCI content descriptors

OCI descriptors bind referenced content to a cryptographic digest and exact byte size, and require consumers of untrusted sources to verify those values before heavy processing. This is the right model for R7E registry entries: public descriptors identify content; raw bytes are reacquired and revalidated only on hydration.

Source: https://github.com/opencontainers/image-spec/blob/main/descriptor.md

### Linux `openat2`

Linux `openat2(2)` can constrain pathname resolution with `RESOLVE_BENEATH`, `RESOLVE_IN_ROOT`, `RESOLVE_NO_SYMLINKS`, and `RESOLVE_NO_MAGICLINKS`. In particular, `RESOLVE_NO_SYMLINKS` applies to all pathname components, while `O_NOFOLLOW` only controls the final component. This is materially stronger than `realpath()+prefix` or final-component-only checks.

Source: https://man7.org/linux/man-pages/man2/openat2.2.html

### Node filesystem primitives

Node exposes `O_NOFOLLOW` and `O_DIRECTORY`, but its normal `fs.open()` API does not expose Linux `openat2` resolution controls. Therefore a generic Node registry core should not pretend it can provide an `openat2`-equivalent confinement boundary.

Source: https://nodejs.org/api/fs.html

### Capability-oriented filesystem APIs

`cap-std` models filesystem authority as a `Dir` capability and only resolves paths relative to that capability instead of relying on a process-wide ambient namespace. This is a better target architecture for a future OS loader than passing arbitrary absolute paths through the planner/runtime stack.

Source: https://docs.rs/cap-std/latest/cap_std/fs/index.html

### Landlock

Landlock lets unprivileged Linux processes reduce their own ambient filesystem/network rights, adding restrictions on top of existing access controls. It is a useful defense-in-depth candidate for a future loader/helper, but it does not replace content identity or exact package revalidation.

Source: https://www.kernel.org/doc/html/latest/userspace-api/landlock.html

### `/proc/self/fd` rejected as the default fallback

`/proc/<pid>/fd/*` entries are magic links to kernel file handles. Linux documentation explicitly notes that magic links can bypass ordinary mount-namespace restrictions and have appeared in exploit paths. A2 therefore does not use `/proc/self/fd` as a substitute for a proper capability/openat2 loader.

Sources:
- https://man7.org/linux/man-pages/man5/proc_pid_fd.5.html
- https://man7.org/linux/man-pages/man7/symlink.7.html

## Architecture decision

R7E is an **ambient-filesystem-free registry core**.

It receives exactly two daemon-owned adapter functions:

1. `listSkillNames()`
2. `readSkillPackage(name)`

The adapter returns package bytes. R7E itself imports no filesystem APIs, accepts no absolute path, publishes no source locator, and exposes no raw package body in its registry snapshot.

The future OS-specific source adapter is a separate trust boundary. On Linux, the preferred implementation target is a true `openat2`/capability-style loader rather than `realpath()+startsWith()` or `/proc/self/fd` traversal.

## R7E invariants

1. **Metadata-only public registry** — only name, description, semantic fingerprint, raw package digest, package size/count, and opaque semantic skill ref are published.
2. **Exact raw package binding** — every registry entry carries the R7C `package_manifest_digest`; resource-only changes rotate registry identity even when `SKILL.md` semantics stay the same.
3. **Fresh hydration** — instructions are never returned from the registry snapshot. The package is reacquired and R7C-revalidated before R7A instruction hydration.
4. **Transactional refresh** — a malformed/missing package cannot partially replace the currently published registry snapshot.
5. **Singleflight refresh** — concurrent refresh requests share one source scan.
6. **Sequential source reads** — refresh intentionally avoids `Promise.all` across up to 128 packages, bounding transient memory and avoiding source-adapter stampedes.
7. **Snapshot-once boundary** — external package file fields and bytes are copied once before identity/semantic compilation, preserving the R7AB anti-getter/TOCTOU invariant.
8. **Causal postflight fence** — hydration rejects if the registry fingerprint rotates while fresh package work is in flight.
9. **No trust amplification** — `provenance_verified=false` until R7D is explicitly composed by a later daemon layer; registry membership itself never means provenance passed.
10. **No authority amplification** — registry snapshot and hydration both keep `authority_effect=false`, `execution_eligible=false`, and `script_execution_exposed=false`.

## Comparison summary

| System / primitive | Useful property | A2 R7E choice |
| --- | --- | --- |
| Agent Skills | Progressive disclosure | Preserve metadata → instructions; keep scripts inert |
| OCI descriptors | Digest + raw size descriptors | Bind registry to exact R7C package digest |
| Node `O_NOFOLLOW` | Final-component symlink refusal | Insufficient as registry confinement proof |
| Linux `openat2` | Whole-resolution confinement | Preferred future Linux loader primitive |
| cap-std | Directory capabilities, no ambient paths | Preferred architectural model for source adapter |
| Landlock | Process self-restriction | Future defense in depth |
| `/proc/self/fd` | Stable handle-like magic link | Explicitly rejected as default security fallback |

## Deferred to the next layer

R7E does not scan a real directory and does not execute any file. The next source-adapter milestone should evaluate:

- Linux `openat2` helper or a Rust `cap-std` adapter;
- optional Landlock restriction after trusted bootstrap;
- exact regular-file checks and byte-size limits before reads;
- no symlink or magic-link fallback;
- OS portability strategy that fails closed when the required confinement primitive is unavailable.
