# DevFleet append-only snapshot crash-safe commit V2

Scope: source-only, standalone DevFleet under the existing single operator. The underlying `operator-state.json` is held open on Windows by a Desktop Commander `node.exe` process; we must not kill that process, clear the journal or force-close its OS handle.

This slice strengthens the currently installed `journal-snapshot-store.mjs` contract (the live alternative added in PR #1245). The initial implementation opened a final `operator-state.json.snapshot-v1-NNNNNNNN.json` and wrote bytes directly. If the process died mid-write, the apparent final generation remained truncated and permanently fenced the next startup.

The new design writes and fsyncs **one same-directory, unique temp file**, closes it, then atomically creates the final generation as a hard link. NTFS link creation refuses overwriting a competing generation with the same sequence; a race fails closed. Temp files are excluded from committed catalog matching only when they match the exact `.json.tmp-<UUID>` format. The final file is read back byte-for-byte and its SHA chain verified. An ambiguous link result is accepted only after exact committed-file readback, never from a transport acknowledgement.

No legacy file overwrite, forced handle closure, external shell authority, Send replay, second scheduler, PostgreSQL or Supabase mutation. Source branch is independent; no installed DevFleet module has been replaced by this candidate.

Windows tests include an incomplete temporary generation surviving a crash, two competing writers at the same sequence, interrupted commit, ambiguous link acknowledgement, malicious catalog filename, and the earlier locked-primary/chain tests.

Caveats: Existing `MAX_SNAPSHOTS=512` and operator's 500-request history remain separate throughput limits. Long-lived autonomous development requires chain-verified archival/checkpoint compaction and bounded hot-slot scheduling.
