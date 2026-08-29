# A2 Browser Operator R7F — Linux openat2 capability source pre-research

Date: 2026-08-28
Scope: first real filesystem source boundary feeding the ambient-free R7E registry.

## Goal

Read installed Agent Skills packages from one operator-configured Linux directory without exposing the Node/browser runtime to ambient filesystem paths, symlink traversal, magic links, mount crossings, unbounded files, or script execution.

## Best analogues

### Linux `openat2`

`openat2(2)` is the strongest directly applicable Linux primitive. A directory fd can be treated as a capability root while `RESOLVE_BENEATH` prevents lexical/path resolution escape, `RESOLVE_NO_SYMLINKS` rejects symlinks in every pathname component, `RESOLVE_NO_MAGICLINKS` explicitly rejects procfs-style magic links, and `RESOLVE_NO_XDEV` rejects mount-point crossings.

Source: https://man7.org/linux/man-pages/man2/openat2.2.html

### rustix 1.1.4

`rustix::fs::openat2` exposes Linux `openat2` with I/O-safety types (`OwnedFd`/`AsFd`) instead of raw integer fds. `rustix` intentionally does not silently emulate `openat2`; callers must handle `ENOSYS`, which matches A2's fail-closed requirement.

Sources:
- https://docs.rs/rustix/latest/rustix/fs/fn.openat2.html
- https://docs.rs/rustix/latest/rustix/fs/struct.ResolveFlags.html
- https://docs.rs/crate/rustix/latest

### cap-std

`cap-std::fs::Dir` models an already-open directory as a capability and forces subsequent paths to be relative to that capability. This is the right architectural model, but R7F needs a stricter explicit policy: no symlinks or magic links anywhere and no mount crossings. Therefore R7F uses `openat2` directly while retaining cap-std's “ambient authority crosses once” design principle.

Sources:
- https://docs.rs/cap-std/latest/cap_std/fs/
- https://docs.rs/cap-std/latest/cap_std/fs/struct.Dir.html

### WASI / Wasmtime preopened directories

WASI starts with no filesystem access and grants explicit directory capabilities through preopens. Wasmtime documents that a preopened directory grants access only to that directory subtree and can be read-only. R7F mirrors this shape: the helper gets one configured root capability and no arbitrary pathname API.

Sources:
- https://docs.wasmtime.dev/security.html
- https://docs.wasmtime.dev/c-api/wasi_8h.html

### Chromium broker model

Chromium separates privileged resource operations into a broker controlled by policy; sandboxed targets request only approved actions. The critical lesson is not Chromium's exact IPC, but TCB minimization: filesystem authority belongs in a small boundary rather than every consumer. R7F is the filesystem-side broker for R7E, and it exposes only skill listing/package reads.

Source: https://chromium.googlesource.com/chromium/src/+/main/docs/design/sandbox.md

### Landlock 0.4.7

Landlock lets an unprivileged process irreversibly reduce its own ambient filesystem rights. It is a strong defense-in-depth option for the later standalone helper process, but applying Landlock inside a reusable library would unexpectedly restrict the host process. R7F therefore does not apply Landlock yet; that belongs in the process wrapper milestone.

Source: https://docs.rs/landlock/latest/landlock/

## Architecture decision

R7F is a Linux-only read-only source library in a new Rust crate:

`coordination/browser-skill-source-linux/`

The trusted bootstrap may use ambient authority exactly once to open the operator-configured root directory. The configured root itself must not be a symlink. After that point:

- skill directories are opened with `openat2(root_fd, skill_name, ...)`;
- resource directories and files are opened relative to already-open directory fds;
- every untrusted lookup uses `RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS | RESOLVE_NO_XDEV`;
- `ENOSYS` means the loader is unavailable; there is no `openat`, `realpath`, `/proc/self/fd`, or lexical-prefix fallback;
- files are read only from opened fds, never by reconstructing host paths.

## Package policy

R7F deliberately matches the existing R7C package shape:

- max 128 skills;
- `SKILL.md` plus at most 64 files under one-level `references/`, `assets/`, `scripts/`;
- `SKILL.md` <= 96 KiB;
- resource file <= 256 KiB;
- package <= 2 MiB + 96 KiB;
- filenames ASCII and bounded exactly like R7C;
- unknown package-root entries fail closed;
- directories inside resource directories fail closed;
- scripts are only returned as bytes + executable metadata; no execution API exists.

## Additional hardening beyond path confinement

### Hard links

Path confinement does not stop a directory entry from being a hard link to an inode also reachable elsewhere. R7F rejects regular files with `nlink != 1`. This is intentionally stricter than common package loaders and prevents a class of cross-tree aliasing where a writable skill installation directory could link to another readable inode.

### Mutation during read

Opening by fd eliminates rename/symlink TOCTOU after resolution, but another writer can still modify the opened inode. R7F:

1. captures fd metadata before read;
2. enforces size/type/link limits;
3. performs a bounded read;
4. rechecks inode/device/size/mtime/ctime;
5. seeks to the start and performs one bounded verification read;
6. requires byte-for-byte equality and unchanged metadata.

This doubles source I/O but the package is already bounded to roughly 2.1 MiB, so the cost is acceptable at this trust boundary.

## Supply-chain decision

This repository did not previously contain Rust. R7F introduces exactly one direct crate dependency:

- `rustix = 1.1.4`, exact-pinned.

CI generates `Cargo.lock`, runs with `--locked`, records `cargo tree`, and includes the generated lockfile in evidence. After the first green build, the generated lockfile should be promoted into source in a follow-up hardening commit so future builds do not require dependency re-resolution.

## Explicit non-goals

R7F does not:

- execute a skill script;
- verify skill provenance (R7D owns that concern);
- grant browser/tool authority;
- expose a network API;
- accept arbitrary file paths from the planner;
- apply Landlock to the current Node daemon;
- integrate IPC into Node yet.

The next step after R7F green is a narrow process protocol / Node source adapter, ideally with the helper process itself Landlock-restricted after root bootstrap.
