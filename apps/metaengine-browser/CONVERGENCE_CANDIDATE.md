# METAENGINE Browser convergence candidate

Client ADMIN.1 connectivity candidate on the UI.1/R109/C4.6 authority base. Reserved package identity is `0.7.0-dev.36753232676.1`.

ADMIN.1 changes packaged runtime bytes and must not reuse the UI.1 package identity `0.7.0-dev.36719340135.1`. The version is intentionally distinct from the previously observed R97/live identity `0.7.0-dev.36336130139.1`: R109 changes Browser UI/runtime bytes and must not reuse an older package version. The previous R109 source candidate used `0.7.0-dev.36516587173.1`. ADMIN.1 reserves a higher observed workflow namespace with the canonical `.1` suffix before building; the final producer run, installer SHA-256 and released artifact identity must still be recorded separately on the exact final source SHA.

Canonical production authority:
- one Native Browser Supervisor/Fleet task and Agent lifecycle authority;
- real authenticated z.ai Agent Web UI sessions, with durable Agent-origin/session provenance;
- one geometry-independent Browser effect path with readback and no blind retry;
- Browser Brain and durable memory remain Native Browser-owned;
- Browser-packaged ME2 is a standalone read-only, zero-authority compatibility probe;
- legacy ME2 Mission Control scheduler, Browser/Agents/Command/Compute authority pages and daemon task-mutation UI are retired;
- historical managed-model/API coordination is quarantined from production Agent execution.

Primary UI contract:
- one persistent Chat Fleet workspace;
- supervisors and fleet agents on the left;
- exact selected native Agent/Chat WebContents on the right;
- advanced observation surfaces are non-authoritative unless explicitly bound to canonical DevOS mutations;
- no second scheduler, executor, browser-command authority, retry plane or model API fallback in the renderer/runtime.

Release safety invariants:
- ambiguous external effects are reconciled, never blindly replayed;
- no authority widening or bypass of Guardian/Sentinel, self-update receipts, installer barriers or successor qualification;
- source qualification does not imply live Edge equivalence: the R83 v14 canary gate remains fail-closed until a separately authorized exact-source canary deployment and qualification;
- tested source SHA, built installer and released installer must be identical in the final release chain;
- promotion requires terminal-green exact-head critical gates plus physical clean/upgrade/self-update and post-update z.ai Agent E2E evidence.
