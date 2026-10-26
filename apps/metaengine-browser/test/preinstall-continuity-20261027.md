# Stream 3: useful work and continuation acceptance

Task: [#1357](https://github.com/PatrickFrome/Compute/issues/1357). Coordination:
[#1354](https://github.com/PatrickFrome/Compute/issues/1354).
The implementation starts from the immutable anchor
`9d7527683060e314eb1d39fec9ce2304a57103c4` on
`work/preinstall-continuity-20261027`, targeting
`work/preinstall-closure-20261027`.

## Qualification boundary

This change qualifies source behavior and a controlled, disposable component
scenario. It does **not** qualify an installed Browser, approved native workers,
an own-PostgreSQL successor, Windows process/ACL custody, or production autonomy.
The acceptance summary deliberately reports overall `HOLD`, with installed
qualification `BLOCKED`, even when every source check passes.

The worker is deterministic fixture code. The Critic is an independent Node
process with filesystem read permission and an observed denial of a write
attempt. Its checks execute against the actual repaired file. That is a useful
component proof, not an approved native Critic or evaluator capsule. Generated
admission/checkpoint inputs and the separate controlled successor queue are
labelled as fixtures throughout the ledger. They grant no evaluator credit.

## Reproduce with one entrypoint

Prerequisites are Node 24 with `node:sqlite` and the Node permission model, Git,
and an existing writable parent directory for a **new** absolute output path.
Use a disposable development/CI environment that supports child processes.
The entrypoint creates only its new output directory and does not install or
start Browser, Owner, PostgreSQL, or Guardian.

From the repository root:

```bash
node apps/metaengine-browser/scripts/accept-project-continuation.mjs \
  --output /absolute/existing-parent/new-continuation-run
```

For a gate that requires installed qualification as well:

```bash
node apps/metaengine-browser/scripts/accept-project-continuation.mjs \
  --output /absolute/existing-parent/another-new-continuation-run \
  --require-installed
```

Use the corresponding absolute Windows path when running on disposable Windows.
An output directory is never reused. Each invocation retains its own useful
workspace, effect journals, process observations, and evidence for inspection.

| Exit | Meaning |
| --- | --- |
| `0` | Source/fixture checks passed; installed qualification is still `BLOCKED` |
| `1` | A source, contract, or evidence check failed |
| `2` | Source checks passed but `--require-installed` could not qualify installation |
| `64` | Invalid command arguments |

The result files are `summary.json`, `summary.sha256`, `ledger.jsonl`, and
`contracts.tap`. Ledger entries carry their previous entry's digest; each append
is synchronized before proceeding. The final summary records the complete
ledger digest and its terminal entry digest. The ledger file is made read-only
on completion. These hashes detect changes to the retained evidence; they are
not external signatures or a new trust authority.

Source identity records the Git HEAD, tracked worktree diff digest, relevant
file digests, Node version, and platform. The entrypoint rechecks the source
identity after execution so a concurrent source edit cannot qualify the earlier
bytes. A dirty source run remains explicitly labelled as such. Exact final
commit results, commands, and digests are posted in #1357 and the draft PR.

## Useful scenario and negative controls

The disposable repository contains `invoiceTotal(lines)`. Its original defect
adds unit prices without multiplying by quantities. A separate Critic first
observes that defect. The worker then repairs the actual file, and the Critic
checks empty input, multiple quantities, zero quantity, and zero price. For
example, two items at 199 cents plus three at 100 cents must total 698 cents.

The production client goal router, client goal journal, autonomous project
runtime, SQLite effect journal, Git proof reader, and Git committer are used for
their actual operations. Controlled transports supply the admission/queue
inputs; they never impersonate installed native authority.

| Check | Required observation |
| --- | --- |
| Original defect | The independent read-only Critic rejects the original bytes |
| Goal restart | A new process reads the saved goal; one `SEED_GOAL`, no reseed |
| Useful result | One persisted file effect; independent accepted bytes and result digest; Critic write denied |
| Conversation checkpoint | A new process returns `ALREADY_DELIVERED`; one send effect and the same checkpoint |
| Host Git commit component | Production Git CAS updates the disposable branch once; restart reads the same receipt |
| Git complete, SQL missing | The production observer retains `HOLD`; no SQL finalization or native successor is claimed |
| Controlled queue continuation | The saved child admission is reused; changed request content is refused; the admitted fixture task reviews the same committed artifact |
| Crash before file effect | Abrupt process exit after durable intent; restart retains `HOLD` and zero file effects |
| Crash after file effect | Abrupt exit after persisted file write and before receipt; restart retains `HOLD` and one file effect |
| Rejection before dispatch | Validated rejection remains terminal after process restart; zero workers and no recovery submission |

The native checkpoint verifier/Host service, commit observer, and skill-dispatch
contract suites are additional source checks. The entrypoint also runs the
modified Host/runtime tests and client goal/continuation tests. Required tests
must execute: nonzero failures, skips, TODOs, missing TAP counts, or a failed
child process cannot become a source PASS.

## Repaired source gaps

### Bind the workspace effect to the exact request

The Host previously accepted a `PROVEN` workspace effect without checking the
receipt schema, effect key, workspace generation, or coordination workspace.
It also detected a changed base only after invoking the managed Host. The new
checks reject foreign coordination/base bindings before dispatch and require
the complete matching receipt after dispatch. Focused tests first reproduced
the rejected identities against the anchor behavior.

### Acquire physical send custody atomically

`continueConversation()` previously ignored `journal.begin(...).created`.
Separate runtimes could both dispatch a send, including for different request
bytes. A new request after restart could also jump past an unresolved turn.

The runtime now pins the predecessor **before** observing the transcript. The
SQLite `BEGIN IMMEDIATE` transaction checks both that exact predecessor and the
absence of any unresolved turn for the same task/lease before inserting a new
intent. Only the caller receiving `created: true` may send. An in-flight
transcript observation cannot silently adopt a predecessor completed by a
different runtime. A foreign project/task/agent/lease predecessor is refused
before observation or history inheritance.

The table schema and existing immutable records are unchanged. A pending turn
hidden by a newer confirmed turn from the earlier implementation still holds
the task. No uncertain effect is erased, rewritten as successful, or replayed.

## Outstanding native Git-to-SQL boundary

There is a deliberate distinction between a proven Git commit and a durable
SQL finalization. With Git `COMMITTED` but no SQL intent/receipt, the current
commit observer returns `READBACK_REQUIRED` after restart. It only authorizes
the first `FINISH_CHECKPOINT` for `NOT_ATTEMPTED`. An explicit Host operation can
read the exact previous Git result, but an autonomous typed reconciliation path
for this interval has not been qualified.

The current `HOLD` is preserved. This source change does not modify the native
commit observer, Host service, SQL runtime, or capability allowlists. The scoped
request and acceptance criteria are recorded in
[the coordinator dependency request](https://github.com/PatrickFrome/Compute/issues/1354#issuecomment-6428977762).
A future reconciliation contract must independently prove the original Git
ref/object/index and authoritative SQL absence before the first finalization.
Unknown SQL intent, changed Git bytes, and conflicting successor stay fenced.

## Installed prerequisites and coordinator handoff

[The installed-input dependency request](https://github.com/PatrickFrome/Compute/issues/1354#issuecomment-6428952490)
requires the coordinator's single-producer installer bound to exact source,
fresh version, run/attempt, artifact ID, and SHA-256, with its image inventory.
It also requires disposable Windows, isolated runtime identities and state,
authenticated providers, and genuinely approved distinct IMPLEMENTER/CRITIC
permits/capsules where required. Private credentials and profile payloads must
not be copied into issue comments or CI artifacts.

The final installed consumer must bind all observations to that one artifact,
execute actual useful work, obtain the independent native Critic/checkpoint,
admit one genuine successor, and survive physical restart without replay.
Until that happens, source PASS and safe negative-control HOLD do not close
installed acceptance.

The coordinator owns integration, current source resealing, package identity,
and producer/release workflows. Changed source blobs require that later reseal;
the worker does not update frozen manifests or disable closure tests. The
consumed `0.7.0-dev.1784381341133.1` is not rebuilt. Only the coordinator accepts
and closes #1357 after the remaining proof exists.
