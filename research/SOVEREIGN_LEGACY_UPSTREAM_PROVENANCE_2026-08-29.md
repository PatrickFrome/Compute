# Sovereign Legacy Runner — Upstream Provenance Repair (2026-08-29)

Status: PREPARE_ONLY / CROSS-CUTTING. `canonical=false`, `authority_effect=false`.
Authored by GLM (peer review #243 finding OBS-SOV-LEGACY-3), stacked on the v4
provenance fix head `9af19936336df816e21e9142b61e17e76be79642` (PR #67) and reusing
its `upstream_provenance.ts` helpers verbatim — no new dependency, no helper change.

## Problem

PR #67 taught the v4 runner (`same_point_v4.ts`) to preserve upstream tariff and
served-model provenance, but the legacy runner (`src/index.ts`, `npm run
start:legacy`) reads the **same** `SOVEREIGN_GPT_URL` / `SOVEREIGN_GLM_URL`
environment variables and still hard-coded `tariff_dependency: false` in ten-plus
places: the `modelCall` executor receipt, both per-tick `_lockstep` blocks, all
five terminal `complete()` envelopes (BLOCKED_EXECUTOR, RESOLVED, CANARY_REQUIRED
twice, FAILED), and the LISTENING / STARTING lifecycle telemetry. Its error path
(`visibleError`) carried no provenance at all, so an executor failure against an
external endpoint became a provenance-free synthetic step.

Concretely: running the legacy runner with `SOVEREIGN_GPT_URL` pointed at an
external OpenAI-compatible gateway (for example the prepared F1 gateway contour)
would have written `tariff_dependency: false` — falsely local, tariff-independent
evidence — into the same ledger that PR #67 just made honest for v4. The exposure
requires the explicit `start:legacy` entrypoint (`scripts/start-all.sh` launches
v4), which downgrades but does not eliminate it: the env contract is identical,
so one operator flag away from silent provenance falsification.

## Repair

Mirrors the v4 rule exactly, reusing the same helpers:

- Default built-in localhost endpoints remain tariff-independent.
- A configured custom endpoint is tariff-dependent by default; a proved-local
  custom endpoint must explicitly set its per-actor override to `false`.
- Invalid override values fail startup (`*_invalid_boolean`) — fail-LOUD.
- `mergeUpstreamProvenance` gives executor receipts the full field set:
  logical/served model, served-model source, zero-spend result, data policy,
  confidentiality, endpoint hash; dependency is sticky raise-only
  (`configuredDependency || upstreamDependency`).
- Executor errors now attach a provenance-bearing `_executor` block (configured
  endpoint/model/tariff, `served_model_source: "unavailable"`,
  `executor_error: true`) instead of a provenance-free synthetic failure.
- Per-tick `_lockstep` blocks derive each actor's dependency from its payload
  executor block (`payloadTariffDependency`), exactly like v4.
- A sticky accumulator `observedTariffDependency` (seeded from
  `RUNNER_TARIFF_DEPENDENCY`) feeds all five terminal envelopes, so a duel that
  ever observed a dependent wave can never finalize with an independence claim.
- LISTENING / STARTING telemetry reports `tariff_dependency_basis:
  "CONFIGURATION_MINIMUM"` plus per-actor breakdown instead of a hard-coded false.
- Error prefixes renamed `local_*` → `endpoint_*` to match the v4 convention so
  log consumers cannot misread a remote failure as a local one.

## Verification

- `npm run check` (tsc --noEmit): clean.
- `npm run test:provenance`: 5/5 PASS (unchanged helper suite).
- `tests/test_sovereign_inference_contract.py`: PASS (all pre-existing legacy
  contract invariants preserved — no vendor endpoints, localhost defaults,
  event-driven wake, atomic pair submission).
- New `tests/test_sovereign_legacy_upstream_provenance.py`: PASS (wiring guards
  for every repaired site, including the no-`tariff_dependency: false` invariant
  and the sticky accumulator across all five terminal envelopes).
- GLM independent adversarial battery (review round #243): 7/7 PASS on
  `upstream_provenance.ts`, including the cross-PR seam test where the F1
  gateway's `metaengine` envelope raises dependency even under a misattested
  proved-local override.
- No model inference, no Supabase DDL/DML, no deployment, no PR merge.

## Integration rule

Same as PR #67: an external endpoint may never be represented as local evidence.
When the legacy runner is retired, delete it rather than re-hard-coding fields.
