# Complete component source producer

`apps/metaengine-browser/scripts/custom-electron-source-policy.py` is a runnable
source-only producer. It does not execute upstream hooks/scripts, download
objects, compile code, qualify Windows, or grant runtime/release authority.
It replaces the former missing-Chromium-identity placeholder with concrete
component derivation and physical readback. The remaining composition boundary
is explicit rather than a caller-authored success flag.

## Established identities

The existing locked Electron commit is
`c542df1ecbc2c2978e8f53f8c7baf602404d166f`, tree
`328891d1f8b4d93d49c9f31332baf75fa726cb6e`. Its DEPS names Chromium tag
`152.0.7977.167`. The official Chromium GitHub mirror resolves that tag to
`dd78960ccd8a03a2fe1f629543d27783885b78e9`; hashing the raw commit object confirms
that ID and its embedded tree `63b2edfe4c6ae23d2fd3424cde3e529db49f7068`.
The declared Chromium DEPS bytes match the existing SHA256 pin. Chromium tree
contents and a physical Chromium checkout were not acquired or qualified here.

Node base `f14cd3aa7bf9ca8df2cc5b8bb14beb0f335b1d93` has tree
`409a26f676d83fa6e1b0bfdb1c10d6878845c071`. All 64 patches from the locked
Electron `patches/node/.patches`, in order, derive posttree
`92f36398f6bacb44cbba33fea5b902898ac8ef9a`. An independent upstream-equivalent
`git am --keep-non-patch --keep-cr` replay produced the same complete tree.
All 46,474 entries and 639,931,050 canonical raw source bytes, including six
reviewed symlink targets, were physically reread. The eight prior interface
hashes also agree, but are no longer the complete Node identity check.

## Producer contract

Inputs are full preprovisioned object repositories. The producer verifies raw
Git object hashes, fixed commit/tree identities, every ordered patch blob and
the complete resulting tree. Replay uses private index/object storage; supplied
source repositories, HEAD and indexes are not modified. Replacement refs,
grafts, local include/includeIf/worktreeConfig composition, external filters
and promisor repositories are refused before object access; Git environment
redirection is removed and lazy fetch is disabled.

Physical verification reads all files independently of Git index assume/skip
bits, compares exact modes/bytes and reviewed symlink targets, and refuses
extra or ignored files/directories. Gitlink dependencies remain unqualified.
This is a point-in-time readback, not continuous source custody through a build.

The profile is `canonical-raw-git-blobs-v1`. Normal upstream attributes can
change physical checkout representation: two Node paths have pinned CRLF
checkout rules. Those bytes are not silently normalized. Use a new canonical
export or provide independently materialized raw blobs; ordinary Windows
checkout representation remains unqualified. No Windows build result follows
from a successful Linux source proof.

From the repository root, with repositories already provisioned:

```sh
python3 -B apps/metaengine-browser/scripts/custom-electron-source-policy.py \
  --electron /prepared/electron --checkout /prepared/node --component node \
  --derive-only --output /new/node-expected-tree.json

python3 -B apps/metaengine-browser/scripts/custom-electron-source-policy.py \
  --electron /prepared/electron --checkout /prepared/node --component node \
  --canonical-output /new/node-raw --output /new/node-materialized.json

python3 -B apps/metaengine-browser/scripts/custom-electron-source-policy.py \
  --electron /prepared/electron --checkout /prepared/node --component node \
  --physical-tree /prepared/node-raw --output /new/node-readback.json
```

`--derive-only` records `physical_tree_verified:false`. The other two modes
perform complete raw readback; outputs must be new. Omitting these options
checks the supplied checkout's HEAD tree and physical source against the fully
derived tree. The same interface supports `electron`, `chromium`, `v8` and
`boringssl`; every component's entire official series is applied. Chromium,
V8 and BoringSSL complete postpatch replay was not run in this environment.
Missing objects fail locally; this command never fetches them.

## Remaining composition producer

Electron's patch configuration names 19 repositories; the five component
proofs do not qualify all enabled build inputs. The next producer must:

1. Interpret the exact pinned Electron/Chromium DEPS and conditions for the
   selected Windows x64/custom variables using a reviewed interpreter/tool
   identity, producing the complete selected repository and boundary set.
2. Verify every selected repository's immutable base and whole official patch
   series, plus exact physical representation. Authenticate every nested
   boundary independently; never ignore arbitrary gclient directories.
3. Bind CIPD instances, GCS/digest-selected resources, hooks, generated files,
   compiler/SDK/tool binaries and their immutable dependency closure.
4. Retain the verified inputs through GN/build, detect mutation, and connect
   the original producer directly to receipt/publication. A caller JSON,
   callback, path or `verified:true` field is not that connection.

The current builder stops before stage/GN/receipt/publication with
`custom_electron_gclient_deps_cipd_hook_closure_unavailable` once its component
prerequisites pass. A composed gclient tree can instead refuse earlier at an
unqualified nested boundary or checkout representation. Receipt helpers and
the real package gate retain conservative base-head checks until a reviewed
composition-proof handoff replaces them; a source component proof is not a
production receipt input. Existing release signatures remain independent.
