# METAENGINE RSI R9 — Provenance, durability, and acceptor research

Date: 2026-09-19  
Scope: zero-effect research and ancestry-safe implementation guidance for the RSI Phase36/Phase37 convergence line.  
Base: PR #839 @ `3a4ddceb2c211d9edd45f51139b84fbcbbee9d80`.  
Research branch: `work/browser-final-2026-convergence-rsi-r9-deterministic-lineage-v1`.  
Authority effect: **false**.

## 1. Decision summary

The next RSI reliability gain should **not** come from a new signer, scheduler, evaluator, library, or effect executor. The repository already contains a stronger cryptographic attestation plane than the Browser identity signer:

1. GitHub Actions artifact attestation through Sigstore/OIDC.
2. Independent `gh attestation verify`.
3. Exact signer workflow / signer digest / source ref / source digest policy.
4. Fresh trusted-root support.
5. Explicit self-hosted-runner denial in the existing R1 authority gate.

The Browser identity signer is intentionally unsuitable for arbitrary RSI provenance. Its route allowlist is restricted to native supervisor API endpoints and its manifest states `arbitrary_origin:false`. Expanding it to sign arbitrary RSI evidence would widen a trusted Browser authority surface and violate the existing no-second-authority-plane design.

Therefore RSI should reuse the **existing GitHub attestation verification plane** for cryptographic provenance and keep the Browser signer unchanged.

## 2. External research

### SLSA v1.2

SLSA provenance is verifiable information about where, when, and how an artifact was produced. The SLSA build provenance model separates:

- the output `subject`;
- `buildType`, which identifies the build template;
- externally supplied parameters, which are untrusted and must be verified downstream;
- resolved dependencies / materials;
- `builder.id`, which represents the transitive trusted build platform.

Source:
- https://slsa.dev/spec/v1.2/provenance
- https://slsa.dev/spec/v1.2/build-provenance

RSI adoption:
- skill/candidate identity must be the subject, never an evaluator-authored label;
- parent skill, source revision, exact implementation/component roots and evaluation contract are materials;
- builder identity and build recipe are separate trust inputs;
- candidate-provided parameters are data, not authority.

### in-toto

in-toto verifies that supply-chain steps were performed in the expected order, by authorized functionaries, over declared materials, and produced the expected products. Signed link metadata records command/step plus materials and products.

Source:
- https://in-toto.io/docs/getting-started/
- https://in-toto.io/docs/specs/

RSI adoption:
- do not maintain a second lineage graph;
- derive skill ancestry from the existing verified library;
- bind each materialization/evaluation/admission step to exact input/output digests;
- functionary/reviewer identity must be separated from the effect executor.

### GitHub artifact attestations / Sigstore

GitHub artifact attestations create signed provenance using Sigstore and GitHub Actions OIDC. Verification, not generation alone, creates security value. GitHub explicitly recommends verifying the signer identity and provenance policy with `gh attestation verify`.

Sources:
- https://docs.github.com/en/actions/concepts/security/artifact-attestations
- https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations
- https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/verify-attestations-offline
- https://docs.sigstore.dev/
- https://docs.sigstore.dev/about/security/
- https://docs.sigstore.dev/about/bundle/

Repository evidence already present:
- `.github/workflows/a1-evidence-attestation.yml`
- `controller/r1/live_recovery_source_attestation.py`
- `controller/r1/supervisor_r2_ingestion_authority_gate.py`

The R1 authority gate already invokes `gh attestation verify` with exact repository, signer workflow, signer digest, source ref, source digest, certificate issuer, predicate type, self-hosted-runner denial, and a fresh custom trusted root. RSI should reuse or generalize this existing trust plane rather than inventing a second signature verifier.

### GitHub's own warning matters

Artifact attestation establishes provenance and integrity, not that the artifact is intrinsically safe. RSI therefore still needs independent semantic, security/negative-transfer, retention, and consumer-local acceptors after cryptographic provenance passes.

### SQLite durability

SQLite documents that durable commit semantics depend on synchronization, not rename alone. In WAL mode, `synchronous=FULL` adds a WAL sync on each transaction commit and is described as ACID; `NORMAL` can lose recent committed transactions after power failure.

Sources:
- https://www.sqlite.org/atomiccommit.html
- https://www.sqlite.org/wal.html
- https://sqlite.org/pragma.html

RSI adoption:
- the current JSON temp-write + rename lifecycle must not be described as full power-loss durability;
- #909's post-rename file sync + POSIX parent-directory sync is a useful intermediate donor;
- longer-term lifecycle/effect journals should be evaluated against SQLite WAL/FULL or an equivalent transactional append log;
- the benchmark must distinguish application crash, OS crash, and power-loss guarantees.

### Windows durability

Microsoft documents `FlushFileBuffers` for flushing buffered file data, and `FILE_FLAG_WRITE_THROUGH` / `FILE_FLAG_NO_BUFFERING` for stronger persistent-media intent, with hardware caveats.

Sources:
- https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers
- https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilea

RSI adoption:
- do not claim Windows power-loss durability from POSIX-style directory fsync logic;
- qualify Windows persistence with a native test path or transactional storage whose Windows behavior is already characterized.

## 3. Repository-specific conclusions

### Keep Browser identity signing narrow

`supervisor-identity-delegation.mjs` allows only:
- supervisor state,
- cognitive deltas,
- workspace snapshot,
- command fetch/wait/result,
- exact command effect-intent/result routes.

It also fixes timestamp/nonce inside Browser-owned identity and rejects arbitrary origin/headers. This is the correct boundary. RSI provenance must not extend this signer.

### Reuse GitHub attestation verification

The strongest reusable trust primitive already exists in R1:
- a credential-free artifact/predicate is produced;
- GitHub OIDC signs an attestation;
- the Sigstore bundle is persisted;
- an independent verifier evaluates exact signer/workflow/source/issuer/predicate policy;
- a fresh trusted root can be supplied;
- the receipt remains non-authoritative until the next explicit gate.

For RSI, the artifact should be a deterministic, bounded provenance bundle containing only digest-bound evidence:
- skill/candidate subject digest;
- current source SHA;
- parent/material digests;
- implementation/component roots;
- evaluation-contract digest;
- structural provenance attestation digest;
- zero-authority policy fields.

No raw page text, model transcript, user input, secrets, or executable payload should be required.

## 4. Current implementation produced from this research

The R9 branch now contains:
- deterministic lineage verdict derivation;
- structural provenance attestation bound to exact verified-library subject/materials;
- candidate-supplied provenance status forbidden;
- acceptor trust-root closure;
- held-skill post-admission credit freshness;
- explicit exploration-graduation hold;
- zero-effect exposure transition proof.

The structural attestation intentionally says:
- `cryptographic_signature_verified:false`;
- `slsa_or_in_toto_compliance_claimed:false`.

That is deliberate. Structural binding is useful but must not be confused with a cryptographically verified attestation.

## 5. Next implementation slices

### R9-P1 — GitHub attestation adapter
Build a thin RSI adapter over the existing GitHub attestation plane, not a new signer. Acceptance:
- deterministic provenance bundle;
- existing GitHub OIDC/Sigstore signer;
- exact signer workflow + signer commit;
- exact source ref/digest;
- custom predicate type;
- fresh trusted root;
- `--deny-self-hosted-runners`;
- one verification result;
- persisted verification digest;
- zero Browser/effect authority.

### R9-P2 — Structural + cryptographic conjunction
Lineage provenance becomes PASS only when:
- structural subject/material verification passes, **and**
- the existing external cryptographic verification receipt binds the same structural attestation / provenance bundle.

### R9-D1 — durability donor reconstruction
Selectively reconstruct #909 persistence hardening:
- temp write;
- temp file sync;
- atomic rename;
- final file sync where available;
- parent-directory sync on POSIX;
- crash injection before/after every boundary;
- explicit Windows qualification state.

Do not copy #909's duplicated release-certificate fields.

### R9-D2 — transactional journal experiment
Benchmark current bounded JSON state against SQLite WAL with `synchronous=FULL`:
- commit latency p50/p95/p99;
- restart recovery latency;
- crash consistency;
- ambiguity reconciliation;
- state growth at 1k / 10k / 100k transitions;
- Windows and Linux separately.

Adopt only if it improves durability/scale without creating a second lifecycle authority.

### Phase37
Only after Phase36 exact-head CI and GitHub=DB=runtime identity convergence:
- same-instance paired control;
- process/outcome verifier split;
- anytime-valid sequential evidence;
- fixed false-admission budget;
- retention/cost/latency/negative-transfer/coalition/contamination gates;
- zero-effect graduation certificate first;
- separate one-attempt graduation effect second.

## 6. Fail-closed rules

- No LLM-majority vote is an acceptor.
- No candidate may author its final lineage/provenance verdict.
- No cryptographic provenance claim without actual signature verification.
- No provenance success implies semantic success.
- No storage admission implies retrieval exposure.
- No exploration exposure implies full activation.
- No durable workflow implies exactly-once physical effect.
- No source drift permits exposure/promotion/self-update effect.
- No branch label is canonicality proof; exact Git ancestry and semantic replay are required.
