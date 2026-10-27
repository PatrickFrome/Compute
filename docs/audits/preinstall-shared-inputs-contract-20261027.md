# Shared inputs for disposable pre-install qualification

## Status and origins

These are coordinator-owned source writers for Stream 2 / issue #1356.
The source has been reviewed independently. Native PG17 and predecessor NSIS
qualification require their own completed GitHub Actions runs and pinned
artifacts. No source test, manifest alone, pending run, or failed producer can
substitute for that evidence. This document does not authorize installation on
an existing user profile.

The seven worker branches retain their original source anchor
`9d7527683060e314eb1d39fec9ce2304a57103c4`. The integration branch additionally
contains Stream 1 `a22bafac03bee0945da459fead5bab99c0b9284a`, Stream 6
`4ce31fadf8cd5aa9b4d7f3ac6a354a68a7cea00d`, the optional private reconciliation
transport, and the seven-stream task documents. Source sealing, fresh package
identity and final installed consumers are separate coordinator gates.

`manual-forward-inputs.v2` has exact top-level keys `schema`, `candidate`,
`predecessor`, `schema_fixture`. Candidate uses the unchanged v1 original
producer/sidecar contract. Only the predecessor may use
`IMMUTABLE_INSTALLER_WITH_INDEPENDENT_QUALIFICATION`.

## Original immutable predecessor

| Binding | Exact value |
| --- | --- |
| Repository | PatrickFrome/Compute |
| Original source | 601532ca50db02aa9089783dde157a93f484adf2 |
| Version | 0.7.0-dev.1784381341133.1 |
| Original workflow | .github/workflows/browser-windows-package-smoke.yml |
| Original run / number / attempt / event | 40382079975 / 3927 / 1 / pull_request |
| Original artifact ID | 12679249312 |
| Original artifact name | metaengine-browser-windows-candidate-601532ca50db02aa9089783dde157a93f484adf2 |
| Original ZIP SHA-256 | 28126ee94d99c59040b1e2f5f215556d148da3f1933198ced5919323ce0881f4 |
| Original ZIP bytes | 257692297 |
| Installer SHA-256 | 018cc4a4adf515b5cfc2b829b765aa14d171eaf1bf0e72ebd6e822df1f52d0dd |
| Installer bytes | 253438108 |
| Original W68 manifest SHA-256 | 6ad0cf0b0af0affd77888c6881e83784027ecd4a6be7711a656169822c8214c9 |
| Original builder config Git blob SHA-256 / bytes (LF) | 001d3b1727fea5280eec8fdbe14de451cfd41db0d00f8f2627009ef87e7893cd / 3580 |
| Original builder config producer SHA-256 / bytes (CRLF) | 021cb1cc27dc7f9e46309c2fea925ef9127799da0bd18df1efab342128b63203 / 3729 |
| Packaged offline bundle digest | c80525b60ff2c61e38f40d65f0b05fed38202367971bcfe80c25995d9507e757 |

The original version is consumed and must not be rebuilt or relabelled. Its
previous producer did not publish the new sidecar or schema artifact. New
observations always identify their independent qualifier.

## Independent predecessor writer

Source: `apps/metaengine-browser/scripts/qualify-predecessor-materialization.mjs`.
Workflow: `.github/workflows/browser-windows-predecessor-qualification.yml`.

```sh
node apps/metaengine-browser/scripts/qualify-predecessor-materialization.mjs \
  --work <absent-private-directory-under-RUNNER_TEMP> \
  --out <absent-public-directory-under-RUNNER_TEMP> \
  --expected-qualifier-head <exact-checked-out-Git-HEAD>
```

The physical entry requires frozen Node 24.21.0, a clean GitHub-hosted Windows
runner, exact repository/workflow/run/branch/head binding, and push or dispatch
on one of the two coordinator refs. PR events execute source tests only. The
GitHub token is environment-only. Existing installation, Owner, registration,
Guardian, process or attempt state refuses before NSIS. The original installer
is acquired by immutable artifact ID, verified with the unchanged strict v3
verifier, then invoked once through the existing bounded installer helper.

Artifact name:
`metaengine-browser-predecessor-materialization-<original-source-head>-<qualifier-source-head>`.

Artifact contents are exactly `predecessor-materialization.json` and the vetted
`win-unpacked/` tree. Hidden packaged files are included; directory entries
omitted by the uploader must be reconstructed from authenticated inventory rows
once during acquisition. Revalidation must never repair a changed image.

The manifest schema is `metaengine.browser.predecessor-materialization.v1`.
The writer is the authority for field names; these are the consumer bindings:

| Field | Meaning |
| --- | --- |
| `qualification` | Independent repository, workflow, source_head, run_id, run_number, run_attempt, event, ref; terminal_success_required_by_consumer=true |
| `original_producer` | Original repository/workflow/source/run/number/attempt/event; independently observed terminal success |
| `original_artifact` | Original ID, name, ZIP SHA-256 and byte size |
| `source_head`, `package_version`, `installer` | Original source/version and exact installer name/SHA-256/bytes |
| `original_package_code` | Original authenticated W68 file/SHA-256 and strict verification flags |
| `original_builder_config` | Immutable source_path/source_sha256/source_bytes, independently pinned materialized_sha256/materialized_bytes, materialization=LF_TO_CRLF_ONLY |
| `detached_proofs` | Exactly four named original expectations and independent present-or-absent observations |
| `image` | root=`win-unpacked`, fingerprint schema, tree_sha256, file_count, total_bytes, full ordered `files` rows |
| `asar_sha256` | Actual image ASAR hash matched to original running-code expectations |
| `runtime` | Original bundle digest plus semantic verification and full runtime/PostgreSQL tree digests |
| `uninstaller` | name, size, SHA-256, measurement=INDEPENDENT_DISPOSABLE_FRESH_INSTALL, installer_sha256, qualification_run_id |
| `qualification_installed_image` | Full installed-tree digest/count/bytes including the independently measured uninstaller |
| `bounded_install`, `process_readback`, `registry`, `nsis`, `preflight` | Distinct original-install process/external-effect readback |

The uninstaller binary is excluded from `win-unpacked`. The migration consumer
already performs a fresh installation of the pinned original installer; it
must compare that installation's uninstaller against the prior independent
measurement, and compare the full installation against the independently
qualified installed-tree digest. It must not measure its own expected value.

Running-code expectations originate in the original W68 manifest, never the
observed installation. The four detached names are
`metaengine-installed-release-proof.v2.json`,
`installer-slsa-provenance.bundle.json`,
`browser-package-slsa-provenance-evidence.json`, and
`metaengine-installed-package-code.v1.json`. An original artifact may publish a
detached proof without embedding it. Absence in the installed image is allowed;
presence requires the exact original bytes. A name absent from the original
artifact must also be absent from the installation. No arbitrary exclusion is
accepted.

Acquire `apps/metaengine-browser/electron-builder.test.json` from the exact
original source during input acquisition. The immutable Git blob has 3580
bytes, 149 LF bytes, no CR bytes and SHA-256 `001d3b1727fea5280eec8fdbe14de451cfd41db0d00f8f2627009ef87e7893cd`.
After verifying those source bytes, insert exactly one CR byte before each LF
byte. The resulting historical Windows checkout representation must have 3729
bytes and SHA-256 `021cb1cc27dc7f9e46309c2fea925ef9127799da0bd18df1efab342128b63203`.
Pass only those verified materialized bytes to the unchanged strict installer
verifier, which independently binds the original provenance config digest.
Record both identities in `original_builder_config`; never substitute the
current-target configuration, parse/reserialize JSON, normalize arbitrary line
endings, or accept either digest as a fallback for the other.

The initial writer at `04495c6246160f30e3435f316b4f7db5a5de3c5e` compared the
LF download directly with the CRLF producer digest. Stream 2 identified that
deterministic pre-install refusal and the coordinator independently reproduced
it. A predecessor qualification from that source cannot qualify the required
input. The corrected writer requires its own new source-bound disposable run;
this correction does not change the canonical schema writer or its origin.

## Canonical empty schema writer

Source: `infra/client-state-runtime/export-reviewed-empty-schema.mjs`.
Workflow: `.github/workflows/client-reviewed-empty-schema.yml`.

```sh
node infra/client-state-runtime/export-reviewed-empty-schema.mjs \
  --application-mode ATOMIC_SLICE --bin <pinned-PG17-bin> \
  --driver <frozen-postgres.js-src/index.js> --output-dir <absent-directory> \
  --schema-source-head 601532ca50db02aa9089783dde157a93f484adf2 \
  --exporter-source-head <exact-checked-out-Git-HEAD>
```

Artifact name: `metaengine-reviewed-empty-schema-<schema-source-head>-<exporter-source-head>`.
Exactly two files are published: `canonical-empty-schema.dump` and
`canonical-empty-schema-manifest.json`. The archive is PG17 CUSTOM, schema-only,
without owner commands, with ACL retained. Two independently initialized
disposable clusters must finish source application, dump, restore, catalogue/
function-body/ACL/empty-table/unused-sequence checks and confirmed cleanup
before publication. No existing database, caller SQL, PGDATA or credentials are
accepted by this entry. Factory credentials remain private.

Manifest schema: `compute.reviewed-empty-schema-export.v1`.
`application_mode=ATOMIC_SLICE` and
`artifact_kind=REVIEWED_CANONICAL_EMPTY_SCHEMA_FIXTURE` are mandatory.

`schema_inputs` and `exporter_inputs` are sorted, unique arrays of
`{path,bytes,sha256,git_blob_sha1}` records. Their respective `*_sha256` values
are SHA-256 of UTF-8 `JSON.stringify(array)`, with record fields in the order
shown. Schema Git blobs must match at both source commits and actual disk bytes;
exporter Git blobs match the actual exporter HEAD and disk bytes. The workflow
checks out literal Git bytes with autocrlf disabled. Both bindings are repeated
after native qualification. Schema and exporter origins remain distinct.

| v2 external schema pin | Exact manifest field |
| --- | --- |
| schema_source_head | schema_source_head |
| exporter_source_head | exporter_source_head |
| source_plan_sha256 | source_plan.source_manifest_sha256 |
| upgrade_sources_sha256 | source_plan.upgrade_sources_sha256 |
| archive_sha256 | archive.sha256 |
| toc_sha256 | qualification.toc.normalized_sha256 |

The TOC normalized hash is SHA-256 of UTF-8 JSON for the ordered `{kind,payload}`
entries produced by `validateEmptySchemaToc`; comments, headers and numeric
object IDs are excluded. The original textual readback hash is retained as
`toc.raw_sha256`. The dump bytes have their own independently checked hash.
The parser requires all expected function/relation identities, ACL/default ACL,
PG17 CUSTOM format and the fixed factory database descriptor. It forbids DATA,
SEQUENCE SET, foreign/external and temporary probe/API objects. Restore never
uses `--create`. Commands use LC_ALL=C, LANG=C and TZ=UTC.

`source_plan` additionally records candidate/selection/prerequisite/post-upgrade
ACL hashes, ordered and unique baseline counts, upgrade count and exact RPC
count. `qualification` records NATIVE_PG17 roundtrip status, source/restored
catalogue and ACL hashes, zero row count, sequence state, actual PG version,
two independent identity hashes, completed cleanup and observed executable
hashes. These listed PG executables are not represented as a full offline
runtime-bundle attestation. The migration consumer independently recomputes the
original runtime's real upgrade closure before initialization.

## Mandatory consumer binding

Keep independent external qualification objects for the predecessor writer and
schema writer: repository, exact workflow, source_head, run_id, run_attempt and
artifact `{id,name,sha256}`. All IDs are decimal strings, attempts positive
integers, hashes lowercase hex. External schema qualification source_head must
equal exporter_source_head. The manifests do not invent their own future
artifact IDs or terminal success.

Read each live original producer/qualifier run and latest attempt. Require
completed SUCCESS at the exact source/event/workflow, retrieve every artifact
page and reject ambiguity, expiry, count/ID/name/digest drift. Hash downloaded
ZIP bytes before extraction. Apply strict installer verification to both
original installers and the full Stream 6 materializer/binder chain to the
candidate. Repeat metadata and actual byte checks before physical effects.

Wrong/failed/pending/impersonated qualifier, same installer with changed W68,
unknown detached proof, self-derived expected uninstaller, wrong canonical
closure, missing strict evidence and candidate misuse of the predecessor
exception all refuse. Never retry an uncertain installer, Git or SQL effect.

## Source verification recorded before native runs

- Optional private reconciliation transport: Windows Node 24.19.0,
  42 PASS / 0 FAIL / 0 SKIP, actual child-process IPC; fixture commit service.
- Schema/predecessor writers and Stream 6 suites: Windows Node 24.19.0,
  257 PASS / 0 FAIL / 2 explicit non-Windows-only skips. The skips are a Linux
  alias-creation fixture and unsupported-platform entry check; native Windows
  path controls ran. This did not run PostgreSQL or NSIS.
- Independent source reviews found no remaining material issue in these
  writers at their reviewed revisions. The initial event/head mismatch was
  fixed before the combined run. The subsequent exact-source config encoding
  correction passed 19 / 19 isolated Linux native Node 24.22.1 source controls,
  including the real immutable LF blob and unchanged historical CRLF digest.
  That later source result is separate from the earlier Windows result and
  does not claim an NSIS qualification.
- Existing anchor Current Source, W59, W66 and seven other source workflows
  completed successfully. New integrated source must be resealed and qualified
  again; old source results do not qualify this changed tree.

Physical results and immutable run/artifact pins are recorded in issue #1354
and #1356 only after actual completion. Installation, production, migration and
runtime-ready authorization remain false in these supporting artifacts.
