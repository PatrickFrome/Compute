# Native selector publication recovery

Qualified predecessor:014ca691f11d7e33e86f9795f9b510b141e180f0.
Windows source run40904534945 succeeded with431 component passes,1 baseline skip
and46/46 native PG17 cases,0 skips. RuntimeContracts40904534733 also succeeded
on PostgreSQL,Ubuntu andWindows. These are source qualification, not installed
client autonomy or an installer acceptance claim.

## Remaining crash window

Exclusive hard-link publication exposes completed bytes, but a process can exit
between link and unlink. The final file then has two links and correctly fails
the protected reader. Do not weaken the reader or delete unknown retained files.

## Windows repair

Use a fixed native File.Move(source,destination) operation in the same verified
private directory, without overwrite. It removes the staging name as part of
publication, so the final selector needs no later unlink to become a one-link
file. Existing selectors are preserved. The OS executable is fixed under the
verified SystemRoot; no shell, arbitrary script, inherited secrets or retries.
Paths are restricted to the exact selector and owned temporary filename shape.
Unknown/cancelled outcomes return no success. Current profile and protected final
bytes are still independently checked by the caller.

Native Windows regression performs the actual move and simulates losing its
reply. It verifies that the final one-link bytes survive, the staging name is
absent, and a later attempt cannot overwrite the existing selector. This case
is mandatory in the existing Windows qualification. A Linux generated adapter
is explicitly not a Windows physical proof. Legacy malformed/hard-linked files
are not deleted or silently migrated by this change.

Local evidence:3 unit checks pass and1 real-Windows check explicitly skips on
Linux; package/registration combined46pass1Windowsskip;26/26 realPG seed cases
pass with the generated Linux filesystem adapter. Windows execution is pending
for this new source. No installed files, services, credentials or permissions
were changed. Default installed bootstrap and REJECT-to-repair remain open.

## Read-only recovery of an already published selector

If the protected final selector already matches the current active SQL profile,
preparation now returns a read-only receipt. It performs no native observation,
no native move, no write-open and no SQL mutation. The receipt explicitly says
physical_scope_observed=false and physical_execution_proven=false: configuration
readback cannot be confused with new execution evidence. A revoked profile still
fails. Missing or unverified selectors do not enter this successful fast path.

The real-PG regression loses the publication reply after its file effect, then
recovers with SELECT-only SQL and write-open/native-operation traps.27/27 cases
pass locally. The same case is mandatory in Windows qualification. No replayed
goal, task, permit or model execution is created.
