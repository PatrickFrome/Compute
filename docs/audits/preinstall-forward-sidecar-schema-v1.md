# Producer-bound forward sidecar v1

This is the Stream 6 contract for [#1361](https://github.com/PatrickFrome/Compute/issues/1361),
accepted with Stream 2 in
[the proposal](https://github.com/PatrickFrome/Compute/issues/1361#issuecomment-6429076518),
[Stream 6 ACK](https://github.com/PatrickFrome/Compute/issues/1361#issuecomment-6429127543),
and [consumer readback](https://github.com/PatrickFrome/Compute/issues/1361#issuecomment-6429210007).
Development anchor: `9d7527683060e314eb1d39fec9ce2304a57103c4`.

## Publication and authority

The existing immutable candidate is published first, unchanged. Its exact upload
step ID supplies the candidate artifact ID and ZIP digest. The existing bounded
NSIS installation must succeed, including its existing UI, daemon, Guardian and
version readbacks. Only then does `qa-forward-candidate-evidence.mjs capture`
measure the generated uninstaller and compare the complete installed directory
with the same build's `dist-test/win-unpacked`.

The capture re-runs the unchanged strict v3 installer verifier against the
original named installer in `dist-test`, and hashes both the published named copy
and the actual `candidate-setup.exe` invoked by the existing install step. All
three must have the same SHA-256. An ID-addressed GitHub artifact metadata read
must agree with the upload output, producer run, source and digest. No new build,
installer execution, version reservation or retry is performed by capture.

Publication is a separate immutable artifact named:

```text
metaengine-browser-windows-forward-sidecar-<40-lowercase-hex-source_head>
```

Its root contains `forward-install-sidecar.json` and `win-unpacked/`. The latter
contains the complete regular-file and directory image, including hidden files.
It never contains the NSIS-generated `Uninstall METAENGINE Browser Test.exe`.
Neither the original candidate artifact nor its inventory is amended.

The manifest is evidence of the producer's image comparison. It does **not**
establish the eventual status of the producer. The capture summary explicitly
uses `CAPTURED_PENDING_PRODUCER_COMPLETION`,
`producer_terminal_success:false`, `terminal_success_required:true`,
`production_authorized:false`, and `authority_effect:false`. Later workflow
failure disqualifies the sidecar even if its manifest is internally valid.

The artifact service assigns the sidecar ID and ZIP SHA-256 after upload. The
workflow summary reports those pins and the manifest SHA-256. A manifest cannot
contain its own archive digest without a circular dependency. The consumer must
receive these external pins from the coordinator.

## Manifest fields

Schema: `metaengine.browser.forward-install-sidecar.v1`. Unknown fields are
rejected except for the explicitly documented optional fields below.

| Field | Required meaning |
| --- | --- |
| `source_head` | Exact 40-character lowercase Git commit SHA |
| `package_version` | Exact `0.7.0-dev.<positive decimal>.1` version |
| `producer.repository` | `PatrickFrome/Compute` |
| `producer.workflow` | `.github/workflows/browser-windows-package-smoke.yml` |
| `producer.run_id` | Canonical positive decimal string, never a floating-point ID |
| `producer.run_number`, `producer.run_attempt` | Positive safe integers; this producer retains its existing first-attempt-only gate |
| `producer.event` | `push`, `pull_request` or `workflow_dispatch`; must equal the actual pinned run |
| `installer_artifact` | `{id,name,sha256}` of the original immutable candidate ZIP, with exact `metaengine-browser-windows-candidate-<source_head>` name |
| `installer` | `{name,sha256}` of `METAENGINE-Browser-Test-Setup-<package_version>-x64.exe` |
| `asar_sha256` | Raw SHA-256 of `win-unpacked/resources/app.asar` |
| `runtime.bundle_sha256` | Existing **semantic** `offline-runtime-bundle.json.bundle_sha256`, verified with `verifyOfflineRuntimeBundle` |
| `runtime.tree_sha256` | Existing tree fingerprint of the entire `resources/client-state-runtime` subtree, including raw manifest bytes |
| `runtime.postgres_tree_sha256` | Existing tree fingerprint of its entire `runtime/postgresql` subtree, including bin/lib/share |
| `image` | `{root:"win-unpacked",schema,tree_sha256,files}` with complete canonical inventory |
| `uninstaller` | `{name,sha256,measurement,installer_sha256}` measured from this producer's successful fresh installation |
| `installed_image` | Actual successful existing `compareQaInstalledImage` receipt |

Every SHA-256 field is 64 lowercase hex characters without a prefix. Raw GitHub
artifact API metadata must carry `digest:"sha256:<hex>"`. `image` may optionally
include `file_count` and `total_bytes` only when they exactly match its rows; the
producer omits these optional fields to match the agreed minimal representation.

### Canonical inventory

`image.schema` is `metaengine.browser.qa-installed-tree-fingerprint.v1`.
Every directory, including an empty directory, has the row `[relative,"DIRECTORY"]`.
Every regular file has `[relative,byte_size,sha256]`. The root itself is not a row.
Paths use `/`, retain original case and are sorted with JavaScript string `<`/`>`
comparison, without locale sorting. Parents must be declared directories.

The digest is exactly:

```js
createHash('sha256').update(JSON.stringify({
  schema: 'metaengine.browser.qa-installed-tree-fingerprint.v1',
  files: sortedRows,
})).digest('hex');
```

Subtree digests remove the parent prefix and slash from descendant rows, then
apply the identical schema and canonical digest. The semantic runtime digest
cannot be inferred from a raw file inventory. Both producer and materializer
invoke the existing semantic verifier on the actual bundle.

### Uninstaller and installed receipt

`uninstaller.name` is exactly `Uninstall METAENGINE Browser Test.exe`.
`measurement` is exactly `NSIS_GENERATED_AFTER_FRESH_INSTALL`.
`installer_sha256` must equal the original installer hash. The consumer uses this
producer expectation; computing an expectation from its successor is forbidden.

The existing receipt has schema
`metaengine.operator.qa-installed-image-readback.v1`, state
`EXACT_CANDIDATE_IMAGE_VERIFIED`, the exact candidate and installed tree hashes,
installed `file_count`/`total_bytes`, `uninstaller_sha256`,
`full_tree_verified:true`, `production_authorized:false`, and
`authority_effect:false`. It has exactly one more file than the candidate.

The validator derives the uninstaller's byte size by subtracting the sum of
candidate file sizes from the receipt's `total_bytes`. The difference must be a
positive bounded safe integer. Adding the sole uninstaller row to the candidate
rows must reconstruct the receipt's exact installed-tree hash. This cross-check
does not introduce a new schema field or claim independent producer completion.

## Consumer pins and validation order

Stream 2's input schema is `metaengine.browser.manual-forward-inputs.v1`.
Each `candidate` / `predecessor` pin has the following structure. This example
uses deliberately invalid placeholders; it is a template, **not** a real receipt
or a runnable installed qualification input.

```json
{
  "source_head": "<exact 40 lowercase hex SHA>",
  "package_version": "<centrally issued exact version>",
  "producer_run_id": "<positive decimal string>",
  "producer_run_attempt": 1,
  "installer_artifact": {
    "id": "<explicit candidate artifact ID>",
    "name": "metaengine-browser-windows-candidate-<source_head>",
    "sha256": "<candidate ZIP SHA-256>"
  },
  "sidecar_artifact": {
    "id": "<explicit sidecar artifact ID>",
    "name": "metaengine-browser-windows-forward-sidecar-<source_head>",
    "sha256": "<sidecar ZIP SHA-256>"
  }
}
```

Perform these checks before NSIS, registry, Owner or PostgreSQL effects:

1. Read the original run by its pinned ID. Require `status:"completed"` and
   `conclusion:"success"`, exact repository/workflow/source/run/number/attempt/
   event, and no newer mismatched attempt. Do not substitute a run selected by
   `latest` or success from an earlier attempt.
2. Read **all pages** of that run's artifact collection. Require its full
   `total_count`, unique IDs, exactly one candidate and one sidecar with the
   expected names, exact IDs/digests/run/head, and explicit `expired:false`.
   An individual successful ID lookup does not prove absence of duplicates.
3. Download each original archive by its pinned ID and check the actual ZIP bytes
   against both external pins and API digests. Keep original archives for later
   revalidation. Safely materialize the existing candidate artifact and run the
   unchanged `installer-provenance.mjs verify` / exported `verifyInstaller` with
   exact head/run/number/attempt/workflow and original config, blockmap, identity,
   dependency and lock material. Retain its actual returned acquired evidence.
4. Call `materializeForwardSidecar` into a new absent directory. It validates ZIP
   metadata and the outer archive/manifest digests before writing, reads the manifest from that exact ZIP,
   validates inventory, recreates declared directories, streams files through
   bounded CRC/SHA checks, and verifies the complete tree and runtime bundle.
5. Call `validateForwardSidecarBinding` with the materialized manifest, external
   pin, live run, complete artifact collection/count, and the strict verifier's
   actual `installerEvidence`. Rehash the actual installer and retain both
   original archive and manifest pins in the consumer descriptor.
6. Before physical effects, revalidate retained bytes and original producer
   identity. Failed, pending, missing, expired, ambiguous or changed inputs
   remain BLOCKED. A saved assertion or an internally valid manifest alone is
   insufficient.

The existing shared `qualified-installer-consumer.ps1` is unchanged. v2 acquired
evidence retains its existing identity/dependency/config/blockmap gates; v3 also
retains package-lock/Bun-lock/toolchain gates. The new producer requires v3.

### Reusable API

`apps/metaengine-browser/scripts/qa-forward-candidate-sidecar.mjs` exports:

```js
FORWARD_SIDECAR_SCHEMA
FORWARD_SIDECAR_LIMITS
FORWARD_UNINSTALLER
forwardPathCollisionKey(name)
validateForwardRelativePath(name)
digestForwardInventory(files)
validateForwardInventory(files, limits?)
captureForwardInventory(root, {limits}?)
hashForwardFile(file, {maxBytes}?)
validateForwardSidecar(manifest)
validateForwardSidecarBinding({
  manifest, pin, producerRun, artifacts, artifactCount, installerEvidence,
})
```

`producerRun` and each element of `artifacts` have GitHub REST response shapes.
`artifactCount` is the complete API `total_count`, not the size of a filtered
candidate-only list. The binder is a pure validator: its caller supplies live
authenticated API observations and freshly verified installer evidence.

`apps/metaengine-browser/scripts/qa-forward-candidate-archive.mjs` exports:

```js
await materializeForwardSidecar({
  archiveFile,                  // physical local file, absolute path
  archiveSha256,                // externally pinned raw ZIP digest
  destination,                 // absolute path; must not exist
  expectedManifestSha256,       // optional independent manifest pin
  limits,                      // optional tighter resource limits
});
```

It returns the validated `manifest`, its `manifest_sha256`, `candidate_root`,
and `archive_sha256`. This is materialization, not terminal qualification.
Source fixture producers in the tests are explicitly synthetic and contain
inert bytes. They never authorize installation.

## ZIP representation and filesystem limits

The pinned [upload-artifact search implementation](https://github.com/actions/upload-artifact/blob/043fb46d1a93c77aae656e7c1c64a875d1fc6a0a/src/shared/search.ts)
filters directory entries. The uploader is configured with
`include-hidden-files:true` only for the separately vetted staging directory.
The consumer recreates missing directories **only** from validated inventory
rows. It must also accept ordinary file-only archive entries and supported ZIP64
records/data descriptors from the actual artifact writer.

Both ZIP and inventory reject traversal, absolute/drive/UNC paths, backslashes,
ADS colons, reserved device names, trailing dots/spaces, short-name aliases,
file/directory prefix conflicts, duplicate and case-colliding names, special
files, symlinks and hardlinks. Names must be NFC. Collision detection uses
conservative uppercase/NFC keys, including Unicode aliases such as S/long-s and
the two lowercase Greek sigma forms; it does not rewrite canonical row bytes.
Windows ordinal case-insensitive comparison uses uppercase mapping, as described
in [Microsoft's CompareStringOrdinal contract](https://learn.microsoft.com/en-us/windows/win32/api/stringapiset/nf-stringapiset-comparestringordinal).

| Limit | Maximum |
| --- | ---: |
| Candidate regular files | 25,000; installed receipt must still fit this limit including its uninstaller |
| Candidate inventory entries, including directories | 50,000 |
| Candidate image total regular-file bytes | 12 GiB |
| Individual image file / optional predecessor dump | 4 GiB |
| Image-relative path depth | 40 |
| Manifest bytes | 32 MiB |
| Input archive bytes | 13 GiB |
| Aggregate ZIP expanded bytes | 12 GiB + 32 MiB manifest budget; the optional dump is included in this aggregate |
| Central-directory metadata | 64 MiB |
| Declared expansion ratio per ZIP entry | 1000:1 |
| Relative path / single component | 1024 / 255 UTF-8 bytes |

Limits can only be tightened. ZIP parsing checks claimed expanded sizes before
writing and actual emitted bytes while inflating, so a false small header cannot
remove an extraction ceiling. Files are streamed rather than buffering a large
archive in memory. Roots/ancestors retain physical identity, creation is
exclusive, and completed output is rehashed. Existing or partial destinations
are refused; they are never silently overwritten or retried.

## Optional predecessor fixture

Only a coordinator-provided reviewed predecessor may include
`predecessor-empty-schema.dump` with:

```js
schema_fixture: {
  file: 'predecessor-empty-schema.dump',
  sha256: '<reviewed archive hash>',
  source_head: '<same predecessor source_head>',
  kind: 'REVIEWED_OFFLINE_EMPTY_SCHEMA',
  source_data_rows: 0,
  synthetic_rpc_bodies: false,
}
```

The materializer checks its exact file/hash binding. It cannot establish the
semantic provenance of a database dump; coordinator review and the Stream 2
empty-table restoration checks remain necessary. The candidate producer does
not invent, obtain or privately rebuild this predecessor input.

## Integration status

Source schema/fixtures are distinct from installed qualification. No new
producer was run in this stream. Real source/version/run/attempt/artifact/hash
pins remain BLOCKED until the coordinator integrates, reseals, issues a fresh
version and completes the one original producer successfully. The consumed
`0.7.0-dev.1784381341133.1` identity must not be rebuilt.

Stream 2 adoption is tracked by the exact
[integration dependency](https://github.com/PatrickFrome/Compute/issues/1354#issuecomment-6429241036).
It addresses observed consumer gaps at `043652d746392ada4ae60a7d7db09da8bd78446b`
without changing that worker's files in this branch.
