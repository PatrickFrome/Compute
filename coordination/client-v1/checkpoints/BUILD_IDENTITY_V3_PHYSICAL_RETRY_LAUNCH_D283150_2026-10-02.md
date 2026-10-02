# Build Identity V3 physical retry launch checkpoint — 2026-10-02

Runtime source: `d283150bc8a3338a76b98c369b67fb7e846b207b`  
Runtime branch: `work/build-lockfile-material-v1`  
Draft PR: #1094  
Evidence branch: `analysis/build-identity-v3-retry-d283`  
Reserved package identity: `0.7.0-dev.36990000001.1`

This checkpoint is evidence-only. It does not mutate the tested source, live Browser installation, release authority, Guardian authority, or Supervisor/task admission.

## Precondition: exact source-only qualification

Browser Build Identity V3 Source Qualification #20 / run `36988959137` — **SUCCESS**

Source contract:
- focused supply-chain tests: **58/58 PASS**
- package-lock SHA-256: `a167e95a1d41d5afcb13861669ce61887fe64c14a3466a186535d901ef9bb0f3`
- installed dependency-resolution SHA-256: `44db8c97004e4655d85cd0f775ad5df136841dc1f1b1cd55a2ec816a461cda51`
- dependency count: **501**
- Node: `v24.21.0`
- npm: `11.19.0`
- Bun: `1.3.3` / observed revision `1.3.3+274e01c73`

Windows regression:
- two clean `npm ci` installs produced the same frozen-material proof;
- V2 qualified-installer compatibility fixture passed;
- full Browser Node regression: **3911/3911 PASS**
- skipped: 0

## Why this retry exists

First physical V3 attempt:
- PR #1093
- source `245920c1a45851a1d30c25341ce2ca33457bc5c7`
- consumed package `0.7.0-dev.36980000001.1`

Package Smoke #3144 itself succeeded, but Self Update #3597 exposed a source defect:
valid historical V2 bindings were dereferencing V3-only fields under PowerShell StrictMode.

The successor fixes that boundary and adds the V2 fixture to Windows source qualification.

Installed Chat #2426 failed OIDC with HTTP 403 only after #1093 was intentionally closed; the successor PR must remain open through terminal consumer qualification.

## Retry physical matrix created

PR #1094 opened as draft against the qualified one-producer base.

Exact-head workflows created:
- Final Runtime Activation #2010
- Dirty Profile #1038
- Autonomous Soak #2679
- Workspace Reincarnation #567
- Critical Audit #2603
- Installed Chat #2427
- Package Smoke #3145
- Browser Shell #3550
- Host Resilience #515
- Self Update #3598

At checkpoint creation:
- Package Smoke #3145 is queued;
- no claim is made yet that the new package version is physically consumed;
- source must remain unchanged while the matrix is pending.

## Consumption rule

The moment Package Smoke #3145 starts its producer runner, `0.7.0-dev.36990000001.1` is consumed.

If any source change becomes necessary after that point:
- do not rerun the same package identity;
- advance package version in the same correction commit;
- re-run source-only qualification before creating another physical producer.

## Acceptance gate

Qualification requires:
- Package Smoke terminal SUCCESS;
- one exact candidate artifact;
- Installed Chat SUCCESS;
- Final Runtime SUCCESS;
- Autonomous Soak SUCCESS;
- Self Update physical E2E SUCCESS;
- Shell/Critical/Dirty/Host/Workspace SUCCESS;
- all physical consumers reverify the same producer run/attempt and V3 materials.

PR remains draft. No merge/release/live-install authority is granted.
