# A2 Compute Browser B6 Repair — Verification and Repair Record (2026-08-29)

## Scope

Independent verification of the relayed development summary claiming
B4 / B5 / B6 completion on `work/a2-compute-browser-b4-parity`, followed by a
surgical repair of the defects found, plus restoration of CI coverage for the
branch. This record is the durable evidence document for the repair commit.

## 1. Verification of the relayed summary

Claims were tested byte-level against GitHub (commits, statuses, trees) and by
executing the exact suite at each claimed head locally (Node v24.19.0).

| Claim | Verdict | Evidence |
|---|---|---|
| B4 commit `ae3f8da`, 66/66 tests | **VERIFIED** | suite at exact head: 66 pass, 0 fail, exit 0 |
| B5 commits `ffeceda`, `9b54546`, `d8caa5d`, 90/90 tests | **VERIFIED (count imprecise)** | `ffeceda` 81/81; `d8caa5d` 92/92, exit 0 (claim said 90) |
| B6 commit `097a3b2`, 92/92 tests, production-ready | **FALSIFIED** | see defect inventory below |
| AppVeyor green at all five SHAs | **TRUE but non-evidentiary** | `appveyor.yml` runs only A1 zero-spend python tests; zero browser-compute tests execute on any branch |
| GitHub Actions CI on the branch | **ABSENT** | no workflow push-filter covers `work/a2-compute-browser-b4-parity*`; zero Actions runs in branch history |
| Authoritative checkpoint ledger entries for B4/B5/B6 | **ABSENT** | `compute_fabric_a2_browser_architecture_checkpoint_h205f22` contains 28 rows, all R-line; zero B-line rows |
| 10 new + 5 updated files | **13/15 exact** | `node-registry.test.mjs` lives in `tests/` not `src/`; `operator-compute-bridge` is `.js` not `.mjs` |

## 2. Defect inventory at 097a3b2 (all introduced by the B6 commit)

1. **`src/runtime.mjs:62` — SyntaxError.** `await this.stopNodeRegistry();` was
   pasted into the non-async `constructor`. ECMAScript class constructors are
   ordinary methods; `await` is reserved there (verified empirically: P1 probe).
   Consequence: the module fails to parse; `contexts.test.mjs` and
   `hardening.test.mjs` cannot load; `cli.mjs` (`serve`, `self-test`) cannot
   import the runtime — the daemon cannot boot. The identical lifecycle call
   already exists correctly inside `shutdown()`.
2. **`src/cli.mjs:1` — UTF-8 BOM prepended to the shebang.** `node --check`
   rejects the file (`Invalid or unexpected token`); direct shebang execution
   semantics are corrupted (P2a/P2b probes). Runtime execution still works
   (Node strips the BOM), which is exactly why the defect survived unnoticed.
3. **`tests/node-registry.test.mjs` — event-loop leak.** The
   `LocalNodeRegistry starts with local node` test starts a registry whose
   `setInterval` (default 30 s) is never cleared, so `node --test` never
   terminates: the full suite hangs indefinitely instead of reporting.
4. **BOMs in three more new files** (`src/node-registry.mjs`,
   `tests/node-registry.test.mjs`, `browser-shared/node-registry.mjs`) —
   harmless to Node's module loader but inconsistent with repo hygiene.
5. **Extension lease gate not wired (B5 integration gap).**
   `operator-lease-gate.mjs` defines `A2_OPERATOR_LEASE_GATE` (including
   `validateActionLease`), and `operator-actions.js` calls it from
   `assertLeaseValid()`, but no script ever loads the gate into the MV3
   service worker, so `globalThis.A2_OPERATOR_LEASE_GATE` is always
   `undefined` in production and the gate check silently no-ops. The relayed
   claim "lease verification before actuation" was therefore structurally
   hollow at this head.
6. **Self-test reads a stale binding field name (B4 refactor gap).**
   `cli.mjs` self-test reads `contextBindings.get(...)?.cdp_browser_context_id`,
   but the B4-era runtime stores `browser_context_id` (verified across
   runtime.mjs lines 120/238/302/376/423 and contexts.test.mjs mocks). The
   physical-isolation assertion therefore ALWAYS failed; the self-test has
   been red on this lineage since the merge `0d77d38` (empirically: green at
   r4 head `6d39e3b`, red at `0d77d38`/`ae3f8da`/`d8caa5d`/`097a3b2`).
7. **Self-test violates the canonical B2 closeContext contract.** It closes
   `context_alpha` while `target_alpha` is still live, expecting cascade
   retirement; the canonical runtime (b2-contexts lineage, CI-green)
   REJECTS with `context_has_live_targets` (fail-closed, no blind bulk
   dispose). The test must retire targets explicitly first.
8. **`serve --bridge-port` crashes at boot (B5 integration gap).** `token`
   was destructured inside the bridge-start `if` block and referenced again
   in the manifest-writing `if` block — a `ReferenceError` that kills the
   daemon before the ready line. The claimed "HTTP bridge + ready manifest"
   path had never been executed once.

The claimed "92/92 at B6" reproduces only at the B5 head `d8caa5d`; at
`097a3b2` the expected suite would have been 101 tests (92 + 9 new
node-registry tests), which cannot run for reasons 1-3.

## 3. Root cause

The B-line trunk branch has **no CI gate**: the repo's compute-browser
workflows are each pinned to their own historical branch names
(`work/a2-compute-browser-b0-b1*`, `b2-*`, `b3-native-pipe*`,
`r4-semantic-perception*`), and `work/a2-compute-browser-b4-parity*` matches
none. AppVeyor provides only A1 python-suite coverage. Every defect above
(except 4) is mechanically caught by the standard gate step
`find src tests -name '*.mjs' | xargs node --check` plus a suite run — the
coverage gap is the enabling condition for all of them.

## 4. Repair

1. `runtime.mjs`: constructor keeps synchronous state initialization only
   (`this.nodeRegistry = null;`); lifecycle stays in `init()`/`shutdown()`.
2. `cli.mjs`: BOM removed; clean shebang restored.
3. `src/node-registry.mjs`: health-probe timer is `unref()`d — a library
   probe timer must never pin the host process event loop (P3 probes: the
   timer still fires on a live loop but a drained loop exits). Daemon
   lifetime is owned by the serve loop / RPC server.
4. `tests/node-registry.test.mjs`: the leaking test now stops what it starts.
5. `operator-lease-gate.mjs` renamed to `operator-lease-gate.js` (it is a
   classic IIFE script, not an ES module; the `.mjs` extension was semantically
   wrong and unloadable via `importScripts` by convention), and
   `background-entry.js` now loads it BEFORE `operator-actions.js`, so
   `assertLeaseValid()` actually enforces leases whenever a message carries
   one. No current sender attaches action leases yet, so the wiring is
   strictly additive (fail-open only for lease-less messages, unchanged
   policy; making leases mandatory is deferred to the R8-convergence step
   where the supervisor side starts issuing them).
6. New `.github/workflows/a2-compute-browser-b4-parity.yml`: parse gate,
   full suite (step timeout 10 min so a future interval leak fails fast
   instead of hanging green), B4/B5/B6 static contract greps including the
   gate-before-actions wiring, real-Chromium self-test smoke, a new serve-boot
   smoke (bridge manifest, bearer-auth health probe, 401/403 negatives, clean
   SIGTERM shutdown), deterministic evidence tarball + provenance attestation.
7. `cli.mjs` self-test: binding field reads updated to `browser_context_id`
   (defect 6), and the alpha-context sequence now retires `target_alpha`
   explicitly before `closeContext` (defect 7), preserving the fail-closed
   B2 contract instead of weakening the runtime to cascade.
8. `cli.mjs` serve: the bridge token is hoisted (`bridgeToken`) so the
   manifest write can reference it (defect 8).

## 5. Verification matrix after repair

- `node --check` over all `src`/`tests` `.mjs`: PASS (both original defect
  classes now mechanically rejected).
- Full suite `node --test tests/*.test.mjs`: 101 pass, 0 fail, process exits
  on its own.
- Real-Chromium `self-test` (Chrome for Testing 151.0.7922.34): `ok:true`,
  `crash_aware_restart:true`, `context_epoch_rotated:true`.
- Serve boot smoke locally: ready envelope with `node_registry:true`, bridge
  manifest written, authenticated `runtime.health` through the bridge with
  `effect_class:"READ_ONLY"`, wrong token 401, unknown method 403, SIGTERM
  exits 0.
- Extension parse checks over the rewired `background-entry.js` and renamed
  `operator-lease-gate.js`: PASS.
- All 25 static contract greps from the new workflow: PASS.

## 6. Non-claims

- This repair does not change lease policy (lease-less actuation remains
  permitted by design until the supervisor issuance path lands).
- The node registry still covers only the local node; remote-node probes
  report `remote_probe_not_implemented` (B7 scope).
- AppVeyor remains A1-only; browser-compute evidence is carried by the new
  GitHub Actions gate.
