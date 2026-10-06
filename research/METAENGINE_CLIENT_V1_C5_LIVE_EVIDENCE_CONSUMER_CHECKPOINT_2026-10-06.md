# METAENGINE Client V1 C5 — Independent LIVE Evidence Consumer Checkpoint

Date: 2026-10-06  
Status: **EVIDENCE_READY — PREPARE_ONLY / CONTROLLED CRYPTOGRAPHIC VECTOR**  
Branch: `work/client-v1-c5-live-evidence-consumer-v1`  
Qualified implementation head before report commit: `68e288e9f5c005feffbc222fe25c8cddee7666a0`

## Roadmap reconciliation

Canonical Level-1 owner remains:

**C2 — First Serial Coding Loop**

Canonical acceptance shape remains:

`repo checkout → isolated edit → real build/test → verified artifact → serial loop end-to-end`

This checkpoint does not execute a live Agent goal. It closes the evidence-consumer gap immediately after the previously qualified LIVE launch capsule.

Client-side state after this slice:

- C5 useful-work proof contract: EVIDENCE_READY / PREPARE_ONLY
- C5 physical reference producer: EVIDENCE_READY / SYNTHETIC
- C5 durable restart continuity: EVIDENCE_READY / PREPARE_ONLY
- C5 installed-process restart continuity: EVIDENCE_READY / PREPARE_ONLY
- C5 LIVE launch readiness: EVIDENCE_READY / PREPARE_ONLY
- **C5 independent LIVE evidence consumer: EVIDENCE_READY / CONTROLLED CRYPTOGRAPHIC VECTOR**
- C5 LIVE useful work: NOT_PROVEN
- canonical C2: NOT_PROVEN
- canonical promotion authority: false

## Gap closed

The launch-readiness matcher already required the structural labels:

- `evidence_class=LIVE`
- `evidence_origin=SIGNED_SUPERVISOR_READBACK`

Those labels alone do not cryptographically prove that a trusted Supervisor actually signed the evidence bundle.

The new consumer adds a separate authenticity layer.

A LIVE result now requires all of the following:

1. exact readiness capsule;
2. exact dispatch authorization;
3. exact Client submission receipt;
4. exact completed execution proof;
5. exact useful-work proof;
6. actual artifact bytes rehashed by the consumer;
7. exact provenance object rehashed by the consumer;
8. exact artifact-verification receipt rehashed by the consumer;
9. exact independent-review receipt rehashed by the consumer;
10. a detached Ed25519 Supervisor envelope binding all of those digests;
11. the signing key id to resolve through an external trusted-key map;
12. trust-root context `PINNED_SUPERVISOR`.

A bundle-provided public key is insufficient for LIVE acceptance.

## Implementation

Consumer contract:

`coordination/client-v1/c5-live-readiness/client-c5-live-evidence-consumer.mjs`

Offline verifier CLI:

`coordination/client-v1/c5-live-readiness/client-c5-live-evidence-verify.mjs`

Controlled cryptographic vector generator:

`coordination/client-v1/c5-live-readiness/client-c5-live-evidence-test-vector.mjs`

Adversarial suite:

`coordination/client-v1/c5-live-readiness/client-c5-live-evidence-consumer.test.mjs`

Two-job qualification:

`.github/workflows/client-v1-c5-live-evidence-consumer.yml`

No packaged Browser runtime file is modified by this slice.

## Cryptographic convention

The consumer reuses the repository's existing sovereign-fabric convention:

- Ed25519;
- envelope algorithm label `EdDSA`;
- exact key id;
- strict 64-byte base64url signature encoding;
- canonical JSON signing bytes;
- trusted public-key map;
- unknown key = fail closed.

Existing in-repository precedents:

- `apps/metaengine-browser/src/browser-fabric-capability.mjs`
- `apps/metaengine-browser/src/browser-fabric-desired-state-policy.mjs`

The C5 consumer does not mint trust.

It only verifies against a caller-supplied trust root.

## Supervisor envelope

Schemas:

- claims: `metaengine.client-v1.c5-live-supervisor-readback.v1`
- envelope: `metaengine.client-v1.c5-live-supervisor-envelope.v1`

Signed claims bind:

- capsule SHA-256;
- source head;
- dispatch-authorization SHA-256;
- submission-receipt SHA-256;
- execution-proof SHA-256;
- useful-work-proof SHA-256;
- provenance SHA-256;
- artifact-verification receipt SHA-256;
- review receipt SHA-256;
- artifact SHA-256 and byte count;
- request id;
- workspace id;
- task id;
- result SHA-256;
- result-claim SHA-256;
- Agent conversation URL SHA-256;
- issuance timestamp.

Re-signing a changed claim does not help if the changed claim no longer matches independently recomputed bundle material.

## Artifact and provenance verification

The independent consumer rehashes the actual artifact bytes.

Controlled exact artifact:

`sha256:71fe5c044aa937444d99eec4d0c27cc412c4aab31caba313a66630eda6d5f2f8`

Bytes:

`101`

The consumer also validates and rehashes provenance containing:

- exact capsule digest;
- exact source head;
- repository identity;
- checkout SHA;
- patch digest;
- changed-file manifest digest;
- command-contract digest;
- artifact subject digest;
- artifact byte count;
- isolated workspace = true;
- host repository mounted = false;
- host git directory mounted = false;
- linked worktree exposed = false;
- network used = false;
- authority effect = false.

Controlled provenance digest:

`e3c3189ff0adab0c696745a5ba991a95fb075e7784129362ab04aa07fc7480ab`

## Controlled cryptographic vector

The producer creates an ephemeral Ed25519 key pair only to test the cryptographic machinery.

Key id:

`test-vector:c5-supervisor-01`

The producer artifact contains the public key.

The private key is not written to the artifact or repository.

The producer explicitly proved:

- public key present;
- private-key file absent;
- no `BEGIN ... PRIVATE KEY` material in the uploaded bundle;
- provider contacted = false;
- goal submitted = false;
- LIVE effect authorized = false;
- Client C5 LIVE useful work verified = false.

Controlled vector capsule:

`sha256:7c9a247b2466782daecb6e50ea09b012380a054709dfb8110c4be124bdc5398a`

## Two-VM independent qualification

Workflow:

`Client V1 C5 Live Evidence Consumer`

Run:

`37405794718`

Exact source head:

`68e288e9f5c005feffbc222fe25c8cddee7666a0`

Producer job:

`112082961056` — SUCCESS

Independent consumer job:

`112083025417` — SUCCESS

GitHub documents that each GitHub-hosted job runs in a fresh runner instance and standard multi-CPU hosted runners use new VMs per job.

Reference:

https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job

Therefore the consumer did not share the producer's process memory or filesystem.

Its inputs were:

- exact verifier source checkout;
- immutable GitHub Actions artifact handoff.

## Adversarial tests

Producer contract run:

- tests: **33**
- passed: **33**
- failed: **0**
- skipped: **0**

The new adversarial suite proves rejection of:

- untrusted Supervisor key;
- modified Ed25519 signature;
- capsule drift;
- dispatch-authorization drift;
- objective drift;
- baseline drift;
- artifact-byte drift;
- provenance drift;
- artifact-verification receipt drift;
- review-receipt drift;
- command-contract drift;
- useful-work proof drift;
- re-signed Supervisor claims that no longer match recomputed bundle material;
- unknown/self-asserted trust-root kind.

The positive `PINNED_SUPERVISOR` unit test proves only verifier semantics. Unit tests are not live evidence.

## Immutable vector artifact

Artifact id:

`11387815355`

Name:

`client-c5-live-evidence-test-vector-68e288e9f5c005feffbc222fe25c8cddee7666a0`

Artifact digest:

`sha256:9397f52a19407264c7961c3da961e4f17c56ced13907ed9b2f43185cfd2d571a`

The archive contains exactly 12 files.

No private key material is present.

Selected file digests:

- dispatch authorization: `404e7349e0febbabeed7d3fd3ed31c609fb0d09cf94f5f1f630a185f9463de37`
- submission receipt: `a01cd7c6bbef27583102759629d969b421b468ba25cf9892c5d3264c7771833e`
- execution proof: `efda49285c8973873bc5035339f51820b30a5c5643a2ea7bd0246cb73b0d74f4`
- useful-work proof: `f0edcea84a99fdc20938d1b6919ded0c589cce0205064ad352cfd5c4f281447e`
- provenance: `e3c3189ff0adab0c696745a5ba991a95fb075e7784129362ab04aa07fc7480ab`
- artifact verification receipt: `1ef3be32d70d99b3e308cea2b133a779235c8c8b9b9593c3de3fc2dd36176861`
- review receipt: `bdad2df802a89c98ae90db88a86d0b3718acb36936f47f81facde204a5ab419d`
- Supervisor envelope: `ddd540e3f3d9806a8a22fb9dccbba301d56f04fb0f6673fb3302f285d2fb54be`
- artifact bytes: `71fe5c044aa937444d99eec4d0c27cc412c4aab31caba313a66630eda6d5f2f8`

## Independent receipt

Artifact id:

`11387356797`

Name:

`client-c5-live-independent-verification-68e288e9f5c005feffbc222fe25c8cddee7666a0`

Artifact digest:

`sha256:0ba4472f9330f5da1d54f04967314535750a5468b7e3934eb8b393e2175cf0bc`

Independent receipt file SHA-256:

`eff5e835ebb79bfa4e12263e1132274d8f7d4d90cd87027cfe37f54191acb5c4`

Receipt state:

`CONTROLLED_TEST_VECTOR_VERIFIED`

Receipt proves:

- signed Supervisor envelope cryptographically valid: true
- exact capsule binding: true
- exact dispatch authorization: true
- exact submission binding: true
- exact execution binding: true
- exact useful-work binding: true
- artifact subject verified: true
- provenance verified: true
- artifact-verification receipt verified: true
- independent review verified: true
- independent verifier: true
- trusted Supervisor key verified for LIVE: **false**
- Client C5 LIVE useful work verified: **false**
- canonical C2 promotion authorized: false
- authority effect: false

## Self-asserted trust root rejection

The independent VM deliberately reran the verifier as:

`PINNED_SUPERVISOR`

while pointing the trust-key argument at the public key contained inside the downloaded bundle.

The verifier rejected before evidence validation with:

`client_c5_live_pinned_trust_key_must_be_external_to_bundle`

This prevents:

`bundle → invent key → sign itself → call itself trusted`.

## Amplifier research — GitHub artifact attestations

GitHub artifact attestations can establish build provenance, and GitHub documents verification with:

`gh attestation verify`

GitHub also documents offline verification using:

- artifact;
- downloaded attestation bundle;
- trusted-root file.

References:

https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations

https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/verify-attestations-offline

This is a strong future supply-chain amplifier for the C5 artifact.

It does not replace the semantic Supervisor envelope because the C5 Supervisor signature additionally binds:

- Client request/workspace/task identity;
- exact dispatch authorization;
- Agent-origin/result proof;
- patch/command/review chain.

The two layers answer different questions:

- GitHub/Sigstore attestation: where/how was this artifact produced?
- C5 Supervisor readback: did this exact authorized Client goal produce and accept this exact useful-work chain?

## Trust-root boundary

Production LIVE acceptance still requires an external pinned Supervisor public key.

The current controlled vector does not establish that root.

Acceptable future sources can include a separately governed/versioned public-key manifest or another Supervisor-controlled trust distribution mechanism, but the trust root must not be supplied by the same evidence bundle it authenticates.

Current state:

- Supervisor signature mechanics: PROVEN
- self-asserted trust rejection: PROVEN
- pinned production Supervisor trust root: NOT_PROVEN

## No live actuation

This checkpoint performs no:

- device enrollment;
- Client goal submission;
- Supabase/Edge request;
- provider/Agent call;
- production repository edit;
- live artifact creation;
- live environment approval;
- release mutation;
- canonical promotion.

No provider credentials are required by the consumer.

The verifier requires no network.

## Remaining live boundary

The safe local evidence path is now complete enough to consume a real C5 run.

Before the first live dispatch, external state still must prove:

1. GitHub environment `client-v1-c5-live` and its reviewer protections;
2. externally pinned Supervisor public key/trust-root policy;
3. live credentials scoped only to the protected effect job;
4. explicit single-flight dispatch authorization bound to the qualified capsule.

Then the first live run can execute:

`exact capsule → approved dispatch → Client submission → Agent result → useful-work bundle → pinned Supervisor signature → independent consumer → durable restart readback`

without allowing any one producer to self-certify success.

## Checkpoint

C5 independent LIVE evidence consumer:

**EVIDENCE_READY / CONTROLLED CRYPTOGRAPHIC VECTOR**

Pinned production Supervisor trust root:

**NOT_PROVEN**

Environment protection:

**NOT_PROVEN**

Live effect authorization:

**NOT_GRANTED**

Provider contacted:

**false**

Goal submitted:

**false**

Client C5 LIVE useful work:

**NOT_PROVEN**

Canonical C2:

**NOT_PROVEN**

Canonical promotion authority:

**false**
