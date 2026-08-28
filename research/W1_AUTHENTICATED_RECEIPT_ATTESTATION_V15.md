# W1 Authenticated Receipt Attestation V15

Date: 2026-08-28
Status: GitHub keyless attestation mechanism exact-green / non-authority

## Goal

V14 deliberately left `producer_attestations_authenticated=false`: self-hashed same-world links prove deterministic linkage but not who produced the bytes.

V15 closes only the mechanism gap. It proves that this public repository can:

1. build non-authority subject bytes in a job without signing authority;
2. transfer those exact bytes to a separate attestor job;
3. mint a GitHub OIDC-backed keyless attestation with no AWS credentials;
4. verify the Sigstore bundle against exact source and signer identity;
5. emit a credential-free verification receipt.

It does **not** yet authenticate a live W1 provider receipt or change W1 state.

## Current GitHub capability

GitHub Artifact Attestations are available for public repositories on all current GitHub plans. `PatrickFrome/Compute` is public, so this mechanism does not require Enterprise Cloud.

Current GitHub guidance recommends `actions/attest` for new implementations. The action creates in-toto attestations and signs them using a short-lived Sigstore-issued certificate derived from GitHub Actions OIDC identity. For public repositories the public-good Sigstore instance is used.

References:
- https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations
- https://github.com/actions/attest
- https://github.com/actions/attest/releases

V15 pins immutable `actions/attest` v4.2.1 commit:

`508db95dd578ae2727ebd6217d5ba78e4fbda05d`

No floating action tag is used by the workflow.

## Why standard SLSA provenance instead of a custom W1 predicate

GitHub's `gh attestation verify` documentation distinguishes certificate-derived identity from workflow-controlled predicate data. Certificate fields and verified timestamps come from the OIDC/Sigstore verification boundary, whereas an attacker controlling workflow execution could falsify custom predicate contents.

Therefore V15 attests the **actual subject file bytes** using standard SLSA build provenance and treats the subject JSON merely as the bytes being authenticated. Policy decisions use certificate-derived source/signer fields plus the cryptographically bound subject digest.

Reference:
- https://cli.github.com/manual/gh_attestation_verify

## Split trust domains

### `build-subject`

Permissions:
- `contents: read`

No:
- OIDC write;
- attestation write;
- AWS credential configuration;
- provider calls;
- database calls.

It creates a deterministic non-authority JSON subject bound to the exact repository, repository/owner IDs, source SHA/tree, source ref, run id/attempt and workflow path.

### `attest-and-verify`

Permissions:
- `contents: read`;
- `id-token: write`;
- `attestations: write`;
- `artifact-metadata: write`.

It downloads the subject produced by the unprivileged builder, recomputes its SHA-256, revalidates every non-authority flag, and only then invokes the pinned attestation action.

There are no AWS/Supabase credentials or mutation permissions in this job.

## Verification policy

`gh attestation verify` must succeed over the local Sigstore bundle and exact subject file with:

- exact repository `PatrickFrome/Compute`;
- exact signer workflow `.github/workflows/w1-authenticated-receipt-attestation-contract.yml`;
- exact current source ref;
- exact current source commit SHA;
- predicate `https://slsa.dev/provenance/v1`;
- self-hosted runners denied.

The JSON verification output is additionally checked for:

- OIDC issuer `https://token.actions.githubusercontent.com`;
- exact source repository ref;
- exact source repository digest;
- immutable repository id `1341371143`;
- immutable repository owner id `20597814`;
- runner environment `github-hosted`;
- exact subject SHA-256.

The GitHub CLI supports `--source-ref`, `--source-digest`, `--signer-workflow`, `--deny-self-hosted-runners`, local `--bundle`, and JSON output for additional policy enforcement.

Reference:
- https://cli.github.com/manual/gh_attestation_verify

## Hard nonclaims

The source subject explicitly records false:

- `same_world_chain_live_evidence`;
- `aws_credentials_used`;
- `provider_mutation_observed`;
- `database_mutation_observed`;
- `reboot_completion_proven`;
- `boot_id_transition_verified`;
- `persistent_worker_proof`;
- `worker_admitted`;
- `w1_verified`;
- `canonical`;
- `authority_effect`.

After cryptographic verification, the outer receipt may state only:

`producer_attestation_mechanism_verified=true`

It must still state:

`live_w1_receipt_authenticated=false`

and keep every W1/persistence/admission authority field false.

## Exact implementation evidence

The first exact end-to-end green V15 run is:

- source commit: `9fb960e35787fa36c3c1a9114a2a89b0309e8d7a`
- source tree: `3566d49f1179578457f7f573ab85fb0420193bf5`
- Actions run: `33193695269`
- conclusion: `success`
- attestation subject SHA-256: `4dd991ff861cc7f73f58fbb840e374fdb05862b75dd65c7a420239979146356b`
- GitHub attestation id: `43714067`
- Rekor transparency-log index: `2627267108`
- verification receipt artifact id: `9694833916`
- verification receipt artifact digest: `sha256:c3656ac4e186b46762504e36b2681a01b1b066311f09986f6c63f5a36c23753e`

All three jobs completed successfully:

1. `contract-tests`
2. `build-subject`
3. `attest-and-verify`

Inside `attest-and-verify`, the exact successful steps were:

- download builder artifact with digest verification;
- recompute and compare subject SHA-256;
- validate all non-authority semantic fields;
- create keyless SLSA attestation using pinned `actions/attest`;
- verify the local Sigstore bundle with `gh attestation verify` and exact source/signer policy;
- upload only the small credential-free verification receipt.

The signing log explicitly reports:

- attestation type `Build Provenance`;
- Public Good Sigstore certificate;
- Rekor upload;
- GitHub repository attestation upload.

The certificate-backed verification policy succeeded with the actual branch ref `refs/heads/work/main-roadmap-accelerators-v15` and exact source digest above. This is expected for source-smoke. It is not a protected-main live W1 receipt.

## Transport failures discovered and corrected

V15 produced two useful red signals before the first green run:

1. `archive:false` cannot upload two files; the sidecar SHA file was removed and the builder now publishes the subject SHA through a job output.
2. `archive:false` single-file storage is not compatible with `actions/download-artifact`; inter-job subject transfer was moved to a standard archive artifact.

The final design therefore has two independent transport checks:

- GitHub Artifact service validates its archive digest on download (`digest-mismatch: error`);
- the attestor recomputes the actual subject-file SHA and requires it to equal the unprivileged builder job output.

No signing, provider or W1 authority invariant was weakened to fix either transport issue.

## Comparison with alternatives

### Plain V14 hashes

Useful for deterministic chaining and tamper detection, but anyone can create another self-consistent JSON chain. V15 adds an external signing identity.

### Custom in-toto predicate

Flexible, but policy-critical values inside a custom predicate remain workflow-controlled. V15 instead authenticates exact subject bytes and relies on certificate-derived identity for producer policy.

### AWS CloudTrail

CloudTrail remains the provider-operation witness for SSM/reboot events. GitHub attestation is complementary: it proves which GitHub workflow/source authenticated an evidence artifact; it does not prove an AWS operation occurred.

### Sigstore/cosign directly

GitHub Artifact Attestations already use a short-lived Sigstore certificate and produce a Sigstore bundle while integrating repository/workflow identity and GitHub verification APIs. Direct cosign would add another credential/toolchain surface without improving the current source-smoke objective.

## Post-research conclusion

V15 proves that the repository can create and independently verify a real keyless producer attestation without granting the attestor any AWS or Supabase credential path. This closes the mechanism-level gap discovered in V14.

The strongest next architecture is a **trusted reusable W1 receipt attestor**, not adding signing permission to provider jobs. GitHub's reusable-workflow guidance allows a caller to produce evidence while a separately pinned reusable workflow owns the signer identity. Downstream policy can then pin that reusable signer workflow with `gh attestation verify --signer-workflow`.

That design is preferable because:

- provisioning, capture and reboot jobs remain provider-domain principals only;
- attestation authority is reusable and independently reviewable;
- the signed subject remains exact validated receipt bytes;
- source/signer identity is certificate-derived;
- a compromised provider workflow cannot silently change the reusable signer implementation without changing verification policy.

Reference:
- https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/increase-security-rating

## Next boundary after V15 green

The next implementation should attest **validated V14 stage/chain bytes**, not synthetic smoke subjects:

1. live producer creates its existing non-authority receipt;
2. a separate reusable attestor receives only those bytes;
3. it reruns the corresponding off-host semantic validator;
4. it signs the validated receipt/link digest with GitHub Artifact Attestations;
5. a later compositor uses `gh attestation verify` with exact main/protected reusable-signer identity;
6. only then may an outer composition state `producer_attestations_authenticated=true`.

This still must not substitute for:
- provider-signed IID;
- CloudTrail provider events;
- changed Linux boot ID;
- post-reboot safety verification;
- database persisted readback;
- worker admission;
- W1 verification.

W1 remains READY, not VERIFIED.
