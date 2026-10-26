# Source integration audit — 2026-10-26

## Scope and boundaries

Functional baseline: `1ce1d4ed3ce250eae33e494d7cc76140d0aeda56` (PR #1347).
This is a source audit and repair, not an installed-client or release qualification.
The product target is continuous owner-controlled development by coordinated,
child-creating chat agents, with durable experience, independent criticism,
computer observation/control and restart continuation. Resource budgets and
owner stop must remain effective; no arbitrary lifetime agent-count ceiling is implied.

Inventory at baseline: 3,131 tracked files. The audit combined source-entry and
resource/IPC/SQL tracing, static analysis, targeted reproductions, negative tests,
UI production builds and full Browser/Runtime comparisons. It is not a claim
that every line was dynamically executed or that no undiscovered defect exists.

## Repairs

1. Final activation start/stop now drains the previous lifetime before accepting
   a new start. Development Plane readiness re-registers only the latest explicit
   owner; obsolete instances cannot reclaim its slot after replacement.
2. Authenticated late Host IPC responses use bounded, single-use exact request/op
   tombstones. Signature, nonce, unsolicited-response and replay rejection remain.
3. An additive guarded SQL migration separates an already-running CRITIC's
   authorization from admission of a new physical slot. Existing witness,
   lease/project/worktree/independent-result checks remain. Historical migrations
   are unchanged; the real-PG regression is registered in the existing disposable
   PostgreSQL 17 workflow.
4. UI package evidence now hashes a deterministic path/size/content inventory,
   rehashes installed bytes and rejects same-length mutation, missing/extra files,
   escaping links, cycles and altered inventory. The inventory is not a signature
   or execution authority. SBOM consumes the defined content-hash scheme.
5. History filter drafts remount with task identity, avoiding effect-driven stale
   resets. Recovery reads and mutation completions are fenced by observation
   lifetime; a callback after unmount cannot dispatch recovery.
6. Selected bounded onboarding diagnostics and PG fixture improvements from
   `439fcefa766f7ed70a7d7972b07bd86261099be5` are incorporated as reviewed patches.
   No older capture watcher, Add-Type runtime helper, version or source seal is imported.
7. Fifty-one unreferenced modules/components (6,095 baseline lines) were removed
   after AST, package-root, dynamic-loader, resource, test-reference and virtual
   typecheck review. Four outbound guards and the build-sensitive Tailwind config
   remain. Historical/quarantined sources and frozen extension aliases remain.
8. Unused private RSI helpers and other bindings were pruned without dropping
   validation, installation, stream-drain or startup effects. Python receipt
   validation remains executed after removal of its unused result binding.
9. UI dependency updates address known advisories using compatible direct updates;
   four unreferenced starter dependencies were removed. Remaining advisories are
   explicitly unresolved, not hidden by incompatible overrides.

## Recorded verification before final source seal

- Full baseline Browser: 5,902 pass, 28 fail, 64 skipped. Environment failures
  include prohibited local IPC and unavailable physical Electron prerequisites.
- Full baseline Runtime: 613 pass, one IPC environment failure, 19 skipped.
- Targeted activation/IPC/Development Plane: 40 pass; independent review passed.
- UI content/SBOM regressions: 23 pass, including byte tampering and path escape.
- UI library tests: 60 pass before the five additional recovery-lifetime cases;
  those five cases separately passed. Typecheck and standalone builds passed.
- SQL migration/source registration: nine pass. Supplementary PostgreSQL 18.6
  WASM with official pgcrypto: nine substantive subtests plus parent passed.
  This is NOT native PostgreSQL 17, OS process/durability or concurrency proof.
- RSI: 786 pass. Other cleanup: 226 pass/four platform skips plus explicit drain
  and token tests. Python: 79 isolated tests and 16 digest-equivalence cases pass.
- Python AST: 108 files pass. JavaScript syntax: 1,936 files passed at its recorded
  pre-pruning snapshot. YAML syntax/duplicate keys: 189 files pass.
- PostgreSQL 17 grammar: 193 ordinary SQL files pass; five psql scripts have
  parseable SQL after separating their client commands, which were not executed.
  The new guarded SQL body also passes PL/pgSQL parsing.

Exact final rerun results must be attached to the resulting source commit.
These overlapping test groups must not be summed into a unique-test claim.

## Remaining product blockers

### Automatic one-EXE installation

Packaging the components is not automatic provisioning. The first-run path
currently expects an existing attached provider descriptor. The fresh initdb
primitive has no production orchestrator and returns UNPROVISIONED. Current
registered SQL is an upgrade set: 36 of 52 API RPC definitions and all five REST
base-table CREATE definitions are absent from that registry, though historical
source definitions exist. A reviewed empty-cluster baseline, private first-owner
approval, real project/roadmap provenance and a fresh-provider receipt are missing.
A restore report must never be fabricated to substitute for fresh provisioning.

Native Guardian ticket redemption still uses a fixed hosted HTTPS issuer while
Browser can issue a local PostgreSQL ticket. A genuine authenticated local issuer
binding must be implemented; an arbitrary caller-supplied localhost URL would
not be a safe replacement. Existing installations/data must remain untouched.
No automatic installer wiring or fabricated READY state was added in this audit.

### Agent autonomy and learning

The real continuous cycle, child proposal, native peer messages and Windows
control paths exist. Episodic outcomes feed future prompts. Advanced verified
skill adoption/routing still lacks production dispatch consumption; browser and
native agent tool capabilities differ. No live model/agent execution, independent
Critic acceptance, useful-work checkpoint or installed restart cycle is claimed.

### Qualification and dependencies

Native PostgreSQL 17 migration/grants execution, physical Windows regressions,
new installer identity/provenance and clean-PC end-to-end tests remain required.
UI dependency audit improved from 92 distinct GHSA advisories (five critical) to
35 (zero critical, 25 high, nine moderate, one low). These are GHSA counts, not
unique CVE counts; remaining Prisma/build-tool chains require further review.
The Browser production dependency audit reported no advisories at its snapshot.

The earlier prepared version `0.7.0-dev.1225141128021.1` was never published or
reserved and is not suitable for upgrading from already-consumed sibling
`0.7.0-dev.1269944506140.1`. No new version is selected here. PR #1348's successful
isolated Owner/UI/Guardian package is historical evidence for source
`cf547d7e5f973517fa9bd1e206892e3a108ad1ea`, not qualification of these repairs.
No main merge, package rerun, production data change or user-PC installation occurred.
