# Installed 4590 qualification findings

The unsigned local QA package `0.7.0-dev.1107139874590.1`, source
`9a19ae7153f1213f3f43682a24aa0ba3bb105586`, was physically installed.
Installer SHA-256:
`38eb099d5d61a6ce4cf15390685dbfab40d1c97f7504f4c7e85f4a539abdca71`.
NSIS returned zero. Installed EXE, ASAR and all offline runtime files matched
the candidate pins. The installed tree contained 3867 files. The existing
PostgreSQL process, cluster and data directory were preserved. The operator
explicitly waived rollback preparation; no completed rollback image was used.

The existing database lacked both browser transport admission functions and
their claim trigger. The native migration therefore failed before committing.
The operator restored the exact reviewed predecessor SQL and applied eleven
runtime migrations in one transaction. The existing restricted API login also
needed EXECUTE on two newly introduced, allowlisted public native-context
functions. Only those grants were added; no password or role elevation changed.
These observations require a supported attached-runtime upgrade path rather
than relying on first-time login provisioning.

The installed Browser opened and established local ADMIN connectivity. Its
Host reached READY with API and Edge. It later stopped after three API health
HTTP 503 responses, with positive child cleanup. A subsequent isolated startup
of the installed API returned health HTTP 200, with 52/52 RPCs and 5/5 tables.
The cause of the transient health failures remains under investigation.

Two independent actual Electron regressions reproduced defects missed by Node
source tests: Electron's ordinary fs treats `app.asar` as a virtual directory.
Both the installed recovery reader and native coding image observer rejected
that directory when checking physical archive bytes. Physical metadata and
hashing must use original-fs; package and MCP source reads inside the archive
must retain Electron's archive-aware fs. Both fixes have actual Electron red
and green evidence. The failed provider bootstrap also left a windowless
singleton after dismissing its error dialog; a confirmed-cleanup exit fixes
that path without treating uncertain child cleanup as success.

No trial goal was dispatched and no model execution, independent CRITIC,
checkpoint-to-Git continuation or physical restart continuation was proved by
this installation. Prepared two-role QA profiles and component tests do not
establish those outcomes. Version `0.7.0-dev.1107139874591.1` must carry the
repairs and undergo a fresh installed trial. No production or release-signing
qualification is claimed.

The direct API also produced 166 recorded cognitive cursor permission errors.
The reviewed cognitive acceptor was SECURITY INVOKER while the direct API login
had no cursor-table privileges. The new migration changes only that exact,
body- and metadata-attested RPC to SECURITY DEFINER. Disposable PostgreSQL
verification covers restricted-role delivery, duplicate/replay behavior,
invalid devices/events, rejected authority flags and unchanged direct table
permissions and role attributes.

Per-run MCP transport budgets now allow the existing two separately authorized
Host operations (CHECK, then tool invocation), each bounded by the existing
30-second Host transport. Proof freshness, cancellation, UNKNOWN intent fences
and replay prohibitions remain enforced. A virtual-time pipe regression crosses
the old twelve-second deadline while authorization is pending, then proves one
authorized execution rather than an early transport timeout.

The manual QA installer disables differential packages so its existing `store`
compression setting is honored. This avoids the builder's differential archive
override and reduces local packaging time; the complete installer still carries
the same verified application payload.
