# Installed package-code binding: W68/W77 v2

Status: **SOURCE / STAGING qualified; installed/native authority remains HOLD.**
Canonical milestone: C2 safe execution / existing client Owner and release-custody gates.
This change does not install, publish, sign a production release, create a key,
claim native Guardian readiness, or replace the existing release root.

## Finding and packaging trace

The previous W68 release-root signature bound the installed EXE and installer /
SLSA sidecar hashes. It did not bind `resources/app.asar`, unpacked workers or
the rest of the packaged runtime. An unchanged signed Electron EXE alone is
not an authentication of the JavaScript being executed.

`apps/metaengine-browser/electron-builder.test.json` selects ASAR and the
embedded-integrity / ASAR-only fuses. It also unpacks five CJS workers and copies
MCP / PowerShell code, client-state runtime, Guardian and bootstrap binaries,
DevOS snapshot, browser-compute/shared code, daemon, UI and UI dependencies into
`extraResources`. Electron's root DLLs, snapshots and locales are outside ASAR.
An app.asar-only hash would still leave these runtime inputs unbound.

## Producer and consumer contract

1. The configured Windows `afterAllArtifactBuild` hook now **unconditionally**
   invokes `writePackagedCodeInventoryW77` after its existing trust-root,
   bootstrap, offline-runtime and ASAR fuse checks. There is no optional
   environment flag or injected signer.
2. The producer walks the final `win-unpacked` tree and records every physical
   file's relative path, byte length and SHA-256, and every directory. The EXE,
   app.asar, unpacked files, all extraResources and Electron runtime files are
   included. Output is deterministic and bounded; hashing streams through one
   file descriptor rather than loading the runtime tree into memory.
   Under Electron it uses `original-fs.promises` for physical ASAR bytes, never
   virtual archive members, a global `process.noAsar` toggle, or a fallback to
   patched filesystem operations.
   This follows Electron's [documented physical-ASAR access contract](https://www.electronjs.org/docs/latest/tutorial/asar-archives).
3. `dist-test/metaengine-installed-package-code.v1.json` is written outside the
   packaged tree, with exclusive creation and byte readback. The existing
   candidate/evidence upload lists retain a byte-checked `RUNNER_TEMP` copy,
   preserving the existing candidate artifact's top-level sibling layout.
   It is **unsigned manifest data**,
   not a new attestation or release proof. The immutable final installer is not
   rewritten to contain its own digest or a circular sidecar.
4. W77's existing independently verified-input preflight requires that exact
   inventory at the candidate root and checks it against the observed packaged
   tree, including a final path/identity fence after the GH/AuthentiCode reads.
   It returns the inventory bytes and digest but still cannot sign or install.
5. The existing release manifest gains `package_code_sha256`. Envelope schema,
   manifest schema and signature domain move to **v2**, and its fixed sibling
   filename becomes `metaengine-installed-release-proof.v2.json`. The inventory
   is a fourth fixed sidecar. The same existing packaged Ed25519 public root is
   used; no new trust root or credential is introduced.
6. W68 verifies the root signature and inventory byte digest, then rewalks and
   hashes the installed tree. Exact inventory equality rejects modifications,
   missing entries and extra code, including `resources/app` fallback. It
   preserves the two native EXE observations and performs a final tree fence.
7. W60, W52, W44 and W74 now require the code-binding flag and digest. W52 also
   compares the code digest across its two observations. A v1 signature or
   legacy EXE-only receipt cannot silently acquire v2 authority.

No fallback to the old envelope is supported. Custody must produce and place
new authenticated v2 sidecars; copying or relabeling old JSON is not migration.

## Filesystem boundary

All roots must be canonical absolute local paths. Every ancestor, directory and
file is checked by `lstat` and canonical `realpath`; symlink/junction aliases,
hardlinked files, nonregular files, casefold collisions, path traversal,
Windows device names, alternate-stream path syntax and trailing-dot/space
aliases are rejected. Open-descriptor identity and before/after pathname stats
include inode/device, size, link count and nanosecond modification/change/birth
timestamps. The final fence rechecks every observed entry after the second
native EXE observation. Depth, entry count, bytes and manifest size are bounded.

The only installed-only exclusions are the four fixed detached proof files and
the existing fixed NSIS filename `Uninstall METAENGINE Browser Test.exe`.
Exclusions cannot be directories or aliases. Proof sidecars are independently
signature/digest checked. The uninstaller is generated outside `win-unpacked`
and is **not authenticated by this running-app inventory**; this proof must not
authorize executing it. There are no extension or directory exclusions.

## Remaining HOLDs and nonclaims

- `EXISTING_PROTECTED_RELEASE_ROOT_SIGNING_CAPABILITY_NOT_WIRED`: no existing
  callable protected signing interface was found or invoked.
- `EXTERNAL_SIDECAR_INSTALLED_PLACEMENT_UNPROVEN`: ordinary packaging produces
  data, not authenticated installed placement. The NSIS installer remains
  immutable and has not been executed here.
- `IMMUTABLE_VERIFIED_GH_ARTIFACT_BYTES_HANDOFF_NOT_WIRED`: retaining the inventory
  as an artifact is not independent proof of its relationship to an extracted
  final installer. Existing release custody must validate that handoff.
- On-disk equality is not proof of already-loaded code, prevention of future
  filesystem writes, or authentication of a self-reporting JavaScript process.
  W68 still acquires its root through `app.asar/package.json` and executes its
  verifier in JavaScript; a modified verifier/root cannot independently attest
  itself. Root acquisition and verifier execution must therefore be anchored
  independently by the native bridge. Existing downstream checks here consume
  an incremental on-disk predicate, not an independent native trust decision.
  W68 explicitly returns `loaded_runtime_code_attested: false`. The future
  independent native Guardian bridge must enforce that boundary and bind loaded
  code/launch custody; it remains blocked even if signing and sidecar placement
  are subsequently provided. Those two capabilities alone must not clear HOLD.
- Disposable Ed25519 fixture signatures are STAGING only. They are not installed
  proof, real release keys, or independently verified SLSA evidence.

## Source verification

Focused and adjacent regressions cover v2 signing/verification, genuine fixture
Ed25519 v1 rejection, ASAR/worker/native-resource/DLL tampering, missing/extra
code, same-length late mutations, swapped directories, hardlinks, aliases,
canonical serialization, producer overwrite/missing-inventory refusal, ordinary
hook wiring, and legacy downstream receipt rejection.

Final Linux / Node v24.22.1 checks: **189 passed, 1 Windows-only skip, 0 failed**
across 190 release-proof, downstream Owner, installer, source-closure, offline
resource and ASAR packaging tests; **243 source syntax checks passed**. Changed
workflow YAML parses and `git diff --check` passes. Already-cached ASAR and
Postgres test dependencies were copied into the isolated worktree; the frozen
candidate was not modified. Independent source/staging review found and closed
physical-ASAR access, case-variant entrypoint and candidate-artifact-root issues.

No npm/bun bulk audit request, package-manager installation, native machine install,
publication, or protected signing action is part of these checks. Windows
physical packaging and native loaded-image qualification remain unexecuted.
