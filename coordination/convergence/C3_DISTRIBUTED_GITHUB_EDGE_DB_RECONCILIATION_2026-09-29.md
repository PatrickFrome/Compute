# C3 DISTRIBUTED GITHUB EDGE DB RECONCILIATION — 2026-09-29

## Frozen physical subject
`00d7c814213a97ac17504d5c598818bd99c588cb`

C3 does not mutate or rebuild this subject.

## Implementation
Branch:
`work/client-v1-c3-distributed-reconciliation-v1`

Draft PR:
`#1077`

Migration:
`supabase/migrations/20260929124500_client_v1_r83_distributed_reconciliation_v1.sql`

Contract test:
`apps/metaengine-browser/test/client-v1-r83-distributed-reconciliation.test.mjs`

Current branch head:
`9f2c13efe8fbc30f8f06384a19015d26725abec6`

## Research result
Existing repository reconciliation mechanisms consistently preserve a separation between:
- observation / evidence reconciliation,
- scheduler or lease authority,
- Browser actuation,
- release promotion.

They may classify deterministic state and persist a receipt, but must not convert ambiguous or external evidence into an automatic physical retry.

C3 follows the same contract:
- DB re-verifies its sealed durable facts;
- an external reconciler supplies independently observed GitHub + Edge facts;
- DB compares them against the immutable seal;
- result is observation only: `VERIFIED` or `DRIFTED`.

## Live verified observation
Evidence seal SHA-256:
`51b6d6c8cb7c5468415fc9570ef8f3f32d59fc79670ab329b0ba5add786c01c4`

External observation SHA-256:
`00dc5060dd7281cb85af3a8025628ba677c5246c65754962c7da2dadb815497d`

Reconciliation receipt:
`b841ecde-20b7-4833-9bf9-001ad92597b8`

Live result:
- state: `VERIFIED`
- drift: `[]`
- durable DB verified: true
- GitHub bound: true
- Edge bound: true
- promotion authority: false
- scheduler authority: false
- Browser actuation authority: false
- automatic retry allowed: false
- authority effect: false

GitHub observations:
- Package Smoke run `36561974797`, attempt 1, SUCCESS, exact frozen head
- Installed Electron run `36561969764`, attempt 2, SUCCESS, exact frozen head
- Edge Live Probe run `36561969735`, attempt 4, SUCCESS, exact frozen head

Live Edge observations:
- stable v8, digest `3ce87ea81481dbf8fd6afee819bed3bd3b41528e7b5c6842a2d7b7be38ccf829`
- canary v16, same digest
- both source-pinned to frozen subject

## Oracle repair
The first C2 evidence test used a lexical negative assertion that treated the fail-closed expression
`coalesce((...promotion_authority...)::boolean,true) is not false`
as if it were an authority grant.

That oracle was repaired to reject actual grants such as:
- `promotion_authority = true`
- emitted `'promotion_authority', true`

while allowing defensive `COALESCE(..., true)` defaults that reject missing evidence.

Repair commits:
- C2 evidence branch: `f2095e040eb4b7719518578214d2e2851da441ee`
- C3 branch: `9f2c13efe8fbc30f8f06384a19015d26725abec6`

## Next boundary
Wait for exact-head C2/C3 CI terminal readback.

After reconciliation contracts are green, begin C4:
- inventory current user-goal submission surfaces,
- converge on one typed positive API,
- keep pause/resume/approve/intervene/selectAgent typed and authority-scoped,
- do not resurrect duplicate Mission Control/socket command paths.
