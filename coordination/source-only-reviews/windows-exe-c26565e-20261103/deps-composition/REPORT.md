# METAENGINE: bounded DEPS and hook composition

Implemented a deterministic source-only inventory from fixed Electron/Chromium
DEPS and Chromium Git tree metadata. The production builder consumes only fixed
Git-object inputs for diagnostic composition reasons and always stops before
staging/GN/receipt/publication. Full composition remains **HOLD**.

## Deliverables and exact source bases

- `deps-composition-incremental.patch` applies to our previous producer tree
  `000067a7f03f1541aa7a0b715842d73042d82e30` (the parent integrated that stage as
  `763518553441dae1dcb620820ffcf25283d071a1`).
  SHA256 `715c3d0b41a0ac279d078e5e822338c33cb81c6c2c2e5ddf6b54d729e52a719d`.
- `metaengine-c26565e-deps-combined.patch` is an alternative directly against
  original verified archive tree `2dbe253e97379532f6f4b52ef7edf26109a9266d` / source revision
  `c26565e58ab92dcbcda9663c4d231bdf4a9a7ee6`.
  SHA256 `c21b5df22f575d573d53f0e93be277e83326c278eda5adda1284df27b7176824`.
- Both paths passed index-aware clean apply and produce tree
  `2d268fbb87d7974a53095cde68f98c1d1fe0c3f5`. Apply exactly one path, never both.
- `DEPS_COMPOSITION.md` describes interfaces and exact next producers;
  `verification.json`, `clean-apply-proof.json`, raw inventories, hash manifest
  and independent reviews preserve supporting evidence.

The original transfer remains commit
`accb28e72c87c059e780efb8e6681886b33e9b4f`, parts00/01/02, archive SHA256
`4200e492828dbb857aaa737a7ce56d0aeda3c97c84f7743b1501ef2f229d3636`.
The original archive and previous incremental patches are not re-applied here.
No new executable or package is claimed.

## What is now independently checkable

The parser authenticates both exact DEPS Git blobs and SHA256 values. It uses
restricted AST/data handling, never Python eval/exec/import on upstream files.
Duplicate keys, statements, unpacking, unknown expression forms and unsafe
condition code refuse. Condition substitutions stay literal data. Parent
precedence conflicts and string/host ambiguities remain explicit unknowns.
Canonical manifest verification rederives bytes and refuses edited omissions,
selections, revisions or fabricated qualification flags.

Chromium `git_dependencies='SYNC'` revisions come from the fixed Merkle root
`63b2edfe4c6ae23d2fd3424cde3e529db49f7068`. All 43,092 raw tree objects
(29,623,918 bytes) were hashed; 270 Gitlinks agree with an independent traversal.
The packet is metadata only, not full source blobs or nested physical inputs.
`chromium-tree-objects.tar.gz` is supplied separately for reproducible readback;
its files are data and must not be executed.

The complete top-level inventory has 452 dependency rows: 278 Git, 144 CIPD, 30 GCS;
185 candidate selected, 257 excluded, 10 unresolved under a **declared native
Windows x64 initial-sync** profile. It retains 77 hooks (22 selected, 54 excluded,
1 unresolved), ten recursion declarations, variables and semantic DEPS fields.
These are top-level declaration counts, not recursive closure or an observed
operational gclient context. Four CIPD `version_file` records are preserved but
excluded under this candidate profile; they are not reported as active blockers.

The hook inventory rederives the DEPS input and covers all 22 selected plus the
unresolved hook, by source/phase/ordinal. It matched 34 known base script/spec
blobs against a fixed catalog, preserving the exact upstream-base phase.
Changed supplied files refuse; missing files stay missing. No source script
was imported or executed. GCS descriptors retain hash/size/generation; CIPD
instance syntax is distinguished from tags; three Electron PGO state digests
and the base 41-byte Siso literal are preserved as data. A source-selected GCS
byte comparator never grants extraction, execution or build authority.

## Actual checks

| Check | Result |
| --- | --- |
| DEPS parser/models including local fixed-object helper |17 PASS|
| Hook contracts with authenticated byte capture |14 PASS|
| Independent hook tests and supplemental probes |14 PASS +4 PASS|
| Hook contracts without optional capture |9 PASS,5 explicit SKIP|
| Wrapper guards/regressions |25 PASS|
| Independent DEPS negatives |17 PASS|
| Independent fixed-object/helper guards |6 PASS|
| Existing component policy regressions |17 PASS|
| Existing package/PE Node regressions |66 PASS,5 explicit SKIP|
| Browser source checks |292 PASS|
| New parser on clean combined-patch checkout |17 PASS|
| Fixed-source DEPS CLI |exit 0 inventory written, HOLD|
| Fixed-source hook CLI |exit1 with JSON HOLD, empty stderr|
| Incremental and combined clean apply |same exact result tree|
| Windows compilation/packaging/installation |NOT RUN|

Groups overlap and are not additive. Independent review logs are retained
separately; the hook tests use captured upstream files as data only. The five
optional fixture skips are not Windows passes. No dependency or client install,
DB/service change, source hook, SDK, unknown downloaded script, or Windows EXE
was run. No release/production receipt was emitted. No trust root or guard was
weakened. Existing PE admission still requires exact whole-image equality.

## Specific missing evidence and next producers

1. **Bootstrap and phase:** actual depot_tools/gclient/CIPD client and host
   interpreter byte identities, their imports, exact `.gclient`/solution spec,
   custom_vars/custom_deps, host/target/CIPD platform and phase are absent.
   The nested depot_tools source pin
   `38c391feba5fb96812f9028da12413ffc39df394` is real but does not authenticate
   the initial external controller. Pinned Electron CI installs build-tools
   `3bf7c9f543348c03b7a0f2e265dd352d0f61c1ab`, then updates depot_tools without
   recording its final commit. Bind that actual controller; do not guess HEAD.
2. **Semantics and recursion:** reconcile three parent conflicts
   checkout_clang_tidy/openxr/generate_location_tags, seven benchmark conditions
   with string-valued checkout_configuration, and two bare-mac Swift conditions
   against the fixed actual interpreter/spec. Resolve the ten recursion
   declarations, then acquire/derive every enabled immutable recursive DEPS
   and transitive hook boundary. Excluded/private roots are not auto-fetched.
   Derive Electron-patched DEPS/hook sources across all 19 patch repositories;
   current catalog membership is base-phase only.
3. **CIPD:** resolve every enabled request to concrete package instance and
   authenticate package/file membership, rather than trusting a version tag.
   Examples: gn/gn/windows-amd64 at
   git_revision:641ace93dd9560e75e7add0d08f77b446fbb3b78;
   infra/3pp/tools/ninja/windows-amd64 at version:3@1.12.1.chromium.4;
   build/siso/windows-amd64 at
   git_revision:7bc9a0bfe050ef97e1712ff61c6f11952799e951.
   vpython/Python/wheel bootstrap and platform expansion remain unqualified.
4. **Payloads:** fixed Windows Clang/Rust/libclang GCS SHA256+size+generation
   declarations exist, and Clang-tidy has the same strong declaration with
   unresolved selection. Supply exact bytes and independently derive safe
   extraction/member/physical identity; do not label existing pins missing.
   Electron's Windows hook also needs both x64 and ARM64 PGO payloads plus V8
   builtins. Their three checked-in SHA256 values are retained in inventory.
5. **SDK/tools:** `TOOLCHAIN_HASH=e66617bc68`, SDK 10.0.26100.0 is a selector,
   not a complete SDK payload SHA256/membership proof. Produce exact
   VS/SDK/UCRT/WDK/runtime bytes and host Python/Node/Git/GN/ninja identities.
   Target Node source does not authenticate PATH Node used by Yarn. The inventory
   records known Windows-case-insensitive override keys. A separate explicit
   checker refuses them even when empty; neither check completely qualifies
   the environment.
6. **Generated inputs:** derive output namespaces and exact bytes for
   mtime/patch handling, Yarn/lock/cache outputs, SDK setup, landmines and
   history/version metadata, reclient/siso, tast templates and recursive hooks.
   Bind source/import/subprocess/environment/platform effects, newline/mode
   representation and custody. A hook may exit 0 with a missing repository;
   status alone is never evidence. The pure base Siso literal does not prove
   the actual patched phase or filesystem output.

Only a producer covering all these inputs and final physical readback can
replace the composition guard. Release trust, PE transformed-image proof,
Windows qualification and nonstandard-system-root support remain separate
outstanding gates from earlier review; this phase does not assert they passed.

## Access and publication state

This phase's official GitHub Git acquisition of fixed tree metadata succeeded.
Earlier CONNECT403-denied Gitiles/API/header routes were not retried or bypassed.
No operational sync/build was attempted: that is evidence HOLD, not permission
pending or an uncertain side effect.

The prior automatic approval-review rejection concerned public PR #1436 title/
body edits. This phase did not attempt that operation, as explicitly instructed
by the parent while awaiting the user's decision. Existing own-branch source
artifact publication and Space saving remain independent authorized actions.
No merge/release is performed.
