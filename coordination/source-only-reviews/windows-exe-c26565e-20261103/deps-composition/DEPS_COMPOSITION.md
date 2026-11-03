# Pinned DEPS and hook input inventory

The data-only producers `custom-electron-deps-policy.py` and
`custom-electron-hook-inputs.py` make the next missing composition inputs
reviewable. Neither producer executes DEPS, hooks, a downloader, an installer,
or a compiler. They cannot admit a build or issue a receipt. All inventories
retain `HOLD`, `authority_effect:false`, and an unqualified source closure.

## Fixed declarations and Git revisions

The parser accepts only the exact Electron and Chromium DEPS blobs:

| Owner | Commit | DEPS Git blob | DEPS SHA256 |
| --- | --- | --- | --- |
| Electron | `c542df1ecbc2c2978e8f53f8c7baf602404d166f` | `b1f99e77cb3661760f655d8fb9346351b354bdba` | `c254ca413381a28243b3808e10dc8842ff0bc09629e1663ee7e09ef79dd4514a` |
| Chromium | `dd78960ccd8a03a2fe1f629543d27783885b78e9` | `3a60b026a4e39b2eff1ed9ab860107e9e9f57b83` | `c3cd8ae90218c260d5fadbe5d9095164693fe420812218a18dfcf65c3f1743b9` |

The restricted AST interpreter allows literals, dictionaries, lists, string
concatenation, and literal `Var`/`Str` references. Conditions use a separate
restricted expression interpreter. Imports, calls in conditions, statements,
dictionary unpacking, duplicate keys, and unsupported expressions refuse.
Substitution values cannot become condition syntax. This is a reviewed subset
for these fixed files, not a general replacement for gclient.

Chromium declares `git_dependencies='SYNC'`; many dependency URLs therefore do
not contain revisions. A packet of raw Git tree objects is independently
hashed from the fixed root `63b2edfe4c6ae23d2fd3424cde3e529db49f7068`.
Its 43,092 distinct objects contain 270 Gitlinks, which provide exact Git
revision declarations. The packet contains no dependency source blobs and
does not prove their physical content. Supplied Gitlink JSON is never trusted.
Electron's Chromium and Node tag references use separately established fixed
commit aliases; an arbitrary new tag remains unresolved.

The manifest retains all 452 dependency declarations (278 Git, 144 CIPD,
30 GCS), all 77 hooks, all ten `recursedeps` declarations, semantic DEPS fields,
variables, and every unresolved condition. A declared native Windows x64
initial-sync profile is used for analysis only. No actual `.gclient`, bootstrap
interpreter, custom variables, host platform or sync phase has been qualified.
Conflicting parent variables (`checkout_clang_tidy`, `checkout_openxr`,
`generate_location_tags`) stay unresolved rather than assuming precedence.
String-variable semantics and bare `mac` conditions likewise remain explicit.
The fixed Electron workflows include Windows-target sync on Linux; a GN target
argument alone does not establish the host profile used to sync dependencies.

Canonical manifest verification derives the expected bytes again from fixed
source inputs. A changed selection, revision, omitted record, or fabricated
qualification flag cannot authenticate itself.

## Hooks and toolchain inputs

The hook producer rederives the DEPS manifest and inventories every selected
or unresolved top-level hook by owner, phase and ordinal. The fixed catalog
binds known script/spec bytes to upstream-base blob identities. Reading or
matching those bytes never executes the script. The entire imported code,
subprocess graph and Electron-patched phase remain separate obligations.

GCS declarations retain exact object generation, SHA256 and size. In particular
Windows Clang, Rust and libclang already have immutable archive declarations;
Clang-tidy has the same strong declaration but its profile selection currently
has unresolved parent precedence. Their payloads and extracted members have
not been verified. A pure byte check can compare a supplied payload against a
source-derived selected descriptor; it still cannot establish extraction,
tool execution or complete source composition.

CIPD platform templates, symbolic tags and `version_file` references remain
unresolved where required. A syntactically valid SHA256 instance ID is
distinguished from a tag and from legacy SHA1, but syntax alone does not prove
package membership or payload files. The host CIPD/vpython bootstrap is also
unqualified.

Electron's own Windows PGO hooks request both x64 and ARM64 profiles, plus a
separate V8 builtins profile. Chromium's PGO flag does not disable these hooks.
All three state files contain exact SHA256 declarations; downloaded payloads,
destination files and marker outputs remain absent. `gen_siso_revision` has a
small data-only expected base literal producer (40 hex bytes plus LF), whose
actual patched hook output remains unqualified.

The SDK source names `TOOLCHAIN_HASH=e66617bc68` and SDK `10.0.26100.0`.
This selector does not supply a complete SDK archive SHA256 or member inventory.
The inventory records known Windows case-insensitive environment override keys;
the separate explicit rejection checker refuses them, including present empty
values. Neither operation is a complete environment identity. The
catalog preserves the depot_tools dependency commit
`38c391feba5fb96812f9028da12413ffc39df394`; that pin does not authenticate the
external gclient which initially bootstraps the checkout. Target Node source
identity likewise does not authenticate the bare PATH Node used by Yarn hooks.

## Reproduce the bounded inventory

Use already provisioned fixed raw blobs and raw tree objects. Outputs must be
new. No command below runs upstream code or retrieves missing dependencies.

```sh
python3 -B apps/metaengine-browser/scripts/custom-electron-deps-policy.py \
  --electron-deps /prepared/electron-DEPS \
  --chromium-deps /prepared/chromium-DEPS \
  --chromium-tree-objects /prepared/chromium-tree-objects \
  --output /new/enabled-deps-inventory.json

python3 -B apps/metaengine-browser/scripts/custom-electron-hook-inputs.py \
  --electron-deps /prepared/electron-DEPS \
  --chromium-deps /prepared/chromium-DEPS \
  --chromium-tree-objects /prepared/chromium-tree-objects \
  --sources /prepared/hook-source-byte-capture > /new/hook-inputs.json
```

The DEPS command's successful exit means inventory creation. Its JSON still
says `HOLD`. The hook command emits its inventory and exits 1 deliberately;
it never reports hook/build admission. Missing catalog files are reported,
and changed provided files refuse. The optional byte capture is data only.

## Concrete remaining producers

1. Bind the actual gclient/depot_tools/CIPD controller binaries, interpreter
   standard libraries and exact `.gclient`/solution/custom variable/host profile
   and sync phase. Reconcile parent and string-variable semantics against that
   fixed controller. Bind Electron-patched DEPS and hook sources after all
   nineteen patch-target repositories have been independently derived.
2. Resolve selection for all ten recursive DEPS declarations and read every
   enabled recursive root and transitive declaration from immutable Git
   objects; retain excluded records and apply unknown-input refusal to nested
   conditions, Gitlinks, CIPD/GCS resources and hooks. The top-level count is
   not a claim of recursive completeness.
3. Resolve every enabled CIPD request to an exact instance and authenticate
   package identity, extracted membership and physical bytes. Supply GCS/PGO
   archive bytes, check the source-derived digest and size, and derive safe
   member sets without executing their tools. Preserve the existing pins.
4. Produce a complete SDK/toolchain/runtime payload identity; bind host
   Python/vpython, Node, Git, GN, ninja and their imports. The SDK selector and
   ambient installations cannot substitute for this producer.
5. Derive exact generated output namespaces and bytes for mtime/patch hooks,
   Yarn, SDK setup, landmines/version metadata, reclient/siso and tast templates.
   Preserve history, encoding/newline, platform, environment and output effects.
   Hook exit status alone is never proof; some upstream paths return success
   when a target repository is missing.
6. Verify all composed physical inputs and generated outputs, then retain
   custody through GN/build/receipt. Until that exists, the builder and all
   receipt/staging/publication paths keep their composition guard. Package PE
   transformations and release authority remain independently unqualified.

No Windows compilation, installation, or release qualification follows from
this inventory. The source-only tests exercise refusal and deterministic data
derivation, not the execution of upstream hooks.
