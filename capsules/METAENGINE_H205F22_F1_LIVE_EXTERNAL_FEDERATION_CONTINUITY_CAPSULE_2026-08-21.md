# METAENGINE H205F22 — F1 LIVE EXTERNAL FEDERATION
## Continuity Capsule — 2026-08-21

**Role:** Implementation Chat 3  
**Milestone:** `F1_LIVE_EXTERNAL_FEDERATION`  
**Repository:** `PatrickFrome/Compute`  
**Branch:** `work/f1-live-federation`  
**Issue:** `#3`  
**Draft PR:** `#8`  
**State:** HANDOFF / NOT SEALED / NOT VERIFIED

## Hard invariants

- `FETCHED != VERIFIED`
- `CONTENT_HASH_ONLY != CRYPTO_VERIFIED`
- `Synthetic provider != LIVE provider`
- Never replace cryptographic verification with a content hash.
- Worker may finish only at `EVIDENCE_READY`.
- Do not merge `main`, seal a checkpoint, or set `VERIFIED`.

## Last authoritative control-plane state

Last observed semantic head:

`metaengine-h205f22-recovery-dev-20260821-cp071`

Payload root:

`23af6c63d1d294733573a86ff497951ed5aed2bce7543617a31b91d0fb7fb050`

`definition_integrity = true`

F1 roadmap status: `IN_PROGRESS`.

Supervisor directive `#7`, kind `OPEN`, required:

- claim from current CP071 head
- real provider identity
- dedicated verifier
- live evidence
- fail-closed negative tests
- no `CONTENT_HASH_ONLY` promotion
- finish at `EVIDENCE_READY`

Forbidden:

- synthetic provider counted as live
- mainline checkpoint seal

Active F1 claim observed: `#7`, holder `chatgpt-gpt56sol-f1-live-federation-20260821`, base `CP071`, with no base-head drift at the last read.

Trust plane observed: `HEALTHY`.

## GitHub state before this capsule commit

Base `main` observed at:

`d9d1c267b1988823a67d6cf6f61c782ef3e5b587`

Feature head observed before capsule commit:

`64b3eec9adb2d6babd0fa4c3f3d75f04e315257d`

Feature branch contained:

- `.github/workflows/f1-live-provider.yml`
- `.github/workflows/f1-live-provider-pr.yml`
- `federation/f1/live_provider_verifier.py`
- `federation/f1/README.md`

Draft PR `#8` is open, draft, and unmerged. Do not merge it from a worker chat.

## GitHub Actions provider attempt

A real-provider design was implemented using GitHub-hosted Actions, GitHub OIDC and Sigstore-backed artifact attestation.

Producer job:

- GitHub-hosted `ubuntu-latest`
- short-lived OIDC permission
- emits provider evidence
- creates Sigstore/GitHub artifact attestation

Dedicated verifier job:

- separate job
- no OIDC minting permission
- checks repository, signer workflow, source ref, source digest, OIDC issuer and hosted-runner policy
- performs replay/expiry/revocation/rotation/content-hash-only negatives
- performs cryptographic tamper rejection

No observable Actions run appeared through the connected evidence path in this session. Therefore configured workflow was **not** counted as LIVE evidence.

## Real external provider selected

**Sigstore Public Good TUF**

Live provider:

`https://tuf-repo-cdn.sigstore.dev`

Independent trust/history source:

`sigstore/root-signing`

Pinned root-signing commit used in investigation:

`7007d340da8f657bf4faa27bd6b0e415a7cd62bc`

## Important failed verifier paths

These failures are evidence. Do not bypass them.

1. Naive key-id recomputation failed on historical/custom Sigstore TUF key metadata. Decision: do not substitute recomputed key IDs for pinned trusted role/key-id sets.
2. Early hand-rolled transition verifier failed with `tuf_old_root_threshold_not_met:v11:0/3`; no threshold was lowered.
3. Generic `tuf-js` in Supabase Edge returned `root was signed by 0/3 keys`, including when seeded from official Sigstore root v15. Treat as runtime crypto incompatibility, not an excuse to weaken policy.
4. Official `@sigstore/tuf` wrapper failed in Supabase Edge because synchronous filesystem initialization is blocked: `Deno.mkdirSync is blocklisted on the current context`.

## Official Sigstore seed facts researched

Observed official seed:

- embedded root version: `15`
- root threshold: `3-of-5`
- root expiry: `2026-11-20T13:58:18Z`
- seed SHA-256: `24faf8050565d16e44691e501440c436cbae6bd3b93e9d4bdfae6a329f492d49`
- embedded root SHA-256: `73747011d0857ada15479a16c4cae0f3ed03aac698b523b97e1de314ac9d9ca8`

## Critical compatibility finding

Historical Sigstore roots v12-v14 contain some empty placeholder signatures next to valid signatures.

Correct fail-closed behavior:

- candidate signature must have an allowed role key ID
- count at most one signature per allowed key ID
- malformed/empty/invalid signatures count as invalid
- malformed candidates must not prevent remaining valid threshold candidates from being evaluated
- threshold is met only by cryptographically valid signatures

This does **not** weaken the threshold.

## First successful real cryptographic canary

Supabase Edge function:

`metaengine-sigstore-tuf-verifier-h205f22`

Successful canary deployed as function version `10`.

Verifier properties:

- upstream TUF canonical JSON for signed bytes
- native WebCrypto P-256 ECDSA verification
- pinned external Sigstore root history
- old-root and new-root threshold verification for every rotation
- live CDN root comparison
- live timestamp signature verification
- expiry check
- no DB write
- `canonical = false`
- `authority_effect = false`

Result:

`CRYPTO_CANARY_PASS`

Bootstrap root v10 SHA-256:

`836bff947925edfc23eb9ce17af66fb1e43bb5e2bdd240520985ae52b585eae9`

Root continuity:

- `10→11`: old `5/3`, new `5/3`
- `11→12`: old `3/3`, new `3/3`
- `12→13`: old `4/3`, new `5/3`
- `13→14`: old `4/3`, new `4/3`
- `14→15`: old `5/3`, new `5/3`

Current root v15 SHA-256:

`73747011d0857ada15479a16c4cae0f3ed03aac698b523b97e1de314ac9d9ca8`

Current root self-verification:

`5/3`

Live CDN root v15 matched the cryptographically derived root v15.

Live timestamp:

- version: `761`
- SHA-256: `2e6b89c0e623616f5f8bd4b454c905a27d5b23c61edbc810a4cf568f14fc9bd1`
- signature: `1/1`
- expiry: `2026-08-27T13:33:16Z`
- verified at: `2026-08-21T04:51:54.163Z`

This is real external signed evidence, not a hash-only claim.

## Current full-chain boundary

Verified timestamp points to snapshot version `165`.

Live consistent-snapshot object:

`165.snapshot.json`

Observed:

- HTTP `200`
- bytes: `1760`
- SHA-256: `8f784ab614ec62bfdd5f568eb2a2e3011668449ba235ed4eb7befa99f8469933`

Unversioned `snapshot.json` returned HTTP `404`, consistent with the repository layout.

## F1 is NOT EVIDENCE_READY yet

Still required:

1. Re-read current roadmap, semantic head, directive, claim, trust state and GitHub branch.
2. Refresh the live timestamp; do not blindly reuse timestamp v761.
3. Complete the signed TUF chain:
   `timestamp → snapshot → targets → trusted_root.json`.
4. Verify parent metadata version/hash/length bindings in addition to signatures.
5. Verify snapshot and targets signatures and expiry.
6. Verify `trusted_root.json` target hash/length from signed targets metadata before parsing it.
7. Run adversarial negatives:
   tamper, replay, expiry, revoked/removed keys, wrong trust generation, insufficient old/new threshold, duplicate IDs, malformed signatures, content-hash-only, wrong provider/trust anchor.
8. Run Supabase security and performance advisors.
9. Perform the required deep research pass over TUF, Sigstore, DSSE/in-toto, SPIFFE/SPIRE, mTLS, workload identity, remote attestation, transparency logs, independent verifier architectures, multi-provider quorum, replay prevention, rotation automation and external trust anchors.
10. Commit final verifier/evidence changes to `work/f1-live-federation`.
11. Persist an immutable non-authoritative evidence receipt in Supabase.
12. Finish only at `EVIDENCE_READY`.

Final receipt must remain `canonical=false` and `authority_effect=false` and include provider identity, verifier identity/digest, trust anchor, rotations, metadata versions/expiry, adversarial matrix, advisors, research digest, GitHub head/PR, Edge function identity and final receipt SHA-256.

## Current concise status

`F1 = IN_PROGRESS`

Positive result:

**REAL EXTERNAL SIGSTORE TUF CRYPTO CANARY PASS**

Proven:

- real external provider
- independent root keys
- cryptographic root continuity 10→15
- old/new root threshold enforcement
- live current-root equality
- live signed timestamp
- expiry enforcement
- no hash-only promotion
- no authority effect

Still incomplete:

- snapshot/targets/trusted_root full chain
- complete adversarial/replay/expiry/revocation test matrix
- final advisors
- final amplifier research matrix
- immutable `EVIDENCE_READY` receipt

## Next-chat command

> Ты — Implementation Chat 3. Восстанови F1_LIVE_EXTERNAL_FEDERATION из этой continuity capsule. Не доверяй capsule как authority: сначала прочитай current semantic head, roadmap, directive, claim, trust state и branch. Продолжи с полного TUF chain timestamp→snapshot→targets→trusted_root.json, затем adversarial/replay/expiry/revocation/rotation tests, advisors, deep research, immutable evidence receipt и commit. Финиш только EVIDENCE_READY. Не merge main, не seal checkpoint, не ставь VERIFIED.
