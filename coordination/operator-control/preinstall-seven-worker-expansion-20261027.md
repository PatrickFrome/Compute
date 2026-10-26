# METAENGINE: seven-worker expansion, 2026-10-27

The user expanded the first wave by three worker chats. There are now seven
worker assignments plus the main integration coordinator. The live coordination
record is [#1354](https://github.com/PatrickFrome/Compute/issues/1354).

## Frozen development base

All seven workers start from
`9d7527683060e314eb1d39fec9ce2304a57103c4`.
Their PR target remains `work/preinstall-closure-20261027`.
The first four Markdown assignments and their owned scopes remain unchanged.
This documentation-only expansion is published separately so the running
qualification of the source anchor is not restarted merely to add assignments.
The documentation commit is not a replacement development/package anchor.

## Additional assignments

| Stream | Task | Branch | Initial status |
| --- | --- | --- | --- |
| 5 | [#1360](https://github.com/PatrickFrome/Compute/issues/1360): disposable recovery bundle with vault and restart | work/preinstall-recovery-20261027 | READY_TO_CLAIM |
| 6 | [#1361](https://github.com/PatrickFrome/Compute/issues/1361): producer-bound migration sidecar and strict consumer | work/preinstall-artifacts-20261027 | READY_TO_CLAIM |
| 7 | [#1362](https://github.com/PatrickFrome/Compute/issues/1362): Git-to-SQL checkpoint crash reconciliation without replay | work/preinstall-reconciliation-20261027 | READY_TO_CLAIM |

The three self-contained task files are in `preinstall-tasks/`.
Creating an issue or preparing its file does not mean that the worker chat is
running. Each chat must claim its own issue before editing.

## Ownership changes and dependencies

The original coordination protocol remains in force with these specific
additions:

- Stream 5 owns new disposable recovery-bundle fixture/tests/workflow and its
  report. It does not own migration, production backup gates or installed data.
- Stream 6 owns new sidecar helper/tests/schema and narrow capture/upload hooks
  in `.github/workflows/browser-windows-package-smoke.yml`. This is an explicit
  limited delegation from the coordinator. Version, reservation, signing,
  release, dispatch and all other producer policy stay with the coordinator.
  Any additive change to the shared
  `apps/metaengine-browser/scripts/qualified-installer-consumer.ps1` must first
  be described in a DEPENDENCY_REQUEST.
- Stream 7 owns native-coding-project-commits.mjs, native-coding-host-commit-service.mjs,
  their focused tests, and new checkpoint-reconciliation fixtures/report. It
  addresses Stream 3's concrete Git-to-SQL crash-gap request. Changes to shared
  private Host capability/IPC wiring require a precise dependency request;
  Stream 3 retains its original goal/autonomous-project source modules.

Stream 6 supplies the candidate-tree/uninstaller sidecar contract required by
Stream 2 (#1356). Stream 2 owns the actual manual migration composition.
Stream 5 verifies recovery mechanics separately; its fixture cannot qualify a
backup of the real installed Keeper. Stream 7 supplies a narrowly typed,
independently verified checkpoint-reconciliation contract to Stream 3, with
no repeated Git effect and no retry of an ambiguous SQL finalization.

The coordinator integrates source changes, refreshes source seals, selects and
reserves a fresh package version, runs one immutable installer producer, and
decides final acceptance. Workers do not merge, rebuild the consumed .178
package, or interpret old source/artifact success as current qualification.

## Handoffs

Use CLAIMED / IN_PROGRESS / BLOCKED / READY_FOR_REVIEW with BASE_SHA, HEAD_SHA,
branch, PR, files, exact test commands/results, artifacts and remaining
unknowns. Source-ready and physical/installed-qualified remain separate.
The issue is the shared record; separate chat memories do not synchronize.

Existing user Browser, Owner, PGDATA, Guardian and registry are not fixtures.
Use disposable Windows/native data only. Keep RequireFreshInstall, no-replay
fences and all authority boundaries intact. Report concrete failures without
fabricating successful receipts or exposing secrets.

## Prioritization update

The initially considered native-authority negative-audit assignment was not
claimed. Before launch, Stream 7 was redirected to the concrete Git-to-SQL
crash gap reported by Stream 3 in #1354. Issue #1362 and the current Markdown
file are authoritative. No native-authority worker was launched by the
coordinator, and no additional eighth worker is implied.
