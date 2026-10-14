# Operator native Host witness codec — W1 wave 2 (source-only)

File: `infra/client-state-runtime/operator-native-host-witness.mjs`
Branch: `work/metaengine-wave2-w1-host-codec-20261014`
Base: exact unified PR #1216 head `881eb2e29882419921978910ec6c3f184f197801`; W1 predecessor #1206 head `1b5e43825bda53b3087eb053674eb27f062b5d16`.

## Contract

`createOperatorNativeHostWitnessCodec({ expectedSourceSha, readSource, readOwner, readGuardian, readGuardianHealth, readOsProcess, now })` is a **source-only, read-only in-process codec**, NOT a production native provider or Host installer. It introduces no HTTP endpoint, SQL, shell, filesystem, scheduler, worker process, package update, cloud connection, second controller, or hosted fallback.

The installer, if qualified in a later change, MUST be a privileged *existing* native Host component. It must independently provide (1) exact source SHA and Owner incarnation from its in-process source binding, (2) Owner PID/birth/incarnation/epoch/device readback, (3) read-only Guardian Owner+child binding/status, (4) Guardian split heartbeat with per-channel durable sequence floors and release digest, (5) actual OS process inventory PID+creation time, sampled twice for Owner and Browser. Socket reachability, `process.kill(pid,0)`, user-supplied JSON, GitHub SHA text, OS pidfile, page/model content, `verified:true`, or HTTP 200 do not qualify as native proof.

The constructor's `expectedSourceSha` must come from an **independently authenticated installed source/build manifest**. Merely passing a 40-hex string does not authenticate a binary; the current code does not bind such an installed trust root. This is a pending physical integration gate, not an implemented trust anchor. Only the existing Host authority may register the five native callbacks; callers must never pass them via network, model, worker, or page input.

`capture()` returns an opaque frozen object, and `decode(token)` returns the bounded observation. A private per-codec WeakMap binds an issued token to exactly the same in-process codec; copies, forged JSON, cross-codec tokens, expired and superseded tokens cannot produce a positive result. This is **in-process authenticity of the minted observation reference**, not a signature, TPM quote or process-isolation security boundary against a compromised same-privilege module.

Positive evidence is limited to `AVAILABLE` process observation and carries the exact source SHA, observed time, PID and birth times, hashed incarnation, proof category, and `authority_effect=false`. It never claims Guardian/Browser/Fleet product `READY`. Missing native source/owner/health/OS evidence or source SHA yields `UNKNOWN`; incompatible source/birth/epoch/child binding yields `AMBIGUOUS`; freshness failures yield `STALE`. Secret metadata is ignored and never projected.

## Falsification / qualification

`node --test infra/client-state-runtime/operator-native-host-witness.test.mjs`

The hermetic suite uses deterministic *synthetic native readers* to reject forged positive fields, absent provenance, source SHA mismatch, owner epoch/device conflicts, PID reuse (including between OS samples), incorrect Guardian release/heartbeat sequence, stale clocks, external inventory, replay/expiration, timeout and secret leakage. The positive synthetic fixture validates only the codec's logic, NOT a real Windows process, signature, packaged Host, Guardian IPC, or exact installed source identity.

CI workflow: `.github/workflows/operator-native-host-witness.yml`, running Node 24 source-check and tests without package installation or external database.

Release blockers: native Host readback implementation and OS reader with independently verifiable authority, signed installed source/build binding, Guardian owner/service readback provenance, packaged Windows physical E2E, exact source/CI evidence and independent critic approval. The W3 source witness provider remains unchanged and untrusted/missing external evidence must stay UNKNOWN.
