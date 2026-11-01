# W77: contract for existing release signer and external sidecar placement

Status: **Windows preflight and signing-request construction implemented in
source; external signer transport and installed placement remain proposals**.
The baseline source is
`0e43a569ad52134bee65dea3182ee9a4c4bbc56f`, tree
`897948a6e65c980f560f97b71abaca96c91e4069`; the implemented boundary below is a
change in the isolated worktree based on that source. This document separates
that boundary from information the existing release-custody owner still must
provide. It does not introduce an endpoint, key, credential, trust root, service,
installer execution, or permission to publish or install.

## Existing boundaries

- `scripts/release-proof-producer-w77.mjs` owns manifest serialization and the
  Windows independently verified-input preflight. The semantic SLSA validator
  alone is not cryptographic verification.
- `src/installed-executable-provenance-w68.mjs` owns the unchanged v2 installed
  proof reader. It requires the existing packaged Ed25519 public key, two native
  Authenticode/EXE byte observations, and the full physical package-code tree.
- `scripts/electron-builder-after-all-artifact-build.cjs` emits an unsigned
  package-code inventory outside the final installer. The installer is already
  final when its SHA-256 is placed in the release manifest; embedding that
  manifest into it would invalidate the digest.
- `build/installer.nsh` currently has no external proof placement operation.
  `scripts/install-package-bounded.ps1` currently accepts only installer path,
  expected SHA-256 and timeout. Neither is a discovered signer or authenticated
  four-sidecar delivery interface.
- The forward-candidate sidecar provides existing run/artifact binding and
  bounded archive materialization patterns. Its capture explicitly requires
  `signed`, `published`, `promotion_authorized` and `authority_effect` to be
  false. Its qualification receipt must not be relabelled as release authority.

All paths above are relative to `apps/metaengine-browser/`.

## Implemented operator boundary

`runReleaseProofPreflightCliW77` in
`scripts/release-proof-producer-w77.mjs` is a Windows-only, read-only operator
entrypoint. From `apps/metaengine-browser`, its actual PowerShell invocation is:

```powershell
node scripts/release-proof-producer-w77.mjs `
  --candidate-root 'C:\custody\candidate' `
  --exe 'C:\custody\packaged\win-unpacked\METAENGINE Browser Test.exe' `
  --source-sha '<exact-40-hex-source-sha>' `
  --version '<nonreserved-0.7.0-dev.N.1>' `
  --run-id '<exact-producer-run-id>' `
  --attempt '<exact-producer-attempt>' `
  --artifact-id '<exact-candidate-artifact-id>' `
  --archive 'C:\custody\candidate.zip' `
  --archive-sha256 '<exact-64-hex-archive-sha256>'
```

Replace the placeholders with independently obtained exact pins. All nine
options are mandatory and unique; unknown options, duplicates and missing or
extra arguments are rejected. There is no signer, private-key, alternate API
host, fixture, installation, publication or output-file option. Success writes
one JSON object plus newline to stdout. Failure writes only
`w77_release_proof_preflight_failed` to stderr and exits nonzero, without
forwarding child-process diagnostics. Do not automatically pipe stdout into an
unqualified signer.

Required real inputs are:

- A Windows packaging/custody sandbox with Node, authenticated existing GitHub
  CLI access to the fixed repository, and a `gh` version supporting
  `attestation verify` and every pinned flag below. No new credential is created
  by this entrypoint.
- The immutable original GitHub candidate ZIP and a separately materialized
  canonical local `candidate-root` containing exactly its verified file members.
  The archive ID/name/digest/size and completed successful producer run/attempt
  must match freshly acquired GitHub metadata before and after verification.
  The fixed producer is `browser-windows-package-smoke.yml`, on push to
  `physical/build-slsa-provenance-v1` at the exact source SHA.
- The candidate's exact top-level
  `METAENGINE-Browser-Test-Setup-<version>-x64.exe` and
  `metaengine-installed-package-code.v1.json`, plus
  `browser-slsa-provenance/installer-slsa-provenance.bundle.json` and
  `browser-slsa-provenance/installer-slsa-provenance-receipt.json`. Entire
  materialized file membership is verified, not only these four names.
- A canonical local prepackage `METAENGINE Browser Test.exe` and its full
  packaged tree matching the original inventory. The real EXE must pass both
  native Authenticode/full-byte observations. Current unsigned CI artifacts
  cannot satisfy this input by changing a JSON flag.
- The unchanged `build/emergency-maintenance-public-key.pem` from this trusted
  source, which is the same public-key input used by ordinary `beforePack`.
  The CLI accepts no replacement-key argument, rejects private-key material and
  derives the Ed25519 SPKI fingerprint through the existing root validator.

After a real successful `prepareIndependentlyVerifiedReleaseInputsW77`,
`createReleaseRootSigningRequestW77(prepared)` accepts only that same-process
object privately branded by the successful preflight. Deserialized JSON,
lookalike objects and `verified:true` assertions cannot enter this boundary.
It rechecks archive/tree fences and emits exactly this implemented shape, in
this order:

```text
schema = "metaengine.browser.release-root-signing-request-w77.v1"
execution_scope = "RELEASE_CUSTODY_ONLY"
algorithm = "Ed25519"
public_key_spki_sha256
manifest
payload_base64
payload_sha256
immutable_artifact
payload_presence
release_root_signing_available = false
production_sidecars_emitted = false
installed_placement_verified = false
release_authorized = false
authority_effect = false
```

`payload_base64` is canonical base64 of the unchanged W68 signing bytes described
below; `payload_sha256` hashes those decoded bytes. `immutable_artifact` binds
source/version, producer run/attempt, artifact ID/name and archive SHA-256. Its
metadata validator explicitly reports semantic shape checking only; actual GH
and archive verification occurs in the private preflight, not because those
fields appear in JSON. The stdout object is **not** an authenticated signer
invocation. Serialization does not preserve the private in-process brand.

`payload_presence` has exactly this implemented structure:

```text
scope = "SOURCE_PAYLOAD_PRESENCE_ONLY"
required_roles = <fixed role-to-canonical-relative-path map>
unresolved_role_bindings = [
  "codex_cli_executable_and_dependencies",
  "git_executable_and_dependencies"
]
clean_machine_installation_qualified = false
authority_effect = false
```

`validateRequiredSelfContainedPayloadsW77` validates the existing W68 inventory
identity and requires a nonempty `kind: 'file'` inventory entry at each declared
exact path, including the version-bound Guardian bootstrap. Physical-byte
verification comes from the separate preflight/tree verification, not this
manifest guard alone. Its `required_roles` map
contains Browser EXE/ASAR; `codex_job_helper`; offline manifest, runtime host and
fresh PostgreSQL initializer; bundled Node/Deno; PostgreSQL `postgres`, `psql`,
`initdb`, `pg_ctl`, `pg_config`, `lib/plpgsql.dll`, `share/postgres.bki`; Guardian
manifest, service and configurator; and Guardian bootstrap/binding. It rejects
missing/empty roles and directory or case-alias substitutes. This is a necessary
source payload-presence guard, not exhaustive dependency or install validation.
The guard deliberately preserves both unresolved CLI role bindings even when
every currently declared role is present. A signing request carrying that
object does not clear the clean-machine acceptance requirement.

This entrypoint constructs a request; it does not sign, return a signature,
emit production sidecars, retain the richer external evidence transport below,
or perform installed placement. The external adapter must establish its existing
authenticated custody and evidence retention independently. The Linux runner
used for source checks has `gh 2.46.0`, whose CLI lacks the `attestation`
subcommand, and cannot execute the Windows native path. Source test success is
not evidence of a successful live GH/native preflight.

## Delivered Codex and Git executable roles remain unresolved

The current evidence identifies a concrete package-owner gap:

- `apps/metaengine-browser/electron-builder.test.json:28-44` stages
  `native-coding-job-runtime.json` into ASAR and
  `resources/native-coding/codex-cli-job-runner.ps1` outside it. These entries do
  not declare a delivered Codex CLI executable or Git executable role.
- `apps/metaengine-browser/scripts/prepare-codex-cli-job-runtime.mjs:297-318`
  binds template, C# assembly and helper bytes, compiler/PowerShell observations
  and reference assembly hashes, and returns the helper plus manifest. This
  precompiled process/job helper is not Codex itself, Git, or their complete
  dependency closure. The ordinary beforePack stages that same helper manifest
  as `native-coding-job-runtime.json`.
- `infra/client-state-runtime/native-coding-host-os-scope.mjs:126-175` consumes
  `operator.cli_executable` and `operator.git_executable`, hashes/observes the
  selected CLI and executes the selected Git path. The protected operator-paths
  descriptor in `apps/metaengine-browser/src/native-coding-operator-paths.mjs`
  requires absolute paths; its current validation does not establish a packaged
  executable-role contract for those paths. Existing physical tests' selected
  operator tools are not proof those tools arrive with a clean-PC installer.

Finding a basename `codex.exe` or `git.exe` in arbitrary inventory entries cannot
resolve this gap. A helper digest, protected arbitrary absolute path, successful
developer-machine launch or preinstalled executable also cannot supply it.

The trusted package owner must supply a reviewed **relative executable-role
contract**, carried inside the ordinary authenticated package-code closure. This
is an additional proposed input contract, not a new trust root or an implemented
production adapter. Its minimum fields are `schema`, `source_sha`,
`package_version` and `roles`; `roles` must bind both `codex_cli` and `git` to:

| Role field | Required binding |
| --- | --- |
| `entrypoint` | One exact canonical package-relative path, nonzero size and SHA-256 for the actual executable. No basename search or caller-supplied absolute path. |
| `helpers` | Exact relative paths, sizes and digests for all required process helpers, scripts, interpreters, wrappers and launch/config resources, including how the declared entrypoint is invoked. |
| `dependencies` | Complete packaged relative DLL/module/runtime/data dependency records and approved dependency versions. A launcher cannot hide an undeclared executable or global interpreter behind a script. |
| `os_dependencies` | Explicitly approved Windows baseline dependencies and validation policy; every loaded dependency must resolve to this baseline or the signed packaged records. |
| `selection_binding` | The existing bootstrap/operator-descriptor producer and runtime resolver that derive the selected CLI/Git paths from the authenticated package root plus the declared relative entrypoints. Retain their immutable implementation revisions. |

The role-contract bytes themselves must be included in the W68 package-code
inventory and thus bound by the existing release signature. If stored inside
that inventory's closure, the contract must not contain its own inventory's
digest and introduce a hash cycle; custody binds the outer inventory digest in
the existing v2 release manifest. No additional root or `verified:true` field is
needed or accepted.

On the real clean target, the existing trusted install/bootstrap chain must
derive canonical absolute CLI/Git paths from that relative contract and the
verified package root, produce the protected operator descriptor internally,
and compare the runtime's actual selected paths and full bytes to those same
bindings. Reject paths outside the authenticated closure, aliases/reparse
ancestors, substituted helpers, changed dependencies and PATH/global-tool
fallbacks. Record actual process/module resolution, child entrypoints and
sanitized environment through startup, useful execution and restart. Any
required private writable state is a separately owned installation output, not
an alternate executable search root or borrowed old userData.

Until those concrete role bindings, their runtime integration and real Windows
readbacks exist, `codex_cli_executable_and_dependencies` and
`git_executable_and_dependencies` remain unresolved and
`clean_machine_installation_qualified` remains false. The current W77 presence
guard does not package these executables, repair operator path selection or
prove that all roles are ready.

## Mandatory acceptance on a clean target PC

The installer must deploy, install, authorize through the existing enrollment
chain, and connect METAENGINE's infrastructure on a completely clean supported
Windows PC. Preinstalled Guardian or PostgreSQL cannot be prerequisites. The
Node and `gh` requirements in the operator command above belong **only to the
build/release-custody machine**. That command is not an instruction for the user
PC, an installer dependency, or a target-side verification step.

Target verification must work from the existing signed release chain and the
packaged verifier/native payloads plus approved Windows OS primitives. It must
not invoke target `gh attestation verify`, fetch evidence by a mutable name, or
trust target PATH, global Node, Git, `gh`, preexisting userData, a developer
checkout, or borrowed Guardian/PostgreSQL services, configurations or data.
Independent GH verification occurs in release custody; the exact resulting
bundle/evidence/inventory are authenticated to the target by the unchanged W68
release-root signature and independently anchored packaged verifier. The native
root/verifier/loaded-code boundary remains required; a JavaScript self-report
does not complete it. Any offline OS certificate-policy limitation must remain
an explicit failure/pending result, not a reason to relax signature validation
or install a replacement trusted root.

The immutable delivery closure must account for Browser, Guardian and its
bootstrap/enrollment helper, own PostgreSQL 17, coding CLI, every runtime,
installer and verifier payload, and every dynamic dependency they load. Installed
payload inventories use canonical relative paths, byte lengths and SHA-256
digests, including native DLLs such as libcrypto and any required redistributable
payloads. Dynamic module observations must resolve each dependency to that
authenticated package or the explicitly approved Windows OS baseline. The
installer's final digest is bound externally by the release manifest; it must
not be embedded into its own bytes. Do not weaken the inventory or introduce
wildcard/absolute-path exclusions to accommodate a global dependency.

The existing approved install/bootstrap/enrollment chain must perform its own
internal infrastructure steps automatically. The following are required phases,
not machine mutations implemented by this document:

1. **Resolve and verify owned resources.** Before effects, verify the complete
   signed payload closure and target baseline; resolve canonical immutable
   payload locations and separate new private state/config roots. Reject
   aliases, preexisting METAENGINE ownership, collisions and stale state.
2. **Plan the new local infrastructure.** Derive the exact owned Guardian
   service identity, executables and command lines, loopback ports, PostgreSQL
   data/config paths, roles and schema/migration plan from authenticated package
   and existing policy. Measure service/port/file ownership and refuse conflicts
   rather than adopting another service, cluster or old userData.
3. **Deploy and enroll through the existing chain.** Install the packaged
   Guardian and own PostgreSQL/runtime/CLI payloads; establish their service and
   application bindings through the existing signed bootstrap and authenticated
   enrollment flow. No manual prerequisite installation, replacement release
   root, candidate-chosen signer, invented credential or fabricated enrollment
   flag is permitted. Preserve any legitimate user authorization boundary.
4. **Initialize and connect owned state.** Initialize only the newly owned
   PostgreSQL cluster; configure the intended roles and loopback-only connections,
   apply the reviewed exact schema migrations and bind Browser/Guardian/CLI to
   those resources. On a clean PC there is no borrowed database to restore.
   Restore, if explicitly requested later, must use the existing authenticated
   backup/restore contract and preserve the original source; it cannot be silently
   substituted for clean initialization.
5. **Authenticate and prove health.** Complete the existing internal identity
   enrollment and retain actual authenticated results. External GPT/Codex login
   and required Windows UAC consent remain legitimate user steps. A declined,
   cancelled, expired, failed or still-pending login/UAC/enrollment is reported as
   that state; it must not be treated as successful connection. Verify Browser,
   its own Guardian, own PostgreSQL 17, schema identity and packaged CLI/runtime
   together, including process/service/path/port ownership and restart/boot
   continuity. Only measured successful completion may clear the relevant gate.
6. **Handle failure and rollback.** Keep phase-specific receipts for resources
   created by this operation. Exercise rollback for deployment, service start,
   enrollment, database initialization/migration, connection and health failures.
   Reconcile only resources proven to belong to this exact operation; do not
   delete/alter another installation, profile, service or database. Ambiguous
   effects remain `OUTCOME_UNKNOWN`/partial until inspected, without blind retry
   or a synthetic success/rollback receipt.

The custody owner must provide these additional concrete qualification inputs
through the existing authenticated evidence path; these are requirements, not
new implemented CLI/request fields:

| Required evidence | Minimum measured contents |
| --- | --- |
| `clean_target_baseline` | Immutable VM image/reset identity and supported OS/architecture; actual preinstall absence of METAENGINE/Guardian services, installation registration, owned config and data; initial port and relevant tool/dependency observations. Retain observations, not an asserted `clean:true` bit. |
| `target_payload_closure` | Exact installer/delivery artifact pins, canonical relative installed paths, lengths/digests and dependency inventory for every payload above; the independently approved OS dependency baseline. |
| `sanitized_target_execution` | The actual restricted PATH/environment used by target processes, absence of global Node/Git/gh reliance and measured loaded executable/module paths. Test control tools must not leak into target dependency resolution. |
| `bootstrap_enrollment_execution` | Existing bootstrap/enrollment entrypoint and immutable revision, authenticated install-operation binding, requested/observed service identities and actual authorization states; no private-key/credential values in the record. |
| `owned_infrastructure_readback` | Per-phase owned paths, process/service identities, loopback listeners, own PostgreSQL version/cluster/schema identity, Browser/Guardian/CLI connection results and restart/boot evidence, all bound to the same exact package and operation. |
| `failure_rollback_readback` | Actual injected failure phase, bounded outcome, exact owned-resource effects, cleanup/rollback identities and postfailure health/absence; distinguish preserved partial/unknown state from completed rollback. |

Final acceptance requires an actual fresh-VM install and the failure/rollback
runs from a measured clean baseline, with target dependency resolution sanitized
and observed. A hosted runner containing preinstalled build tools, an existing
Guardian/PostgreSQL instance, a successful package build, source/unit tests, or
synthetic readbacks is not this acceptance. Package/source qualification and
real Windows clean-machine acceptance must be reported separately. Any
source-only rejection gate can reject unsupported claims; its green result
cannot create the missing physical evidence.

This section does not implement a working production installer adapter or
authorize any machine mutation. Service changes, credential/enrollment effects,
installation and rollback execution require the applicable approval at action
time; none are performed here. Until the real existing chain and measured
evidence satisfy these requirements, automatic clean-PC deployment remains
unqualified even if source-only tests pass.

## Information required from the existing custody owner

The adapter cannot select these values from a candidate request. Supply a
reviewable binding to the **already existing** protected execution context:

| Required field | Meaning and acceptance rule |
| --- | --- |
| `invocation_interface` | Exact existing executable/argument grammar, workflow dispatch interface, or API operation; include protocol version and one reproducible invocation. A private-key filename or a proposed new service is not this interface. |
| `implementation_revision` | Immutable revision/digest of the existing signer and placement implementation and their reviewed policy. Candidate code must not choose or replace them. |
| `caller_authentication` | Existing authenticated caller/principal and protected execution boundary; identify the existing credential binding by nonsecret reference only. Never transmit, read back or log a credential value. |
| `allowed_operation` | Explicit permission for `sign_installed_release_manifest_v2`, not an unconstrained arbitrary-message signing facility exposed to candidate code. |
| `public_key_spki_sha256` | SHA-256 of the existing Ed25519 public key's DER SPKI. It must equal the independently approved custody pin and `metaengineEmergencyTrustRoot.public_key_spki_sha256` in the exact packaged artifact. No request-selected key or replacement root. |
| `producer_policy` | Allowed repository, producer workflow and immutable workflow revision, source ref/event, hosted-run identity, source SHA, run ID and attempt policy. |
| `placement_interface` | Exact existing external delivery entrypoint, authenticated caller, fixed target-selection rule, fresh-install-only policy and no-overwrite/file-identity semantics. It must accept proof bytes after the installer is final. |
| `invocation_evidence` | Existing authenticated execution/run identifier and immutable retained request/result artifacts, including errors and partial placement state. A caller-authored success boolean is insufficient. |

An owner may report an unavailable field precisely; an adapter must keep that
operation blocked until the actual interface and evidence exist. Adding an
environment switch, injected signer callback, generated key, or another public
key to make these fields appear complete is outside this contract.

## Immutable inputs before any signing request

The trusted custody execution must acquire the actual GitHub archive bytes by
the pinned artifact ID, hash the whole archive locally and match its immutable
SHA-256, byte length and live GitHub metadata. Bind repository
`PatrickFrome/Compute`, source SHA, exact workflow path, workflow revision,
source ref/event, run ID, run number and run attempt. Require that exact producer
attempt to be completed successfully; reject expired artifacts, incomplete or
ambiguous artifact collections, duplicate names/IDs, and a name/head/run/digest
mismatch. A download URL, artifact name, receipt JSON or ZIP's self-inventory
does not supply these checks.

Materialize only bounded, unambiguous archive members with canonical relative
names. Reject traversal, alternate streams, device names, case collisions,
duplicate entries, symlinks/reparse points, hardlinks and unexpected files.
Retain the original archive and recheck its bytes and file identity after
materialization. Installer, bundle, producer receipt and inventory must be
byte-for-byte members of the pinned candidate archive. Rewalk the exact final
packaged tree against that inventory. If the tree is delivered by the existing
separate forward sidecar, independently pin that archive and same producer
attempt too; require the existing fresh-install image comparison binding its
tree to the unchanged installer. A copy of `win-unpacked` beside an installer
alone does not prove that relationship.

Run the actual `gh attestation verify` command over those installer and bundle
bytes inside the trusted custody execution, with `shell:false`, captured stdout
and nonzero/error refusal. Preserve the existing pins:

```text
--repo PatrickFrome/Compute
--signer-workflow PatrickFrome/Compute/.github/workflows/browser-windows-package-smoke.yml
--signer-digest <exact source SHA>
--source-digest <exact source SHA>
--source-ref refs/heads/physical/build-slsa-provenance-v1
--cert-oidc-issuer https://token.actions.githubusercontent.com
--deny-self-hosted-runners
--predicate-type https://slsa.dev/provenance/v1
--format json
```

The existing semantic verifier then consumes freshly captured CLI stdout and
requires the expected source, ref, repository, workflow, installer digest/name,
run ID and attempt. Preserve both the exact stdout bytes and resulting evidence
bytes. Do not modify provenance JSON to set `verified:true`. The signed
`slsa_evidence_sha256` is computed from these actual evidence bytes; a historical
evidence file in the archive must not replace the newly executed verification.
Retain the exact CLI argument vector and verifier revision with the execution
evidence. Pin the signer workflow revision in custody policy and validate the
verified build identity against it; a workflow path alone is not a revision pin.

The same Windows execution must perform the real W60 Authenticode/path/full-EXE
byte observation before and after SLSA/package-tree verification. Both must
verify successfully and agree on EXE SHA-256 and signer thumbprint; they must
match the inventory and manifest. Retain both exact observation records and
their byte digests. Recheck archive members, directories, canonical paths and
package-tree identity after all asynchronous work. No record of these checks
supplied by an untrusted candidate is an alternative to executing them.

If signing runs in a different existing protected process/job, that process must
reacquire the pinned bytes and execute these checks, or consume the existing
authenticated, immutable execution evidence under an already approved custody
policy. A new JSON receipt format does not create such authentication.

## Exact signing bytes and proposed external request/result protocol

The following richer custody protocol is a **proposed external adapter**, not
the implemented `release-root-signing-request-w77.v1` object above and not an
implemented/authenticated production API. An adapter may derive its manifest,
signing bytes/digest and artifact pins from that object, but must acquire and
authenticate the additional execution records through existing custody. The
proposed field names below do not rename the actual CLI's
`payload_base64`/`payload_sha256` fields.

JSON request/result objects have exactly the fields listed below; reject unknown
or duplicate keys. SHA-256 values are 64 lowercase hex characters; source and
workflow revision SHAs are 40 lowercase hex characters; GitHub IDs are positive
decimal strings; attempt and run number are positive safe integers. Existing
execution/invocation IDs are opaque nonsecret strings, at most 256 characters
with no control characters. `implementation_revision` is the existing reviewed
implementation's immutable commit SHA or algorithm-qualified content digest,
validated against custody policy rather than chosen by the request. Binary
attachments are read
by fixed role from the existing protected execution's immutable input set,
never arbitrary request paths.

The manifest's exact property insertion order remains:

```text
schema, source_sha, package_version, exe_name, exe_sha256,
signer_thumbprint, installer_sha256, slsa_bundle_sha256,
slsa_evidence_sha256, package_code_sha256
```

`schema` remains `metaengine.browser.installed-release-manifest.v2`. Version,
reserved-version and EXE-name validation remains the W77 serializer's existing
validation. Do not sort keys, add run metadata to this manifest, change its
schema/domain, or serialize with pretty printing, a BOM or a final newline.
The **only bytes Ed25519 signs** are the current serializer's result:

```js
Buffer.concat([
  Buffer.from('METAENGINE_INSTALLED_RELEASE_MANIFEST_V2\u0000', 'utf8'),
  Buffer.from(JSON.stringify(orderedManifest), 'utf8'),
])
```

The `\u0000` above denotes one actual NUL byte. Ed25519 signs this byte string
directly (`crypto.sign(null, bytes, existingKey)` semantics), not its SHA-256,
base64 text, request JSON, emergency-command domain or a DSSE envelope.

The request fields, in wire order, are:

| Field | Exact value or type |
| --- | --- |
| `schema` | `metaengine.browser.release-proof-sign-request-w77.v1` |
| `operation` | `sign_installed_release_manifest_v2` |
| `expected_public_key_spki_sha256` | Existing approved packaged SPKI digest; assertion only, never a key selector. |
| `manifest` | The exact ordered v2 object above. |
| `signing_input_base64` | Canonical standard base64 of `serializeReleaseManifestW77(manifest)`. |
| `signing_input_sha256` | SHA-256 of those decoded bytes. |
| `verified_inputs` | Exact object described next. |

`verified_inputs` has exactly `producer`, `artifact`, `observations` and
`execution_id`, in that order. `producer` has exactly `repository`,
`workflow_path`, `workflow_revision_sha`, `source_ref`, `event`, `source_sha`,
`run_id`, `run_number`, `run_attempt`, in that order. `artifact` has exactly
`id`, `name`, `archive_sha256`, `archive_size_bytes`, `installer_member`,
`bundle_member`, `receipt_member`, `inventory_member`, in that order; size is a
positive safe integer and members are the unique validated relative names.
`observations` has exactly `gh_stdout_sha256`, `gh_argv_sha256`,
`semantic_verifier_sha256`, `evidence_sha256`, `producer_receipt_sha256`,
`authenticode_before_sha256`, `authenticode_after_sha256`,
`package_tree_readback_sha256`, in that order. `execution_id` is the existing
authenticated custody invocation identifier. Each observation digest binds the
exact retained record bytes; `gh_argv_sha256` hashes UTF-8
`JSON.stringify(argumentVector)` without newline. Record digests are audit links,
not substitute trust predicates.

Encode the request as UTF-8 `JSON.stringify(request)` in these field orders,
without BOM/newline. Its SHA-256, calculated externally to avoid a self-hash
field, is `request_sha256`. The existing signer must reconstruct the manifest
from its independently checked inputs, compare every field, reconstruct and
compare the signing bytes and digest, and verify its existing public key matches
the approved packaged SPKI before signing. Preserve the request bytes under the
existing invocation's immutable evidence. A retry must use those same bytes or
be a new reviewed invocation; a timeout requires checking the existing outcome
before repeating the signing operation.

The result object has exactly these fields, in this order:

```text
schema = "metaengine.browser.release-proof-sign-result-w77.v1"
operation = "sign_installed_release_manifest_v2"
request_sha256
signing_input_sha256
public_key_spki_sha256
signature_algorithm = "Ed25519"
signature_base64
invocation_id
implementation_revision
release_authorized = false
authority_effect = false
```

`signature_base64` must canonically encode exactly 64 signature bytes (88 base64
characters, ending `==`). The caller must match both request/input digests and
the expected SPKI and authenticate the existing invocation. Independently
verify the signature over the retained signing bytes using the packaged public
key before creating output. A result-provided public key, `verified` bit or
invocation label is never accepted as authority. Signature success alone does
not authorize publication, installation or loaded-code execution.

Construct the existing envelope, without extra properties:

```text
schema = "metaengine.browser.installed-release-envelope.v2"
manifest = <exact ordered manifest that was signed>
signature_base64 = <verified result signature>
```

Serialize this envelope with UTF-8 `JSON.stringify` without BOM/newline. Preserve
the other three sidecars' exact already hashed bytes, including the inventory's
canonical trailing newline. Publish no replacement candidate archive; retain
any resulting detached delivery archive as a separate immutable object through
the existing release path and pin its ID/digest independently.

## External delivery contract

The delivery operation must run through the existing reviewed custody/installer
context. It must first authenticate the envelope against the same approved
packaged SPKI, validate the manifest, the three sidecar digests and their SLSA /
package bindings, and match the immutable installer and source/run/attempt
execution evidence. File copying alone does not satisfy this operation.

The proposed placement request has exactly these fields, in order:

```text
schema = "metaengine.browser.release-proof-placement-request-w77.v1"
operation = "place_installed_release_sidecars_v2"
sign_request_sha256
sign_result_sha256
source_sha
package_version
installer_sha256
public_key_spki_sha256
delivery_artifact
sidecars
target_binding
execution_id
```

`sign_result_sha256` hashes the retained UTF-8 result serialized in its defined
order without BOM/newline. `delivery_artifact` has exactly `id`, `name`,
`archive_sha256`, `archive_size_bytes`; acquire and verify these immutable bytes
through the existing authenticated storage before use. `sidecars` is an array
of exactly four `{name,size_bytes,sha256}` objects, in the following order:

1. `metaengine-installed-release-proof.v2.json`
2. `installer-slsa-provenance.bundle.json`
3. `browser-package-slsa-provenance-evidence.json`
4. `metaengine-installed-package-code.v1.json`

Each positive size and digest must be computed from the validated bytes. The
last three must equal their manifest digest fields. The first is the exact
verified envelope; its outer digest is linked by the authenticated invocation
and delivery archive. No additional file, directory or wildcard is accepted.

`target_binding` has exactly `install_execution_id`, `install_result_sha256`,
`canonical_install_root`, `exe_name`. The root must be selected by the existing
fresh-install context and authenticated install result, never by candidate/page
text. `exe_name` must equal the signed manifest. The bounded install result and
actual installer readback must match `installer_sha256`; an exit code alone is
not a full installed-payload check. This contract does not authorize migration
of an existing installation, its old uninstaller, profile or database.

Before writing, establish that this is the exact fresh install selected by that
context. Reject aliases/UNC/relative paths, reparse points on every ancestor and
target, nonregular/hardlinked files, case aliases and any preexisting sidecar.
Verify the installed code tree against the exact signed inventory before
placement. Stage authenticated source bytes outside the installed code closure;
create each fixed target with exclusive-create semantics and no overwrite,
flush, then read back exact size/digest and file identity. Recheck destination
directory/ancestor identity throughout. Never change the installer or unrelated
installed files. Keep the application behind the existing activation gate while
the four files are incomplete. The custody owner must identify the actual
existing activation gate; if it cannot hold this fresh install until readback,
placement remains blocked. The current NSIS `runAfterFinish` behavior is not
evidence of such a gate.

After all four writes, require the actual W68 installed proof path in the
packaged Windows context with its existing trusted Host/Owner fences: two native
EXE observations, root signature, all four exact sibling reads, full physical
installed-tree equality and final filesystem fence. Do not replace it with the
staging API or inject a custom root/path/native reader. Independently retain
the custody-side installed tree and file readbacks; a modified JavaScript
process cannot establish its own trust. Readback must match source, version,
EXE digest, signer thumbprint, inventory digest and proof identity expected by
this invocation. No W68 result attests already-loaded code or native Guardian
launch custody; that separate boundary remains unchanged.

The placement result has exactly these fields, in order:

```text
schema = "metaengine.browser.release-proof-placement-result-w77.v1"
request_sha256
invocation_id
implementation_revision
state = "PLACED_AND_READ_BACK" | "REFUSED" | "PARTIAL" | "OUTCOME_UNKNOWN"
sidecar_readbacks
w68_readback_sha256
installed_tree_readback_sha256
installer_readback_sha256
error_code
installed_authority = false
release_authorized = false
authority_effect = false
```

The request digest uses the same wire encoding rule. On success,
`sidecar_readbacks` contains exactly the four ordered `{name,size_bytes,sha256}`
records matching the request, all three readback digests are non-null and
`error_code` is null. Otherwise records describe only actually completed reads,
unavailable digests are null and `error_code` is a bounded nonsecret failure
code. The state is operational evidence under the existing authenticated
invocation, never a caller-set clearance flag. Preserve partial state; do not
delete/overwrite files or blindly rerun after ambiguous output. First inspect
the existing invocation and exact on-disk identities.

## Required qualification and current outcome

Adapter qualification must show refusal for a different key/SPKI, signing domain
or property order; wrong source/ref/workflow revision/run/attempt; missing,
expired, ambiguous or changed artifact bytes; synthetic GH stdout/evidence;
changed Authenticode signer/EXE/tree; delivery-archive or sidecar substitution;
case aliases, hardlinks, reparse ancestors and preexisting targets; and partial
write/unknown-outcome retry. A disposable-key test remains explicitly STAGING.
The positive production qualification requires the real existing protected
signer invocation and disposable Windows placement/readback with the unchanged
installer. Those are external prerequisites, not tests already passed here.

The current package workflow deliberately builds unsigned installers and has no
callable protected Ed25519 signer or authenticated external placement invocation
bound to W77. Immutable artifact binding is a necessary input gate; it cannot
make unsigned EXE bytes pass Authenticode or manufacture either missing
capability. Production sidecar emission and installed placement must therefore
continue to fail closed until the custody owner supplies and qualifies the
specific interfaces above. No production signature, installation, publication
or loaded-runtime attestation is claimed by this document.
