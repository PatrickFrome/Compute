# METAENGINE — first-run diagnostics on verified historical c265+e30

**SOURCE-ONLY PATCH VERIFIED ON EXACT ISOLATED SOURCE. Draft PR #1448; no merge, no Windows qualification.**
Date: 2026-11-05. Repo: PatrickFrome/Compute.

## Historical baseline verification (not latest version)

- GitHub c265 archive: `accb28e72c87c059e780efb8e6681886b33e9b4f` (`coordination/source-transfer/c26565e`), followed by `integrated-c265-to-e30.patch` from `d53ccd4135f28206d91d6804cf0626095565e6af`.
- Source ZIP from user-authorized Space: `METAENGINE-e30-github-only-source.zip`, SHA256 **PASS**: `169f4dc6379605d68d34360c9d28d687b4da3dc856aea6fc1fb27e6bc6d3ba06`.
- Safe extraction: **4346 files, 74 executable modes (100755) preserved**, no extracted path traversal.
- Independently recomputed Git tree **PASS**: `90fa5633d7926dd71a7303266073e0625325e740`.
- Source-only candidate unified patch SHA256 **`b28528a1dc057f1bcf8ec9c83ad467eb54128c10e452a6303675963dffc63a7d`**; 11 paths, +650/-69. Patched Git tree independently verified in a second disposable checkout: `9d5f18ff5d65a76fc7846a8bfd69aef66d061d4c`.
- The previously published candidate (SHA256 `c07deeaac950fdb11989fb68367dbc6607087a1ed27db2b3e086841a67dda978`) did apply and its 32 inert tests passed, but only addressed an auxiliary browser DOM B-panel. The verified consolidated patch additionally fixes the **actually mounted React UI**. The prior review's "not independently verified" finding is superseded.

## Reproducible first-run UI defects

Production renderer composition: `apps/me2-ui/src/components/me2/pages/system.tsx` -> `NativeInitialSetup` -> `apps/me2-ui/src/lib/native-initial-setup-resource.mjs` -> installed preload `window.metaengineClient.nativeInitialSetup` typed IPC -> Main. Defects reproduced with **9 initially failing red tests**:

1. UI rejected genuine `PRODUCER_UNAVAILABLE` from Codex account facts as malformed, losing an actionable missing-producer diagnosis.
2. `goalSubmissionMode.kind=NATIVE_CODING` with `state=HOLD` falsely appeared ready.
3. `local_runtime_ready=true` without attested own `LOCAL_POSTGRES` falsely unblocked setup.
4. Stale positive status persisted after failed refresh or unmount/navigation.
5. Confirmation/BEGIN could be repeated after an ACK, lost reply or pending cancellation without a fresh authoritative readback.
6. Renderer let the user type an `account_id` that is not an account observation from Main.
7. Unknown readback codes were not always fail-closed, and the auxiliary B DOM panel echoed complete readback JSON.

The patch adds strict code/readback allowlists; local ownPG, Guardian, HOLD and setup gate; independent readback-before-retry; single CANCEL sender; explicit user-facing missing-producer vs signed-out advice; no raw stderr, paths, credentials, private evidence or synthetic authority. `COMPLETED` never implies `READY`. Backend/authority checks are not relaxed.

## Tests and honest limits

- Before patch: new regressions **9 FAIL / 0 PASS**. After patch, source-only available suite **249 PASS / 0 FAIL** across 13 specified Node suite files (see independent local evidence).
- Separate complete-patch replay in isolated baseline: `git apply --check` **PASS**, `git apply` **PASS**, patched tree exact match `9d5f18ff...`, **89 PASS / 0 FAIL**.
- TSX structural transpilation via TypeScript 5.8.3: **PASS**, 0 syntax diagnostics. This is not a typecheck.
- `npm run build --prefix apps/me2-ui`: **FAIL, exit 127**, because Next.js is absent from the source-only executor (`next: not found`). No dependency installation performed.
- `apps/me2-ui/src/lib/interrupted-setup-recovery.ui.test.mjs`: **BLOCKED**, missing `react` and `react-dom`; explicitly excluded from the 249 PASS count.
- Real browser/screenshots, installed Windows application, Guardian service, PostgreSQL, ACL, models/API billing: **NOT RUN**.

## How to apply and qualify

The full consolidated **verified patch** is in `first-run-ui-c265-e30-verified.patch.xz.b64` as base64(xz(unified diff)); see `HOW_TO_INSPECT.txt` for safe offline decoding. Verify patch SHA and baseline tree before `git apply --check`. The branch is a GitHub review-and-patch artefact only: it does not contain modified installed application source, because the c265/e30 tree is an orphan snapshot not present as regular files on the target branch. Do not merge this PR or install from it without fresh Next build, browser qualification, and an independently authorized Windows test.

**No native service, actual DB, installed client, secrets, credentials, model/API calls, publishing a website, release signing, or merge performed.**
