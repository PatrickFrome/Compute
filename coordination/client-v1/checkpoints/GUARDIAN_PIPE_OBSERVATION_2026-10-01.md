# Guardian pipe observation — 2026-10-01

User installation readback at 18:29 UTC: version 0.7.0-dev.36832190273.1; fresh heartbeat; ADMIN epoch 1; Compute HEALTHY; Development Plane READY on exact source 5b585ae301cdc273f58d01963e54b5b6f539181d. Supervisor PARKED, admission CLOSED, refill/supervisor admission disabled; this is an authority fence and does not prove useful autonomous execution. Guardian owner/service is not included in current heartbeat and is not claimed qualified live.

Found source defect: launcher mapped every pipe error, timeout and ended-without-result to ACTIVATION_REQUIRED. A delayed, denied or interrupted native probe could prompt a redundant elevated bootstrap. The pipe client now preserves structured OS code and whether connect occurred. Only pre-connect ENOENT offers explicit activation. Other observations HOLD with no UAC and no enrollment. Endpoint absence does not claim SCM service absence or grant native repeat/repair authority.

Added negative tests for timeout, closed pipe, message-only ENOENT, EACCES and ECONNRESET, and classifier tests for structured pre/post-connect ENOENT and other OS errors. Previous owner recovery tests are retained from 9a8cb0f1f1bf732c056433d9ddc84f2df8e7a88a.

Research: https://nodejs.org/api/net.html (named pipes, connect/error/timeout events); https://nodejs.org/api/errors.html (structured system error code). Design inference: infer missing endpoint only from OS ENOENT before successful connection, never from message text or lack of response.

Runtime package changes reserve monotonic 0.7.0-dev.36891107801.1. Existing qualified installer remains unchanged. CI qualification pending at creation. No shell/Windows runner available in current workspace (exec-server transport closed); existing GitHub Actions is the validation executor. No live ticket, owner mutation, UAC, restart, emergency update or admission override issued.

Next physical gate: explicit SYSTEM/Runtime activation in installed client, approved ticket → native owner CAS → independent read-only signed proof → restart continuity. Existing admission stays CLOSED until useful Agent-origin task loop has independent proof.

Continuation: raw native receipt normalization was outside the data-handler catch; invalid schema/authority/state could throw out of an EventEmitter callback. Catch and reject it. Handle close-without-result, add an absolute deadline (not just inactivity timeout), and ignore late connect/data after settlement. Raw socket regressions inject EventEmitter/Node net only inside isolated tests; production fixed pipe and Windows restriction stay unchanged. Package reservation advances to 0.7.0-dev.36907623240.1.

Enrollment budget audit: native WinHTTP phases permit 3s resolve, 3s connect, 5s send and 5s receive. Launcher previously forced all owner requests to 2s, including ticket redemption/CAS. Owner request constructor now owns fixed 2s read-only / 30s ticket-bound deadlines; launcher forwards them. No caller override, retry or wider executor capability. Independent readback remains 2s. A regression asserts ordered [2000,30000,2000] deadlines and rejects caller timeout widening by ignoring it. Identity advances again to 0.7.0-dev.36908273822.1. f799cbef full Node suite was 3850/3850 PASS; its package bytes are consumed, not relabelled as this successor.
