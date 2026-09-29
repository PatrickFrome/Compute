# C2 R83 EXTERNAL PHYSICAL EVIDENCE SEAL — 2026-09-29

## Frozen physical subject
`00d7c814213a97ac17504d5c598818bd99c588cb`

The qualified product branch remains unchanged. Post-hoc evidence is stored outside the frozen artifact subject.

## Implementation branch
`work/client-v1-c2-evidence-seal-v1`

Implementation commits:
- `1e92fd2bb885468d30509ea0947940d3698e84da` — durable external evidence seal migration
- `7dbb67b8cd63504e25c77900dd3306cbe1b8284d` — static authority/readback contract tests
- draft PR #1076 stacked on the frozen C2 branch

## Research
Repository evidence patterns consistently separate immutable execution subjects from later evidence/attestation state:
- effect bindings seal evidence but do not mint lease/execution authority;
- release workflows bind exact producer SHA/run/artifact instead of mutating the tested bytes;
- verification/candidate capsules explicitly keep signed-attestation and promotion authority false until a separate gate consumes them.

The R83 evidence seal follows the same separation.

## Live durable seal
Applied migration:
`client_v1_r83_physical_evidence_seal_v1`

Live seal:
- seal id: `acda1139-a64d-4aeb-9ee5-e03aa9c6981d`
- subject SHA: `00d7c814213a97ac17504d5c598818bd99c588cb`
- evidence SHA-256: `51b6d6c8cb7c5468415fc9570ef8f3f32d59fc79670ab329b0ba5add786c01c4`
- durable DB verification: true
- promotion authority: false
- automatic retry allowed: false
- authority effect: false
- external readback requires reconciliation: true

The verifier re-reads:
- CLAIMED installed-Electron enrollment,
- active non-revoked device/fingerprint,
- exact installed qualification run binding,
- exact READ_ONLY POLL command,
- exact lease owner,
- terminal COMPLETED status,
- terminal receipt authority=false,
- receipt runtime source SHA = frozen subject.

## Externally bound facts
The immutable payload also binds:
- installer SHA-256 `0214578fa908d703f613506ebc3519149e7c1d8a63bb6ebe452da7d5c4796486`
- Package Smoke run `36561974797`, run number 2962, attempt 1
- Installed Electron run `36561969764`, attempt 2
- enrollment request `e7dcb6b6-37ee-4dd8-8fcc-eaf58732207a`
- device `778e4811-eba8-4ccf-83f6-1552a6626f10`
- command `d89881a8-8330-4c49-8dbe-bcf428ef0825`
- stable Edge v8 + canary v16, digest `3ce87ea81481dbf8fd6afee819bed3bd3b41528e7b5c6842a2d7b7be38ccf829`
- rollback canary v15 / restore v16
- Edge live probe run `36561969735`, attempt 4

These observations are bound and hashed, but SQL intentionally does not pretend it can independently query GitHub Actions or the Supabase Management API.

## Security/readback
Supabase security advisor after migration:
- no WARN/ERROR introduced
- only INFO `rls_enabled_no_policy`; for the seal table this is intentional deny-by-default
- direct table access is revoked even from service_role; only security-definer verification/seal/readback functions are executable by service_role

## Next step
C3 distributed reconciliation must independently compare the sealed external facts against current GitHub + Edge + DB readback.

A reconciliation result may report VERIFIED/DRIFTED, but must not itself:
- promote a release,
- execute Browser commands,
- allocate leases,
- retry effects,
- rewrite the evidence seal.
