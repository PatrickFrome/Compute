# W1 Authenticated Receipt Attestation V15

Date: 2026-08-28
Status: GitHub keyless attestation mechanism contract / non-authority

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

## Comparison with alternatives

### Plain V14 hashes

Useful for deterministic chaining and tamper detection, but anyone can create another self-consistent JSON chain. V15 adds an external signing identity.

### Custom in-toto predicate

Flexible, but policy-critical values inside a custom predicate remain workflow-controlled. V15 instead authenticates exact subject bytes and relies on certificate-derived identity for producer policy.

### AWS CloudTrail

CloudTrail remains the provider-operation witness for SSM/reboot events. GitHub attestation is complementary: it proves which GitHub workflow/source authenticated an evidence artifact; it does not prove an AWS operation occurred.

### Sigstore/cosign directly

GitHub Artifact Attestations already use a short-lived Sigstore certificate and produce a Sigstore bundle while integrating repository/workflow identity and GitHub verification APIs. Direct cosign would add another credential/toolchain surface without improving the current source-smoke objective.

## Next boundary after V15 green

Once the attestation mechanism is exact-green, the next live design should attest **validated V14 stage/chain bytes**, not synthetic smoke subjects:

1. live producer creates its existing non-authority receipt;
2. a separate attestor job receives only those bytes;
3. it reruns the corresponding off-host semantic validator;
4. it signs the validated receipt/link digest with GitHub Artifact Attestations;
5. a later compositor uses `gh attestation verify` with exact main/protected signer identity;
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
