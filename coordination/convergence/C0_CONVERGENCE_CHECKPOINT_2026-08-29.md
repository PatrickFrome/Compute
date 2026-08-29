# Compute Unified V1 — C0 Convergence / Disposition Checkpoint

Status: `EVIDENCE_READY_PLANNER_CHECKPOINT`

Authority effect: **false**. This checkpoint does not merge `main`, close PRs, alter provider configuration, change secrets, seal canonical Compute Fabric milestones, or change production authority.

Machine-readable companion: `coordination/convergence/C0_DISPOSITION_2026-08-29.json`.

## 1. Read barrier / source snapshot

Observed after the concurrent convergence authority update at `2026-08-29T13:27:18Z`:

- `main` = `0d1c074c7f513f25000d967761c7bb13912dacaa`.
- `integration/compute-unified-v1` = `03684f0731e6d12dc477c09f217ea2bca3aa29db`.
- R16 branch current head = same `03684f0731e6d12dc477c09f217ea2bca3aa29db`; pinned semantic source remains R16 pre-convergence `5fcd79c4b37e862c8fb8466dae7a9e182501b559` plus convergence markers.
- Native Browser = `work/metaengine-browser-native-supervisor-v1@0a3d9300959b6220f24b3014b0359c9566b2f169`.
- Native supervisor provenance = `work/metaengine-browser-native-supervisor-server-v1@3eb7d4a7171cc5ba2f43513a9e98e36f8cbb2653`.
- Compute Browser current head = `work/a2-compute-browser-b4-parity@b3fe90cb77531222ba67797ab3b0d11282cb7eaa`; the convergence control point had pinned the earlier B6 checkpoint `3eccaee205c70d15eae004c6e2a42767fce0bacb`.
- Development Plane semantic baseline = `72f9454c17e509350591dd54812dafc5d5090975`.
- Current shell head = `work/metaengine-browser-shell-v1@06dd5cc023c01cd3463d11a7a6b8824eca1a686e`.
- DP2 physical branch = `work/metaengine-browser-dp2-vercel-physical-v1@b8bb767b93406b997890db2e6aa12a6ca8c4ea4b` and is a direct descendant of the pinned `72f9454c...` baseline.
- Extension durable-identity/UI source = `work/a2-browser-v072-durable-identity-ui@09a205a6d1deb00e71ae5401b8c6a36f4dace0b0`.

Supabase `xpeibufgzjknrhbhpffp` now has `METAENGINE_COMPUTE_UNIFIED_V1_CONVERGENCE_2026-08-29` as the current Browser architecture `AUTHORITATIVE` checkpoint at `integration/compute-unified-v1@03684f...`. This changed during this audit at `2026-08-29 13:23:10.960918+00` and was **not** written by this planner.

The canonical Compute Fabric plane remains separate:

- semantic head = `metaengine-h205f22-recovery-dev-20260821-cp072`;
- canonical roadmap source = `docs/CANONICAL_ROADMAP.md@f73ac4c7730381b13239744979f8fa4731951109`;
- `W1`, `F1`, `R1` = `READY`; `A1` remains blocked by W1;
- no fresh active claims/directives/evidence-ready claims;
- stale persisted W1 claim `#32` is expired/effective-non-live and `cleanup_required=true`.

Therefore Browser convergence authority must **not** be interpreted as canonical Compute Fabric milestone verification.

## 2. Hard source-of-truth drift found

### D1 — main is not the integration truth

Open PR mergeability against `main@0d1c074c...` is not a convergence verdict. C0-C5 work must compare against `integration/compute-unified-v1` and selected source snapshots.

### D2 — branch heads moved after `COMPUTE_UNIFIED_V1.md`

The control point pins B6 `3eccaee...` and DP `72f9454...`. Current B6/B7 source advanced by three commits to `b3fe90c...`, adding identity-envelope/effect-ledger/action-plane seam work. Current shell advanced by three commits to `06dd5cc...`.

### D3 — current shell is not a safe DP source

The three shell commits after `72f9454...` remove DP1/DP2 candidate capsule, evidence verifier, sandbox plan/backend modules and their tests, while adding a smaller Windows lifecycle/receipt harness. C4 therefore must **not** merge/current-copy `work/metaengine-browser-shell-v1` wholesale. Its safe sources are:

1. pinned DP baseline `72f9454...` for DP semantics;
2. `work/metaengine-browser-dp2-vercel-physical-v1@b8bb767...` for physical backend work;
3. only bounded Windows receipt/lifecycle deltas from `06dd5cc...` after review.

### D4 — read-plane hardening is not live

`public.coordination_read_barrier_h205f22` currently grants `EXECUTE` to `anon` and `authenticated`. The service-role-only boundary described by PR #51 is therefore not reflected in production ACL. C3 must port/test the contract, but applying grants/revokes is a separate production-authority action and is forbidden in this checkpoint.

### D5 — historical evidence is not verified authority

R1 has historical continuity `EVIDENCE_READY` records, but authoritative roadmap status remains `R1=READY` and current supervisor evidence-ready set is empty. No C0 disposition may promote R1.

## 3. Major branch-family disposition

| Family | Disposition | Integration target | Closure rule |
|---|---|---|---|
| Browser Operator R0→R16 | **BASELINE_CONTAINED** | C1-C5 base | older branches may become historical after evidence indexing; preserve R5-R16 invariants |
| Extension Final / v0.7.2 | **SELECTIVE_PORT_REQUIRED** | C1, C3 | port durable identity/UI + live-install requirements; never replace R16 semantics wholesale |
| Native METAENGINE Browser | **SELECTIVE_PORT_REQUIRED** | C1, C3 | bounded port of physical app, identity, signed transport, semantic actuation, fleet provisioner, Windows E2E |
| Compute Browser B0→B7 | **SELECTIVE_PORT_REQUIRED** | C2, C3 | port current `b3fe90c...`, including post-B6 effect ledger; separately reconcile #64/#65 |
| Development Plane | **PINNED_BASELINE_PLUS_SELECTIVE_PORT** | C4 | use `72f9454...` + `b8bb767...`; shell `06dd5cc...` only as reviewed lifecycle evidence |
| Same-Point / cognitive bus | **SELECTIVE_PORT_AND_DEFER** | C5, C6 | DB cognition/commit-reveal/macroblock is distinct from R11 browser swarm; integrate useful runtime semantics then close canonically in C6 |
| W1/F1/R1/A1/AOP1 | **DEFER_CANONICAL_CLOSURE** | C6 | no Browser convergence claim can verify these milestones |
| ops/archive/scratch/release | **HISTORICAL_OR_OPERATIONAL_EVIDENCE** | C6 or none | not integration candidates unless referenced by selected evidence |

## 4. All 23 open PR dispositions

| PR | Head | Disposition | Target / unique delta | Closure gate |
|---:|---|---|---|---|
| #8 | `a84a6cec` | DEFER / SELECTIVE | C6/F1: live federation trust + verifier/provider evidence | F1 reconciliation |
| #12 | `87925864` | SELECTIVE + DEFER | C5/C6: autonomous orchestration state/queue/workflow | C5 comparison + AOP1 C6 disposition |
| #37 | `9377f76d` | HISTORICAL + INVARIANT REVIEW | C3: old read-plane fingerprint/separation evidence | prove #51/unified contract subsumes unique invariant |
| #48 | `bfca1243` | CONTAINED_SUPERSEDED | exact ancestor of #49 by 88 commits | C0 evidence index |
| #49 | `85570df1` | SELECTIVE + DEFER | C5/C6: realtime cognitive bus/causal/lease/ingress DB contracts | C5 semantics port + C6 Same-Point disposition |
| #50 | `961ae65c` | DEFER / SELECTIVE | C6/W1: W1 regression acceleration/evidence | W1 canonical review |
| #51 | `927182c7` | **SELECTIVE_PORT_REQUIRED** | C3: service-role-only read-plane hardening | C3 tests; production ACL change separately authorized |
| #52 | `e4b2844e` | SELECTIVE + DEFER | C5/C6: dual-round commit/reveal + macroblock replay/execution | C5/C6 reconciliation |
| #53 | `e73a6524` | DEFER / SELECTIVE | C6/W1: provider-neutral lifecycle receipt path | W1 canonical review |
| #54 | `b0f1b66b` | **CONTAINED_SUPERSEDED** | exact head is merge-base; unified is 603 commits ahead | C0 evidence index |
| #57 | `bd846ed2` | CONTAINED_HISTORICAL | v0.6.0 evidence; exact ancestor of R0 by 129 commits | C0 evidence index |
| #58 | `c438ebfd` | CONTAINED_SUPERSEDED | R0 already in R16 lineage | C0 evidence index |
| #59 | `06bc0d66` | CONTAINED, LIVE GAP RETAINED | no code delta needed; deferred live acceptance remains C1 requirement | physical Windows/supervisor E2E covers gap |
| #60 | `0365731c` | CONTAINED_SUPERSEDED | exact ancestor of #61/R16 | C0 evidence index |
| #61 | `a5ad4ff2` | **CONTAINED_SUPERSEDED** | exact merge-base; unified is 294 commits ahead | C0 evidence index |
| #62 | `d927d4e9` | CONTAINED_IN_COMPUTE_SOURCE | C2: native-pipe/incarnation ancestry is selected Compute source | C2 source port + tests |
| #63 | `c50dd086` | **CONTAINED_IN_COMPUTE_SOURCE** | selected Compute source is 45 commits ahead with exact merge-base | C2 source port + tests |
| #64 | `11181e72` | **SELECTIVE_PORT_REQUIRED** | C2: unique session-scheduler/R4 side branch; B6/B7 source diverges and lacks `session-scheduler.mjs` | scheduler semantics/lease tests integrated |
| #65 | `1fc383b0` | **SELECTIVE_PORT_REQUIRED** | C2: runtime-package-manifest-derived contract-pin test repair | equivalent machine-derived test exists in unified line |
| #66 | `df145947` | DEFER / SELECTIVE | C6/F1: Vercel multi-model gateway + committee/challenge | reconcile #8/#67/#69 + live provider evidence |
| #67 | `9af19936` | DEFER / SELECTIVE | C6/F1: current sovereign upstream tariff/served-model provenance | provenance contract integrated before F1 acceptance |
| #68 | `11f10b38` | OPTIONAL SELECTIVE | C3/C5: Gemini observation-only advisory adapter | unified advisory protocol, no actuation |
| #69 | `367b7fbd` | DEFER / SELECTIVE | C6/F1: legacy sovereign provenance parity | legacy support decision; provenance invariant retained |

No PR is closed by this checkpoint.

## 5. Proven containment / divergence facts used

- `#54 b0f1b66b → unified`: unified is `ahead_by=603`, `behind_by=0`, exact #54 head is merge base.
- `#61 a5ad4ff2 → unified`: unified is `ahead_by=294`, `behind_by=0`, exact #61 head is merge base.
- `#60 0365731c → #61`: #61 line is `ahead_by=20`, `behind_by=0`.
- `#59 06bc0d66 → #60`: #60 line is `ahead_by=3`, `behind_by=0`.
- `#58 c438ebfd → #59`: #59 line is `ahead_by=10`, `behind_by=0`.
- `#57 bd846ed2 → #58`: R0 line is `ahead_by=129`, `behind_by=0`.
- `#48 bfca1243 → #49`: #49 is `ahead_by=88`, `behind_by=0`.
- `#63 c50dd086 → current Compute source b3fe90c`: selected source is `ahead_by=45`, `behind_by=0`.
- `#64 11181e72 ↔ current Compute source`: divergent from merge base `c50dd086`, with six #64-only commits; current Compute source has no `coordination/browser-compute/src/session-scheduler.mjs`.
- `#65 1fc383b0 ↔ current Compute source`: divergent from merge base `c50dd086`, with two #65-only commits.
- Native Browser vs unified is strongly divergent (`native ahead_by=88`, unified-side behind count `286`, merge base `c50dd086`), so wholesale branch merge is rejected in favor of bounded C1/C3 ports.
- B6 checkpoint `3eccaee... → b3fe90c...`: current Compute source is three commits ahead, including effect-ledger/action-seam work.
- DP baseline `72f9454... → shell 06dd5cc...`: shell is three commits ahead but removes the DP candidate/sandbox modules; this is a semantic fork, not a simple latest-is-best update.

## 6. C1-C6 dependency order

The execution DAG is not a naive serial `C1→C2→C3→C4→C5→C6`; safe parallelism exists:

```text
C0
├── C1a native identity/transport/physical shell
├── C2a Compute source + effect ledger + #64/#65 analysis
└── C4a pinned DP2 sandbox backend

C1a + C2a
      └── C2b B7 scheduler bound to exact native node incarnation

C1a + C2b
      └── C3 unified typed supervisor core/adapters + read-plane contract

C3 + C4a
      └── C4 physical sandbox through unified supervisor boundary

C1a + C2b + C3 + C4
      └── C5 autonomous fleet runtime
             └── C6 canonical closure wave
```

Rationale:

- C1 defines the physical node identity/transport that C2's final B7 scheduler must lease against.
- C2a can proceed in parallel by extracting Compute contracts and reconciling #64/#65.
- C3 cannot be sealed until extension/native/compute adapters have stable contract seams from C1/C2.
- C4a can proceed independently because candidate verification stays sandbox-only/non-promoting; its final transport binding waits for C3.
- C5 requires physical worker readiness (C1), pool scheduling (C2), unified protocol (C3), and sandbox candidate verification (C4).
- C6 is the only place where canonical W1/F1/R1/A1/AOP1/Same-Point/browser/compute closure and historical PR closure waves may be scheduled.

## 7. Work packages unlocked now

### WP-C1A-NATIVE-PORT-MATRIX — UNBLOCKED

Source pins: native `0a3d930...`, server provenance `3eb7d4a...`, v0.7.2 UI `09a205a...`, R16/unified `03684f...`.

Deliverable: file-level port matrix and first bounded package for device identity + signed supervisor transport + persistent native session shell. Gate: R5-R16 tests remain green and no physical authority escalation is introduced.

### WP-C2A-COMPUTE-B6-B7-DIFF — UNBLOCKED

Source pins: B6 checkpoint `3eccaee...`, current source `b3fe90c...`, #64 `11181e72...`, #65 `1fc383b0...`.

Deliverable: exact contract/diff matrix for node incarnation, leases, effect ledger, action kernel, receipts and scheduler; port/reimplement #64 scheduler semantics and #65 machine-derived contract test rather than merging side branches wholesale.

### WP-C4A-DP2-PINNED-SANDBOX — UNBLOCKED

Source pins: `72f9454...` + physical DP2 `b8bb767...`; shell `06dd5cc...` is evidence-only input until reviewed.

Deliverable: DP2 physical sandbox backend on unified line while candidate execution remains sandbox-only, non-promoting and non-actuating.

### WP-C0-CI-EVIDENCE-INDEX — UNBLOCKED

Deliverable: branch-local verifier that checks the 23-PR disposition set, pinned source SHAs, ancestor claims used for historical closure, and that no disposition itself authorizes merge/close/production mutation.

## 8. C0 exit condition

C0 planning is complete enough to start C1a/C2a/C4a in parallel. C0 is not a production/canonical seal. The next planner checkpoint should be created only after the three unlocked source-port matrices report exact selected files/tests and any newly discovered unique deltas.
