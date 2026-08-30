# METAENGINE Browser Autonomous Dev Release Controller V2

Status: ACTIVE DEVELOPMENT GATE

## Goal

Keep an installed METAENGINE Browser converging to the newest physically verified development build without manual installer handling.

## Release loop

1. Source commit is tested by `METAENGINE Browser Shell V1`.
2. The exact same source commit is tested by `METAENGINE Browser Self Update E2E` on Windows with a physical N→N+1 install, durable successor receipt, profile continuity and singleton proof.
3. `browser-dev-release-target-v2.json` may point only to a source SHA whose exact workflow definitions match the immutable trusted workflow blobs embedded in `metaengine-browser-dev-autopublish-v2.yml` and whose exact-SHA workflow runs both completed successfully.
4. Publisher downloads the exact E2E artifact. It does not rebuild the browser.
5. Publisher verifies manifest/source binding, installer SHA-256, installer SHA-512 binding in `dev.yml`, strict UTF-8, no UTF-8 BOM, exact asset set, monotonic dev version and all physical proof flags.
6. Publisher creates or readback-verifies an immutable dev prerelease.
7. Installed Browser resolves only a newer same-family dev release, verifies GitHub asset digests over raw bytes before strict UTF-8 parsing, then delegates the installer download to `electron-updater` with the verified SHA-512 binding.
8. Browser installs only after CONTROL+ARMED, no current supervisor command and a quiescent lifecycle remain safe for the restart grace period.
9. Before installer handoff it persists the pre-install receipt and releases the singleton lock. The successor must persist a durable successor receipt proving the same installation/profile continuity.
10. Browser resumes polling after restart and converges to the next verified dev release.

## Hard invariants

- No arbitrary eval.
- Page/model output has zero authority over release selection or installation.
- No blind retry after an ambiguous release or installer effect; persisted readback decides.
- No downgrade.
- No release rebuild after physical E2E.
- Exact source SHA and exact workflow blob binding.
- Production authority remains false for this dev release plane.
- Existing releases are never mutated to repair compatibility; publish a higher monotonic version instead.
- Legacy BOM compatibility is transitional only. Canonical dev metadata is UTF-8 without BOM.

## Next hardening

- Persist highest-seen trusted metadata/version across restarts to make rollback/freeze detection explicit.
- Add signed/attested release provenance and verify it in the publisher/client policy.
- Add post-update health activation/rollback-to-known-good policy without permitting silent downgrade.
- Move source promotion from supervisor-written target files to a least-privilege trusted release-controller workflow once its privilege boundary is independently verified.

`authority_effect=false`
