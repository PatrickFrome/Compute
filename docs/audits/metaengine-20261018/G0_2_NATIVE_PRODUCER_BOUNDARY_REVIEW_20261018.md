# METAENGINE G0.2 — native producer boundary independent review

Review date: 2026-10-18. Parent baseline e35da1412b69287cbf86074dbbdb509bad4d0ffb (PR #1320). Result: SOURCE_GAPS_CONFIRMED / NATIVE_TRUST_UNKNOWN / NO PROMOTION. This review only inspects source, runs disposable source unit tests, and performs bounded read-only Windows OS observations. No installed Guardian challenge, Owner enrollment, secret read, attached PG SQL, installer or runtime change.

## 1. Producer/consumer audit

| Component | Observed production facts | Disposition |
| --- | --- | --- |
| W74 Owner Genesis | SupervisorDeviceIdentity defines bindHostOwnerGenesisW74 in supervisor-device-identity.mjs:332, but a tracked apps/metaengine-browser/src recursive reference check finds no production call. host-owner-genesis-custody-w74.mjs has a fixed authenticated-PG transaction and native fences, but no installed binding follows merely from its definition. | Source consumer missing; installed OWNER_READY UNKNOWN |
| W76 private Host custody | final-runtime-activation.mjs:162 and host-agent-remote-composition.mjs:97 instantiate createHostPrivateCustodyW76({identity}) with no readExistingGatewaySecret/readExistingOwnPostgresBirth/readExistingProtectedBackupRoot. host-private-custody-w76.mjs returns null on missing provider. | Fail closed; production provider chain incomplete |
| W52 native verifier | native-owner-verifier-w52.mjs requires six trusted producers: Host Owner, kernel process, Guardian Owner, signed installed executable, Owner secret store and own PG birth. Missing callbacks do not yield installed-ready. | Actual installed verifier unavailable |
| W60 native producers | host-native-owner-producers-w60.mjs has bounded read-only OS and Authenticode readers but still needs trusted identity, private custody, signed release and real PG producer. | Adapters only, not installed acceptance |
| W61 PG17 provider | own-postgres-birth-w61.mjs uses two distinct readOnly transactions, exact Owner epoch fixed scoped SQL, before/between/after Owner snapshot and postmaster birth comparison. | Source contract proven; user PG not queried |
| W75 Guardian exact 100ns | Native C++ W75 and W67 decoder preserve Windows FILETIME decimal ticks; source rejects mismatched exact incarnation even if ISO milliseconds match. | Source path only; installed Guardian proof UNKNOWN |

## 2. Source test results

Ran node --test test/native-owner-verifier-w52.test.mjs test/host-owner-genesis-custody-w74.test.mjs test/host-private-custody-w76.test.mjs from apps/metaengine-browser: 17/17 PASS. Ran node --test own-postgres-birth-w61.test.mjs from infra/client-state-runtime: 7/7 PASS. These 24 source tests include negative fixtures, but NONE attest the installed binary, Guardian, attached PG, or real Owner generation.

## 3. OS read-only process birth (diagnostics, not authority)

Two independent Process.GetProcessById(pid).StartTime.ToUniversalTime().ToFileTimeUtc() observations were taken without elevation or process manipulation:

| PID | Process | First FILETIME ticks (100ns) | Second | Interpretation |
| ---: | --- | --- | --- | --- |
| 13040 | Browser main | 134367565410227391 | 134367565410227391 | OS readings agree |
| 6748 | Postgres main | 134364411903053226 | 134364411903053226 | OS readings agree |
| 3396 | Guardian service | UNKNOWN | UNKNOWN | Access failed (RuntimeException) |

This is OS telemetry and cannot be promoted to signed, owner/project/epoch/source/Guardian challenge evidence. The original G0.1 showed unsigned QA Browser and Guardian, Owner runtime digest mismatch, and only a Postgres 17.6 listener, not a trusted own-PG17 birth proof.

## 4. Independent disposition of G0.1

Accept as correctly labeled metadata: clean exact baseline, PR-only GitHub CI status and known filter limitation, physical file digests, old Owner pin vs installed bundle mismatch, service/PID presence. Do NOT accept a running service as Guardian authority; OS FILETIME as protected Owner; loopback socket as PG schema, lease or birth; unit tests as installed readiness; unsigned staged ASAR as signed release provenance. A claimed 13th CI run still lacks independent proof because the current connector lists 12 PR-triggered runs on 7eaa00f.

No code/installer/service/OS-policy/Owner/private credential/PG alteration was made. No live SQL queries were issued. Secrets were not read or exposed.

## 5. Next required gate

G0.2: REVIEW_RECORDED, NATIVE_TRUST_UNKNOWN. G0 overall remains IN_PROGRESS; G1 BLOCKED. Exact next action G0.3: an independent reviewer should inspect both evidence reports and decide whether G0 enumeration is complete enough for EVIDENCE_READY, while leaving actual installed cryptographic identity/lease/provenance UNKNOWN until G1/G2. If no independent approval exists, preserve IN_PROGRESS. Do not create synthetic Owner proof, new root, second scheduler or unsigned QA reinstall.

Sources:
- [G0.1 report](./G0_1_EXACT_HEAD_INSTALLED_CI_EVIDENCE_20261018.md)
- [Binding register](../../../coordination/operator-control/AUDIT_CLOSURE_EXECUTION_REGISTER_20261018.md)
- [ADF ADR](../../METAENGINE_AUTONOMOUS_DEVELOPMENT_FABRIC_V1.md)
- [PR #1320](https://github.com/PatrickFrome/Compute/pull/1320)
