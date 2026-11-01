# Remaining native loaded-code custody and release closure

Status: DESIGN ONLY / PRODUCER NOT IMPLEMENTED / EXECUTION CLOSED.
Readback source: `6300fbbaf5b4bd92ad6f5138da12b9d8913a728b`.
Subordinate to the unified roadmap and `docs/INSTALLED_PACKAGE_CODE_RELEASE_PROOF_V2.md`.

## Confirmed gaps, not another readiness flag

The existing W68 reader verifies signed on-disk evidence and package inventory;
it explicitly returns `loaded_runtime_code_attested:false`. The actual Electron
entry executes static imports before the later JavaScript provenance check.
The existing Guardian Owner observer obtains real pipe-client PID/SID/birth, but
does not retain release/load custody established before that client's execution.
Registering the SQL protections or successfully diagnosing their installed state
does not supply that missing native producer.

The current `browser-windows-package-smoke.yml` explicitly builds an **unsigned
test NSIS package** with `CSC_IDENTITY_AUTO_DISCOVERY=false`. Its acceptance
asserts `signed=false` and no promotion authority. That process is not an
already configured production Authenticode/release-signing channel.

The pinned existing Ed25519 PUBLIC root is in
`apps/metaengine-browser/build/emergency-maintenance-public-key.pem`; its SPKI
SHA-256 is `dd1fba3d431890eadb54a411c8af69c9c0145b576fe8a9ee9988c600c132f41f`.
This audit did not read private key material. The callable protected signer and
authenticated external sidecar placement are still not wired. Do not replace
this root, create a key, install a certificate or claim a fixture signature is
production authorization to make a test pass.

## Bounded implementation sequence under the existing Guardian

1. **Native release verification.** Extend the existing Guardian/build, not a new
   service. Pin the same public root independently of the running Browser's JS
   metadata. Match the exact W68/W77 domain and canonical serialization with
   cross-language fixtures; reject ambiguous keys, trailing data and invalid
   schema. Verify actual EXE Authenticode, complete digest and package bindings.
   Existing BCrypt ECDSA-P256 device/update proof is not Ed25519. Selection,
   review, licensing and version/digest pinning of a vetted native Ed25519
   implementation remain explicit build work; do not invent cryptography.
2. **Native file and namespace custody before launch.** Hash from retained
   handles, validate physical identity/reparse/hardlink/ancestor conditions and
   the release-owned executable-resource inventory. Qualify real Windows loader
   compatibility. Existing writable mappings and namespace/DLL injection must
   be addressed in the actual threat model; file handles alone are not absolute
   memory attestation or directory durability. Any protected staging/copy design
   must remain within the existing Guardian/installer authority and requires
   separate installed qualification, not an assumed ACL change.
3. **Fixed MAIN launch in the existing Guardian.** Use existing authenticated
   Owner/session authority and WTS primitives for a bounded, exact release entry.
   Build allowlisted argv/environment/cwd, create suspended, verify actual
   PID/birth/SID/session/image and job custody, then resume. Existing installer
   or session-broker tickets must not become arbitrary process-launch grants.
   A late handshake from an already running unqualified Browser cannot prove
   what it previously executed.
4. **Separate launch roles.** MAIN must not inherit Node/inspector/remote-debug
   overrides. Do not blindly disable RunAsNode globally: existing sentinel,
   compute bridge and ME2 use it. Bind each trusted sidecar/Host to its exact
   release-owned entry and process identity; it is not Owner merely because it
   is a child. User-project code remains in bounded worker delegates and is not
   required to be signed as trusted controller code.
5. **Original lifetime integration.** Retain native custody across the actual
   trusted process lifetime and original effect requests. Invalidate on exit,
   Guardian restart, Owner/session/source generation change, lost handles or
   update requiring replacement. Replayed JSON cannot restore authority. Keep
   SOURCE_ONLY diagnostics separate and retain the early default CLOSED refusal
   until the real producer is qualified.

## Release order and external prerequisites

A production pipeline must authenticate immutable artifact bytes and bind exact
source/run/attempt before the existing protected Ed25519 signer authorizes them.
Native payload signing and bootstrap embedding need an explicitly verified order:
signing a payload **after** its bytes were embedded changes the full-file digest
and cannot silently substitute for the embedded payload. Preserve existing
bootstrap byte equality and final package inventory checks.

Compute installer digest only after the immutable installer exists. Sidecars
that contain that digest must remain external, with authenticated placement;
never embed a self-referencing installer hash. GitHub attestation is a separate
proof and does not replace Ed25519 or Authenticode verification. Do not reuse the
already reserved package identity `0.7.0-dev.2257027431866.1`.

Windows native compilation/physical tests are required. The local read-only
toolchain probe did not find cl/clang-cl/cmake/ninja on PATH or the standard
vswhere installation; this is not proof that no compiler exists anywhere.
Existing Windows CI is an alternative after authorized source publication.
No new compiler installation, OS policy change or signing-service enrollment
was performed by this source checkpoint.

## Acceptance, without widening the claim

Required negatives include root/verifier/domain/signature swaps; prelaunch and
late resource changes; extra executable resources; existing writer/mapping
conditions; unsafe launch policy; different SID/session; PID reuse; Guardian
restart; stale/cross-process proof; sidecar-to-Owner confusion; and failure after
suspended creation with honest terminate/join evidence.

Only after this producer, signer/placement and the existing SQL/Owner predicates
are qualified may the actual prepared-custody/Host publication path be mounted.
Clean install, retained-data upgrade, rollback/restart and useful
goal → worker → independent critic → checkpoint → next task remain distinct
acceptance steps, including the existing GLM-before-GPT requirement.
