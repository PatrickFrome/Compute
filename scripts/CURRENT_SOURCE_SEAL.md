# Preparing a new current-source seal

Use `current-source-seal.mjs` after the integrator freezes and reviews the new
functional source commit. It implements the existing current seal refresh
process recorded in the native admission continuation audit. It does not
reserve a package version, sign a release, run a global build, or change any
historical ledger or qualification flag.

1. Commit the reviewed source. Record its full SHA as `SOURCE_SHA`. Keep the
   tracked checkout clean. This must be the intended final integration, not a
   predecessor whose passing checks are being inherited.
2. Run `node scripts/current-source-seal.mjs inspect --source-sha SOURCE_SHA`.
   Add `--include path/to/new-file` for each newly reviewed file that must enter
   the seal. Existing sealed entries cannot be silently removed. The output
   contains the exact old/new blob pairs; review every delta against the source
   changes, then save that exact JSON outside the checkout.
3. Run `node scripts/current-source-seal.mjs prepare --source-sha SOURCE_SHA
   --review REVIEW_JSON --output NEW_DIRECTORY`. Use an absent directory outside
   the checkout, with an existing physical parent. The command creates a new
   manifest candidate and a detached receipt, using exclusive writes. A failure
   is not a usable receipt. Do not automatically retry into a partial directory.
4. Review the candidate diff. Only `current_tree_blobs` may differ from the
   previous manifest. Install the reviewed candidate at
   `coordination/operator-control/client-critical-closure.manifest.json`, retain
   the new receipt in a new audit location, and create a new seal commit. Verify
   that the functional-source-to-seal-commit diff contains only that manifest
   and the new receipt. Historical records remain at their original bytes.
5. Run the complete historical/current source preflight from
   `.github/workflows/client-source-candidate-w73.yml` on this final commit, with
   `EXPECTED_SHA` equal to its full SHA. Then obtain fresh exact-HEAD CI. The
   producer receipt deliberately says validation is pending; generating it is
   not a passing check, installed qualification, or release authorization.

The manifest does not contain its own blob hash. The detached receipt binds the
functional source and predecessor manifest blob to the new manifest SHA-256.
Final CI binds the resulting seal commit to all sealed Git and worktree bytes.
Any later functional edit requires a new reviewed generation and fresh checks.

## Windows artifact boundary

The existing package producer must bind the final source SHA, frozen dependency
material and compiled native helper bytes into the packaged-code inventory.
The EXE Authenticode observation and byte digest describe that exact EXE. The
installer digest is computed only after the final installer exists. GitHub SLSA
verification must independently verify that digest with the exact source,
workflow, run and attempt; a JSON `verified` flag is not verification.

W77 then hands off the final installer digest, EXE digest, packaged-code digest,
SLSA bundle and independently produced verification evidence. The protected
existing Ed25519 release root must sign the exact W68 domain and manifest. Its
private key is never read, packaged or replaced here. Sidecars containing the
installer digest remain external to the immutable installer, avoiding a
circular installer hash. The installed placement mechanism must authenticate
those sidecars and the installed tree before W68 can grant provenance.

`probeProductionReleaseProofW77()` currently reports these missing producers:

- `EXISTING_PROTECTED_RELEASE_ROOT_SIGNING_CAPABILITY_NOT_WIRED`
- `EXTERNAL_SIDECAR_INSTALLED_PLACEMENT_UNPROVEN`
- `IMMUTABLE_VERIFIED_GH_ARTIFACT_BYTES_HANDOFF_NOT_WIRED`

These are unresolved release gates, not reasons to create a new signing root,
accept staging fixture signatures, or enable runtime readiness. The qualified
installer consumer also requires terminal success of its bound Package Smoke
producer; downstream Final Runtime/Soak/SelfUpdate cannot qualify without it.
