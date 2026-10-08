# Restored PostgreSQL client handoff — 2026-10-08

## Source of truth

Repository: https://github.com/PatrickFrome/Compute

Continue the branch `work/client-restored-pg17-runtime-repair-v1`. It starts from
PR #1157, commit `1856f4283f8423cf4ae441a4bdf5e3452a066d3c`, rather than main.
The preceding parallel stack is 22 commits ahead of PR #1144 (`edff16cfc`).
All of these development PRs were draft/unmerged when audited. Do not replace
this branch with the historical main branch, reuse a predecessor installer as
evidence, or overwrite the original Windows checkout's unrelated local work.

Candidate package identity: `0.7.0-dev.37781000001.1`. Resolve its exact commit,
build status, immutable artifact and final qualification from this branch's PR
and GitHub Actions. A reserved/failed identity is consumed; never rerun a
physical producer with the same version. Any changed candidate needs a new
version in package.json, both package-lock roots and CONVERGENCE_CANDIDATE.md.

## Accepted product direction

The owner explicitly selected the previous PostgreSQL installation and database
dump. Use the already restored PostgreSQL 17 database and preserve its existing
Vault key. Empty-database first-run work remains experimental; normal startup
must not call initdb, generate a replacement key, restore over existing PGDATA,
or silently fall back to hosted Supabase. P0 #1155's from-zero schema/UI pipeline
is still separate work, not a requirement to replace this selected restored DB.

The original local database had a stale PID file and an unclean prior exit.
An isolated full copy was prepared without changing the original, preserving
the existing key. Before recovery, all 1,476 remaining files (87,064,774 bytes;
only the known stale PID was excluded) were byte-compared with the original.
Aggregate snapshot SHA256:
`486f6368118c032ce4791b465bf1faba0a9bc3d7ce5cbc77335fe58707783c33`.
Recovery and role admission on this copy used PostgreSQL 17.6. Restricted API
login/service_role membership, 40 RPC grants, five table grants and permitted
INSERT columns passed. Subsequent current-source/full-host checks must be
reported separately in the PR; this snapshot receipt does not prove autonomy.

Historical full restore receipt SHA256:
`e8ffd354a502a6d4006dd0f44b6a64af9066313970e5786d4c4020b343045ac8`.
Historical dump SHA256:
`e439efce9f32a1058eb9362d83976b0344aaf326523dc1b5d057562d8bf106a8`.
The prior restore verified 80 tables and 144 functions, with zero reported
errors. Its declared adaptations are local pgcrypto Vault, local event-trigger
ownership and Windows/ICU collation normalization. It is not an exact unmodified
Supabase platform restore. Its report alone does not bind arbitrary current
PGDATA or prove current all-row equality.

## Implemented successor changes

- Startup source pinning now includes the packaged first-run module closure.
  An independent current-source test starts fixture children and rejects a
  changed first-run file before spawning children.
- Windows owned PostgreSQL starts through restricted-token pg_ctl and owns the
  actual postmaster, not the helper PID. Identity binds executable, canonical
  PGDATA, loopback/port argv, PID, process creation and postmaster start time.
  Stop is single-flight, checks that identity before pg_ctl and independently
  requires process disappearance, PID-file removal and closed port. Ambiguous
  cleanup retains the ownership hold; there is no generic PID kill.
- Launcher cancellation/shutdown settles PostgreSQL preparation before deciding
  cleanup, and runtime status/SQL/health monitoring use the actual postmaster.
- Catalog JSON parameters use text-to-JSONB casting so postgres.js does not
  encode an already serialized table-name list as a JSON scalar. A real PG
  integration exposed this successor defect missed by the mocked catalog test.
- Reviewed source operator tool `restored-client-provider-cli.mjs` selects an
  existing private runtime-host v1 configuration. It verifies explicit action,
  independent bundle/restore-report pins, existing PG17/key, restricted roles,
  current host UUID/health and confirmed shutdown, then exclusively publishes
  a credential-free owner descriptor. It never overwrites an existing owner.
  This operator tool is run from the checkout; it is not an installed wizard.

## Continue without access to the original PC

Clone the repository and checkout this branch, then install frozen dependencies:

```sh
cd infra/client-state-runtime
npm ci --ignore-scripts --no-audit --no-fund
npm test
cd ../../apps/metaengine-browser
npm ci --no-audit --no-fund
npm run check
npm test
```

Frozen package toolchain: Node 24.21.0/npm 11.19.0, Bun 1.3.3, Electron 44.0.0,
electron-builder 26.15.7. Runtime resources: PostgreSQL 17.11, Deno 2.9.7 and
postgres.js 3.4.7. The previous restored-cluster recovery uses 17.6 first;
same-major bundle startup requires its own measured compatibility test.

`browser-windows-package-smoke.yml` produces one unsigned NSIS candidate with
native payload, offline resources, ASAR integrity, dependency evidence, SBOM
and source/version reservation. Source-cleanliness gates remain enabled.
This local-only branch holds historical hosted enrollment/upgrade/soak jobs
and unconfigured normal UI boot: the public runner lacks the owner's private
restored database. Package/resource success is not normal client readiness.
The producer retains `normal_ui_boot_verified=false` until separate proof.
Synthetic fresh PG durability remains enabled as a launcher regression and
does not replace the selected private full restore.

For an explicitly selected local private state, the source operator command is:

```sh
node infra/client-state-runtime/restored-client-provider-cli.mjs \
  --config <absolute-private-runtime-host-v1-json> \
  --bundle-sha256 <reviewed-offline-bundle-sha256> \
  --restore-receipt <absolute-private-full-restore-report> \
  --restore-receipt-sha256 <independent-report-sha256> \
  --appdata <absolute-explicit-profile-root> \
  --owner-action USE_EXISTING_RESTORED_POSTGRES_17
```

Do not copy a private URL/password into CLI arguments. Keep dump, PGDATA, Vault
key, private runtime-host JSON, tokens and Chromium/device profile outside Git
and public artifacts. GitHub contains enough to continue source development
and build without this PC. It intentionally does not contain the owner's live
database; tests requiring that state need a separately authorized private
fixture. Skipped integration tests and source hashes never establish runtime
or useful goal→agent→Browser effect→durable receipt readiness.

## Validation and remaining qualification

Before successor changes, current runtime contracts passed 131/131. Focused new
operator/CLI/Windows-helper contracts passed 21/21 and were independently
reviewed. Current-source pin/launcher/package tests passed 56/56 before the
Windows integration. Final full runtime, full Browser source and physical
producer results belong to this exact candidate's PR/Actions records.

The initial full Browser run overlapped workflow edits: six obsolete predicate
assertions failed and have been updated/retested (14/14 workflow tests pass).
A physical Windows capture fixture timed out under unconstrained parallel load;
the final full local suite uses bounded concurrency. Do not call the earlier
run green or silently skip its capture test.

Remaining distinct qualifications: restored full-cluster bundled host cold
restart, installed normal UI/provider boot, update-safe private config digest
reconciliation, and independently proven useful goal/agent/effect continuity.
Fresh SQL baseline P0 #1155 and signing/public release are separate. A built
unsigned development installer grants none of those claims by itself.

## Remote computer support successor (2026-10-08)

New stacked candidate `0.7.0-dev.37781000002.1` adds `apps/metaengine-browser/src/remote-support-mcp.mjs` (explicit standalone MCP stdio host) and the existing `windows-local-computer-executor.mjs` closure to the immutable client-state runtime source bundle. There is no automatic background listener, service or web server. The operator starts a separate **trusted, private tunnel/MCP host** and verifies its identity; the bridge between ChatGPT and Windows is NOT supplied or considered connected merely by packaging this source.

To reduce interruption, the operator makes **one visible local VIEW or CONTROL decision per session**. The maximum is 60 minutes, with no per-action approval prompts. CONTROL also enables view; view-only cannot upgrade. A caller may not extend the session; `support_stop`, expiry, or closing the local terminal ends effects. Every mutating request still needs an existing independently qualified DB computer-effect lease, exact agent/target binding, typed action and readback. No free-form PowerShell, silent installation, startup persistence, private key/database read or cloud fallback. If the main Browser UI fails to load, this separate helper can still run because the reviewed Node binary and module are in the installed offline package.

**Important operational limit:** the public GitHub connector attached to a chat cannot see a user's Windows desktop. Only after a secure remote MCP connector/tunnel is deliberately configured and connected to this conversation, and the owner has explicitly enabled a local session, can this chat request screen or computer actions. New candidate CI source tests are necessary but do not prove end-to-end ChatGPT connectivity or restored PGDATA readiness.

Remote-support `.02` Windows/Ubuntu State Runtime Contracts failed one stale source-bundle negative test assertion. The reviewer correctly rejects a host-only manifest with `bundle_unexpected_source_record`; `.03` updates this test's error expectation without changing production admission checks. `.02` is consumed and not eligible for relabel/rebuild.
