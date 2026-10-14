# Client W50 — exact source-sync parent and readback manifest

Status: **SOURCE / SYNTHETIC qualification only**, not installed Client acceptance.
Request: `metaengine-client-wave8-w50-20261015-001`.
Repository: `PatrickFrome/Compute`. Owned branch:
`work/metaengine-client-wave8-w50-20261015`.

## Checked parents and boundaries

- **Exact checkout/parent:** W38 DRAFT #1267 `2e9018d14cfe55256ddc5a94693ff0a288b90318` (full checkout, not main).
- **Inspected, NOT merged:** W39 DRAFT #1263 `ee39b256e2b54f5dfddf4bff021977c0185fb744`, especially its exact `last_verified_head_sha`/lease/repository WorkspaceBinding and independent GitHub-ref proof boundaries.
- **Previously observed main:** `b26f2d4693e7bab3648e0930b7a9e2c75baef58e`; **previously observed integration/compute-unified-v1:** `a23b647220c6bdeaa4340f804575dc2009e434cb`. These are inspected refs, NOT ancestry or acceptance for W50.
- **W43 request/owned tab** `metaengine-client-wave8-w43-20261015-001` remains **AMBIGUOUS** as an external delivery/ACCOUNT-load event: do not resend, recover by sidecar/UI, edit or attribute tab completion. A subsequent **independent GitHub read** found W43 source **DRAFT #1273** on `work/metaengine-client-wave8-w43-20261015`, exact head `b24e240b3a273a9622a3983a1029faa53d6a6576`, created `2026-10-14T22:23:20Z` (later than the 22:21Z missing-ref audit). This establishes a reviewable remote source candidate, NOT installed integration, LIVE acceptance or a recovered tab delivery. W50 neither modifies nor merges it.
- The only living roadmap is `coordination/operator-control/ROADMAP_UNIFIED_COMMAND_CONTINUITY_V1.md` on `work/roadmap-no-cloud-capsule-20261013`. W50 does not edit it (W49 ownership).
- No tracked root or relevant scoped `AGENTS.md` was found in the inspected W38 source ancestry. Recheck if ancestry changes.

## Exact W50 observation contract

`src/client-source-sync-preflight-w50.mjs` reuses the **existing native WorkspaceBinding observer normalizer** plus **existing locked Git worktree inventory planner/verifier**, and requests read-only fixed operations from its trusted injected Git provider. It independently needs an existing native trusted binding getter and a current **noncached GitHub ref read** from the existing source-evidence service. It is not exposed as an arbitrary endpoint, shell, GitHub URL, Git path, SQL query or action channel. The module itself does not spawn Git or call GitHub, so it cannot promote model-provided inputs to proof.

A positive SOURCE witness requires exact repository `PatrickFrome/Compute`, a current same-name tracked upstream `origin/<bound branch>`, a strictly credential-free canonical origin URL, valid Owner-provided managed-worktree path, locked unique nonprunable non-detached worktree, current GitHub branch head SHA matching the two local inventory readbacks and the bound `last_verified_head_sha`, clean tracked+untracked status before and after, no binding drift, and fresh noncached GitHub observation. Cached `origin/*` or historical branch membership is never sufficient. Every failure is `UNKNOWN` or `UNSYNCED`; sensitive URLs/paths/errors never leave the adapter.

The positive result contains a SHA-256 digest of canonical bounded source observation fields; it includes `parent_source_sha` and `inspected_w39_sha`. No private filesystem path, token, raw remote URL or hidden native state is part of the public witness. All outputs have `authority_effect=false`, `installed_healthy=false`, `installed_active=false`, `owner_accepted=false`. Even positive results remain `SYNCED_SOURCE`, not physical LIVE. This code must be bound only to a truly trusted native Owner/source provider by the responsible integration owner; a source fixture or injected callback is not authentic Host/Guardian attestation.

## Reproduction

From the exact W50 branch head in a full checkout:

```sh
node --check apps/metaengine-browser/src/client-source-sync-preflight-w50.mjs
node --test --test-concurrency=1 apps/metaengine-browser/test/client-source-sync-preflight-w50.test.mjs apps/metaengine-browser/test/workspace-git-hardening.test.mjs apps/metaengine-browser/test/workspace-binding-observer.test.mjs
git diff --check HEAD^ HEAD
```

The tests cover detached/moved HEAD, stale cached remote, missing or alternate upstream, credential URL, dirty/untracked source, changed binding, unavailable GitHub, forged page proof and non-disclosure, plus a disposable locally generated real Git worktree. All simulated GitHub responses are **SYNTHETIC**; no real installed Owner, native Git provider, own-PG role/ACL, Windows package, Guardian or LIVE GitHub attestation is proven by these tests. The exact candidate commit, GitHub Actions run IDs and head SHA must be independently read from the Draft PR after publication; do not self-fill a commit SHA inside its own commit.
