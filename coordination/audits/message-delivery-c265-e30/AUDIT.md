# METAENGINE — message delivery source-only audit (c265 → e30)

Status: **BLOCKED ON SOURCE MATERIALIZATION**. This is a **trace-oracle scaffold**, not a repair to METAENGINE production code, and not a positive delivery qualification.

## Permitted source identity / GitHub evidence

- Repository: `PatrickFrome/Compute`.
- Transfer branch: `work/source-transfer-c26565e-20261103`, head `accb28e72c87c059e780efb8e6681886b33e9b4f`.
- Archive: `coordination/source-transfer/c26565e/archive.part00`, `.part01`, `.part02`, concatenated in that order.
- GitHub archive part blob SHA-1: `485ca6ce2d467f9e577aaf263626af52154425ab`, `a02e1d8217d878fdabbf01ff7f7c04b883158407`, `b0b280633fff1e794d6b6079e313412b6e2ca04e`.
- Archive part lengths (GitHub API): 7,200,000 + 7,200,000 + 1,657,953 bytes.
- Expected archive SHA256 from transfer README: `4200e492828dbb857aaa737a7ce56d0aeda3c97c84f7743b1501ef2f229d3636` (**not independently computed**).
- Source revision from transfer README: `c26565e58ab92dcbcda9663c4d231bdf4a9a7ee6`; pre-patch tree `2dbe253e97379532f6f4b52ef7edf26109a9266d` (**not independently verified**).
- Integrated patch commit: `d53ccd4135f28206d91d6804cf0626095565e6af`; GitHub blob SHA-1 `79d40bf024a6553656b86fb1a29c1313dd458a0e` at `coordination/source-transfer/c26565e/integrated-c265-to-e30.patch` (1,269,917 bytes by GitHub metadata).
- Expected post-patch Git tree provided for this task: `90fa5633d7926dd71a7303266073e0625325e740` (**not verified**).

## Precise blocker

The GitHub connector can fetch the transfer README and the plaintext integrated patch; for the three binary archive blobs it produces a UTF-8 decoding failure, while GitHub's Contents view for large files provides no file payload. The isolated executor cannot resolve `github.com` for Git operations or HTTP downloads. Consequently **the prescribed archive cannot be reconstructed, hashed, unpacked, or checked out here**, and the e30 tree cannot be verified. Do not substitute the public historical branch, a prior Space zip, the installed Windows client, or another repo snapshot.

The assistant has **not** inspected actual c265/e30 message producers, pending read handlers, delivery reference stores, ACK implementations, or production IPC. No defect in those components has been reproduced, and no production fix is claimed. This report and its inert tests are the only proposed changes.

## Trace-contract audit targets (NOT RUN against METAENGINE)

| Case | Required observation | Failure to look for |
| --- | --- | --- |
| Producer → pending | Durable message identity linked to producer and authorized task; read can find pending message | Produced item missing from pending reads |
| Duplicate delivery | Same logical message / reference replay does not duplicate externally visible completion | Multiple distinct effects for one message and consumer |
| Duplicate ACK | Re-ACK and duplicate readback converge on one terminal record | Second terminal effect or changed meaning of reference |
| Restart | Pending cursor and unresolved deliveries survive an agent/host restart with durable provenance | Lost work, old in-memory success reused as proof |
| Pagination | All pages processed until authoritative completion; next cursor chains without omission | Premature `caught_up`, cursor gap, stuck cursor |
| ACK reply lost | Outcome remains unknown until durable readback; retry is idempotent | Success inferred from request/timeout/local flag |
| Native/IPC close unknown | No synthetic success or confirmed ACK without original durable evidence | Optimistic terminal completion |
| Cross-agent reference | ACK must refer to a previously delivered reference for the correct consumer | Orphan ACK or reference collision |

A real audit must map each case onto actual source entrypoints, inspect SQL/transaction and transport commitments if present, and run deterministic project tests against an isolated checkout of the **verified** tree. The attached oracle accepts normalized *trusted observations* as input; it cannot establish their authenticity and is never an authority source.

## Evidence and outcomes

- GitHub transfer README and exact transfer commits: **PASS (metadata retrieval)**.
- Plaintext integrated patch retrieval: **PASS (GitHub connector)**.
- Reconstructed archive SHA256: **NOT RUN (binary bytes unavailable)**.
- Base Git tree `2dbe253e...`: **NOT RUN**.
- Integrated Git tree `90fa5633...`: **NOT RUN**.
- Actual production delivery/ACK audit: **NOT RUN**.
- Production defect reproduction/fix: **NOT RUN — no production patch**.
- Inert standalone trace-oracle unit tests: **16 PASS / 0 FAIL** on Node.js v22.16.0.
- External DB, PC, services, network listeners, approvals, budget policy, trust boundaries, installation, signing, or merge: **NOT RUN / UNCHANGED**.

### Next safe step

Materialize the **exact** archive binary from the cited GitHub commit into an isolated executor with direct authorized GitHub download access, verify its SHA256 and source tree, apply the d53 patch, verify the expected tree, then locate the actual message delivery entrypoints. Use the oracle only after producing concrete normalized observations from those entrypoints. Any defect repair must be independently reviewed and delivered in a new narrow production patch; this draft must not be treated as that repair.
