# Reviewed source publication checkpoint — 2026-11-01

This is an evidence-only checkpoint above frozen source
`98d436c10553a716c42c3cc22e558c36db80f026`, tree
`edf713b9315a240db6ca37c79a18e60c2610e054`. No installer, version reservation,
release promotion or execution authority is conferred by these records.

## Exact observations, not inherited qualification

| Evidence | Exact source | Result | Boundary |
|---|---|---|---|
| Local Windows workflow component cases | `6839e58c419e5a4c182fe52c20d3658e99f4bfbf` | 1187 PASS, 1 permitted historical BASE skip; all 70 required cases pass | 61 files, not the full Browser suite or hosted CI |
| Local Windows workflow native PG17 cases | same `6839` | 389 PASS, 0 skips; all 103 required cases pass | 17 files, disposable databases, no installed profile |
| Workflow input regression guards | `98d436c10553a716c42c3cc22e558c36db80f026` | 60 PASS, 0 skips, repeated after commit | Linux Node 24.22.1; not a Windows rerun |
| Canonical empty schema export and independent restore | `6839e58c419e5a4c182fe52c20d3658e99f4bfbf` | Two independent PG17 clusters; exact catalogue/ACL equality and cleanup | Linux Node 24.22.1 / PostgreSQL 17.11; not installation |
| Current dump input comparison | `98d436c10553a716c42c3cc22e558c36db80f026` | All 76 schema and 4 exporter inputs match the original 6839 manifest | Read-only content equivalence; not a new native export |

The Windows run used Node 24.21.0, the exact workflow case lists, required-name
checks, original isolation, timeouts and output bounds. Its local metadata says
`user_pc_used:true`, `github_hosted:false`, `installed_user_profile_used:false`.
Source and physical input hashes were unchanged; original cleanup receipts and
read-only cleanup inventory were retained. Four nonfatal native timing warnings
remain recorded. No current required case was skipped.

The preceding 7af Windows component result remains RED (1175 passes, six
failures, one BASE skip). Actual Git for Windows failed on managed worktree
paths. Invocation-local `core.longpaths` alone also failed. The final reviewed
fix uses a verified same-target relative spelling and conservative admission
before reservation; the passing 6839 run retained the same profile depth,
without a shorter-root workaround, global settings or relaxed test policy.
This is bounded path support, not a universal filesystem guarantee. Other
Git/common-directory failures remain AMBIGUOUS and are not automatically replayed.

The 98 successor adds only two workflow-input corrections and their guards:
managed Git source bytes in the checkpoint receipt, and the authenticated API
identity file in canonical-export PR/push filters. The guards first reproduced
58 PASS / 2 FAIL, then 60/60 PASS. Removing each of the three individual entries
was independently rejected. No production execution, export-on-PR, branch,
skip, timeout or historical default policy changed.

## Artifact provenance and inventory

- `source-inventory-98.json` records every committed changed file since public
  `7599ccbfb2a8cd76b7db5d6207f32aa655895097`, with Git blobs and SHA-256. This is
  a delta inventory, not independent qualification of the entire repository.
- `windows-source-6839.json` records the completed local observations and
  evidence hashes. Earlier fc216 Windows records remain unchanged at their
  historical paths; neither old nor new results are relabeled to later HEADs.
- `workflow-guards-98.json` binds the narrow patch and red/green evidence.
- `canonical-empty-schema-manifest-6839.json` is the byte-exact manifest produced
  by the existing exporter; it was not rewritten. The corresponding separate
  archive is 974494 bytes, SHA-256
  `3a9797ca0a715f18cb0043df4746b6a8ebd22ade9ea025c4c5ffbd16f284ed95`.
  The binary archive is retained separately, not embedded in this Git report.
  A manifest without its independently verified archive is not a usable dump.
- `schema-input-comparison-98.json` records the actual trusted read-only input
  verifier result at 98. All 80 inputs and archive bytes remain exact. The old
  db599 archive/manifest were preserved, not amended; its schema binding was
  stale. New source/restore catalogue and ACL digests also match the old values,
  but that does not convert the old manifest into current proof.
- `evidence-index.json` hashes the report and evidence files, excluding only
  itself explicitly. The separate current-source seal will bind all these
  committed evidence bytes, including that index.

The export's two cluster identities differed. Both original shutdown/cleanup
paths completed before output publication; the exclusively owned temporary
root was empty afterward. No installed PostgreSQL data or service was used.

## Source seal and remaining gates

The next commit must be seal-only: the existing current-source manifest plus a
new detached producer receipt generated against this exact evidence commit.
Only `current_tree_blobs` may change in the old manifest. Package versions,
historical ledgers and all authority/qualification flags remain unchanged.
Final historical/current preflight and hosted CI must name the actual final
seal commit; this pre-seal evidence record does not predict their outcome.
Generating a seal is not passing qualification. Later functional edits require
a new reviewed generation rather than reuse of these results.

Default native publication/effect admission remains CLOSED. The runtime's
installed-schema diagnosis is read-only and reports no execution admission.
Loaded-code/Owner custody, historical physical settlement and capacity release,
cold materialization/long-job handoff, and effective home/temp/policy bindings
still require their genuine proof chain. Valid SQL terminal state, result bytes
or a PID cannot substitute for joined physical settlement.

Existing-root signing, immutable verified artifact handoff, external signed
sidecar placement, current package/dependency/helper provenance and installer
acceptance remain separate gates. No new trust root, fixture signature or
self-declared readiness is accepted. A real project through execution, critic,
repair, checkpoint and next task, plus explicit pause-versus-stop behavior,
restart/unknown outcome recovery and controlled update/rollback must be
qualified before claiming an operational installed client.

No publication, installation, signing, credential, production database or
OS-security action was performed to create this evidence commit.
