# DevOS IDE PTY Research V1

Status: **ADVISORY ONLY**

Task: `c4d62553-246f-4c43-bf7e-d823c4de39fe`
Role: `RESEARCHER`
Base: `84a71aaedc49186c24a992f507ca1d3f14767181`
Branch: `work/devos-ide-pty-research-v1`

## Evidence gates

- The exact base commit exists and was the repository `main` head when this research started.
- The base already contains `devos/components/Terminal.tsx`, a `node-pty` + WebSocket broker at `devos/scripts/pty-server.mjs`, platform launch scripts, and PTY helper e2e coverage.
- Supabase fleet state classifies this task as `ADVISORY`, lease generation `1`, `authority_effect=false`.
- Monaco implementation evidence is **not verified**: `devos.ide.shell.monaco.v2` is `AMBIGUOUS` with `LEASE_EXPIRED_EFFECT_UNKNOWN`; the earlier Monaco task is `FAILED / NO_EFFECT_VERIFIED_NO_DISPATCH`. No matching Monaco implementation branch was visible through the GitHub branch search at research time.
- Therefore all decisions below are design/test requirements only. No PTY implementation or production change is authorized by this checkpoint.

## Current-source findings

1. xterm.js 6 documentation states that `Terminal.write` is asynchronous, accepts `Uint8Array` as UTF-8, and offers a callback after parsing. Its flow-control guide explicitly warns that fast producers can outrun the emulator and recommends high/low watermark control; when WebSockets are present, it recommends extending write-completion accounting across the transport with a custom ACK protocol.
2. The standard browser `WebSocket` API has no receive-side backpressure. `bufferedAmount` only exposes bytes queued for outbound transmission.
3. Current `node-pty` supports Linux/macOS and Windows ConPTY. `winpty` support has been removed. It exposes `pause()`/`resume()`, `resize()`, encoding configuration on Unix, and optional XON/XOFF `handleFlowControl`; it also warns that PTY children run with the parent's privilege and that the package is not thread-safe.
4. Microsoft ConPTY documentation requires UTF-8 + VT sequences on its pseudoconsole streams. Its synchronous input/output channels should be drained independently to avoid deadlocks. `ClosePseudoConsole` has version-dependent teardown behavior; older Windows can block if output is not drained, while Windows 11 24H2 changed close behavior and added `ReleasePseudoConsole` for graceful lifetime handling.
5. Windows Job Objects provide process-tree containment and `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`; Unix provides session/process-group primitives (`setsid`, `killpg`).
6. VS Code's current terminal architecture uses a PTY host boundary, monitors host responsiveness/restarts, supports reconnection/revive, and distinguishes process reconnection from process revive. This is a stronger reference architecture than binding terminal lifetime to a renderer.
7. Electron recommends context isolation, renderer sandboxing, no Node integration for untrusted content, sender validation for IPC, and narrow privileged APIs. `utilityProcess.fork` provides a Node-capable child process with Chromium MessagePorts and is a suitable isolation boundary to evaluate for an Electron PTY host.

## Architecture decisions

### D1 — One dedicated PTY host/broker; renderer never owns `node-pty`

**Decision.** Put all PTY creation, OS handles, lifecycle and process-tree control behind one dedicated broker process. In Electron, prefer a dedicated `utilityProcess` (or an external DevOS terminal daemon if survival across Electron main-process restart is required). The xterm.js renderer receives only a narrow typed session API.

Required API shape should be capability-oriented, for example: `create(profileId,cwdId,cols,rows)`, `input(sessionId,seq,bytes)`, `resize(sessionId,resizeSeq,cols,rows)`, `signal(sessionId,signalKind)`, `close(sessionId,closeGeneration)`, `attach(sessionId,lastAck)`, `ack(sessionId,seq,bytesParsed)`.

**Do not expose** raw `spawn`, arbitrary executable strings, `eval`, shell snippets, generic Electron IPC, filesystem handles or broker MessagePorts to page/model content.

**Expected gain.** High reliability/security: a renderer crash/reload no longer owns PTY lifetime; PTY-native crashes and blocking I/O are isolated from the UI/main process. Better parallel terminal scalability because PTY work is not on the renderer event loop.

**Risk.** Broker crash becomes a shared failure domain. Mitigate with health monitoring, bounded session count, per-session isolation metadata and explicit crash semantics (D8).

### D2 — End-to-end credit/ACK backpressure, not WebSocket buffering heuristics

**Decision.** Add protocol-level output sequence numbers and byte credits from broker -> renderer. Count bytes accepted by xterm.js and send ACK only after `Terminal.write(..., callback)` confirms parsing. Maintain broker high/low watermarks and call `pty.pause()`/`pty.resume()` when unacked bytes cross thresholds. Treat browser `WebSocket.bufferedAmount` only as an additional outbound safety metric, not the correctness mechanism.

Initial tuning should follow xterm's guidance rather than hard-code a universal value: cap pending renderer work to a bounded sub-megabyte window, then benchmark `yes`/large build logs while measuring Ctrl-C latency, UI frame latency and memory. A starting high watermark <=500 KiB is defensible from the xterm.js guide, but must remain configurable and tested.

Use protocol-level control frames rather than literal XON/XOFF bytes whenever possible, because applications may legitimately consume those control codes. `node-pty`'s `handleFlowControl` can be an internal fallback, not the cross-process protocol.

**Expected gain.** Very high reliability: bounded memory under unbounded producers; dramatically lower risk of renderer lockup/OOM and more predictable interactive latency during heavy output. Throughput should remain materially higher than pause/resume-per-chunk designs because ACKs are batched.

**Risk.** Lost/mismatched ACKs can deadlock the stream. Fence every ACK by `sessionId + incarnation + monotonically increasing seq`; add watchdog telemetry but never resume by blind retry after an ambiguous ACK state.

### D3 — Binary UTF-8 transport with one normalization boundary

**Decision.** Standardize PTY output over the DevOS transport as bytes (`Uint8Array`/binary WebSocket frames) representing UTF-8 + VT sequences. Feed raw bytes directly to `Terminal.write(Uint8Array)` so xterm.js owns incremental UTF-8 decoding. Keep a separate typed binary-input path for xterm.js `onBinary`; normal `onData` input is UTF-8 encoded exactly once at the broker boundary.

On Unix, use `node-pty` with `encoding: null` when the selected node-pty version supports the required Buffer path reliably. On Windows, ConPTY is UTF-8 by contract and node-pty's Windows implementation does not support arbitrary encoding selection, so do not invent a Windows code-page abstraction in the transport.

Make Unicode width a negotiated display capability (`unicodeVersion`) rather than a transport encoding. Keep experimental grapheme-cluster addons out of the baseline until parity tests prove shell/editor behavior.

**Expected gain.** Medium-high reliability: eliminates split-multibyte corruption and double transcoding; improves parity between ConPTY and Unix PTYs and reduces avoidable string allocations under high output.

**Risk.** Legacy Unix programs emitting non-UTF-8 bytes need an explicit transcoding profile outside the core PTY protocol; silent auto-detection would make recovery and replay nondeterministic.

### D4 — Resize is ordered state, coalesced and acknowledged

**Decision.** Treat resize as a last-value-wins control stream with a monotonically increasing `resizeSeq`. xterm `FitAddon`/layout changes may emit bursts; debounce/coalesce them to at most one outstanding resize per animation frame (or a small fixed interval), reject non-positive dimensions, and apply only the newest generation to `pty.resize(cols,rows)` / ConPTY `ResizePseudoConsole`.

Create a session with real initial dimensions before launching the shell. On attach/reconnect, apply the current dimensions before releasing replay/live output to avoid alternate-screen/cursor corruption.

**Expected gain.** Medium reliability/performance: fewer native resize calls and fewer ConPTY/curses races; lower CPU during pane dragging; deterministic terminal geometry after reconnect.

**Risk.** Over-aggressive debounce makes interactive pane resizing visibly lag. Keep the bound small and benchmark dragging plus `vim`, `less`, `top`, PowerShell/PSReadLine and TUI workloads.

### D5 — OS-native process-tree containment with bounded escalation

**Decision.** Give each terminal session a process-tree containment object.

- **Windows:** assign the launched root to a per-session Job Object where integration permits, with kill-on-job-close semantics; use ConPTY close semantics as terminal-session control, but do not rely on parent-PID enumeration as the authority for descendants.
- **Unix:** ensure a dedicated session/process group and terminate the group, not only the shell PID.

Expose only a typed, allowlisted signal vocabulary. Suggested semantic set: `INTERRUPT`, `TERMINATE`, `KILL`, `HANGUP` where supported. Map semantics per OS; do not accept arbitrary numeric signals from untrusted renderer/page data.

For user-requested close use bounded escalation: request graceful termination once, observe an explicit exit/pipe-close event, then after a fixed deadline escalate once. If the transport outcome is ambiguous, query broker session state before any further action; never issue another destructive operation merely because the first acknowledgement was lost.

**Expected gain.** High reliability: far fewer orphaned compiler/dev-server/grandchild processes; deterministic workspace cleanup; avoids PID-reuse mistakes inherent in tree walking.

**Risk.** Job nesting/restrictions can interact with launchers, debuggers, containers and WSL. Feature-detect and test nested-job cases; fail closed to a documented weaker containment mode rather than silently claiming full-tree authority.

### D6 — Replace renderer-chosen command strings with trusted shell profiles

**Decision.** The current base's PTY server accepts shell selection/arguments through URL/environment inputs. Before IDE integration, narrow this to a broker-owned allowlist of signed/static shell profiles such as `pwsh`, `cmd`, `bash`, `zsh`, `wsl:<approved-distro>`, plus explicitly registered DevOS tools. The renderer sends only `profileId` and typed workspace/cwd references.

Construct process arguments as argv arrays. Do not concatenate shell commands, pass page/model text into `shell -c`/`cmd /c`, or add a generic execute endpoint. Environment should be derived from a broker policy with an explicit pass-through allowlist/denylist for high-risk variables.

**Expected gain.** Very high security/reliability: removes the PTY layer as an arbitrary process-execution API while retaining normal interactive shell capability; simplifies provenance and auditing.

**Risk.** Power users lose ad-hoc launch flexibility. Recover it through user-owned, explicitly configured profiles, not arbitrary renderer payloads.

### D7 — Session identity and reconnection use incarnation fencing

**Decision.** Give every PTY a durable logical `sessionId` plus a fresh random/monotonic `incarnation` whenever a process is created/revived. Every input, resize, ACK, signal and close frame must carry both; stale frames are rejected. Output is sequenced so a reconnecting renderer can send `lastParsedSeq` and receive only an allowed replay window plus live data.

The broker retains a bounded ring buffer of VT bytes for short renderer disconnects. Persist only bounded, privacy-reviewed terminal state (metadata + optional serialized normal-buffer scrollback), never unbounded raw logs by default.

**Expected gain.** High reliability: renderer reload/network reconnect does not duplicate keystrokes or apply stale resizes/signals to a replacement shell. Reconnection feels immediate and avoids unnecessary process restarts.

**Risk.** Replay of arbitrary VT output can contain sensitive text or control sequences. Bound size/time, scope by workspace/session, and never make terminal output an authority source.

### D8 — Distinguish reconnect from revive; no fake process continuity after broker crash

**Decision.** Adopt VS Code's distinction:

1. **Reconnect:** PTY host and process are still alive; reattach to the same incarnation and replay a bounded gap.
2. **Revive:** process is gone; restore approved session metadata/normal-buffer snapshot and launch a new process with a **new incarnation**. Clearly mark the UI as revived/restarted.

If the PTY host crashes, do not claim existing shell continuity unless an external daemon proves the OS process/PTY still exists and can be securely reattached. For a `utilityProcess`-owned PTY, broker death should normally be `PROCESS_LOST`, followed by explicit revive policy, not blind respawn pretending to be the same session.

Persist session metadata atomically with schema version, workspace identity, shell profile ID, cwd reference, dimensions, last output sequence, incarnation and clean/unclean shutdown marker. Never persist command input as a recovery command queue.

**Expected gain.** Very high correctness: eliminates duplicate side effects from replaying typed commands after crashes and makes failure semantics auditable. Good UX can still restore scrollback and relaunch a shell without lying about process identity.

**Risk.** Revived shells cannot reproduce in-memory state of the old process. That limitation must remain explicit; tmux/screen or an external durable terminal daemon are separate opt-in persistence mechanisms.

### D9 — PTY protocol is a capability protocol with explicit quotas and observability

**Decision.** Define a versioned protocol and quotas before Monaco wiring:

- max sessions per workspace/user;
- max unacked output bytes per session and global broker;
- max input frame and paste size;
- max scrollback/replay bytes;
- resize rate limit;
- create/close rate limits;
- idle and orphan grace periods;
- typed exit reason and broker crash reason;
- counters for output bytes, pending credits, pause duration, xterm parse-ACK latency, resize coalescing, dropped/rejected stale frames, process-tree cleanup duration.

Electron IPC/WebSocket handlers must validate sender/origin plus session capability, not just payload shape. Context isolation and renderer sandbox stay enabled; no Node integration and no generic IPC bridge.

**Expected gain.** High reliability/security and faster debugging: overload becomes a bounded, observable state instead of an OOM/hang. Metrics make backpressure thresholds tunable from evidence rather than intuition.

**Risk.** Poor quotas can hurt legitimate builds. Start conservative but configurable, record saturation metrics, and tune via workload tests rather than removing limits.

## Required tests before implementation can be considered verified

1. High-output flood (`yes`/equivalent, compiler log burst): memory stays bounded and Ctrl-C remains responsive.
2. Renderer reload during output and during input: no duplicated/lost input beyond explicitly acknowledged transport semantics.
3. ACK loss/duplicate/reorder simulation: no blind resume, no negative credits, no permanent deadlock after an explicit resync handshake.
4. Rapid pane resize with `vim`, `less`, `top`, PowerShell/PSReadLine and Windows ConPTY; final geometry must converge exactly.
5. UTF-8 split-boundary fuzz: emoji/CJK/combining sequences and random byte chunking are stable across Unix and ConPTY.
6. Process tree: shell -> child -> grandchild cleanup on normal close, broker crash, renderer crash and forced kill; verify no PID-reuse/tree-walk assumption.
7. ConPTY teardown on pre-Windows-11-24H2 behavior and Windows 11 24H2+: no broker deadlock while output is still draining.
8. Broker crash/restart: stale incarnation messages are rejected; UI distinguishes lost/revived from reconnected.
9. Security negatives: arbitrary executable/argv, shell command strings, unknown profile IDs, oversized paste/output frames, stale session capabilities and IPC from an untrusted frame all fail closed.
10. Persistence privacy: bounded snapshot, no secret-bearing environment dump, no automatic input replay, alternate-buffer handling documented and tested.

## Recommended dependency order after Monaco evidence exists

1. Protocol types + session/incarnation fencing + negative tests.
2. Dedicated PTY host boundary and trusted profile registry.
3. Binary UTF-8 transport.
4. Credit/ACK backpressure and telemetry.
5. Ordered/coalesced resize.
6. OS-native process-tree containment + bounded close state machine.
7. Short-disconnect reconnect/ring buffer.
8. Optional persisted revive, only after privacy review and crash tests.

## Sources reviewed (2026-08-31)

- xterm.js 6 documentation: `https://xtermjs.org/docs/`
- xterm.js flow-control guide: `https://xtermjs.org/docs/guides/flowcontrol/`
- xterm.js encoding guide: `https://xtermjs.org/docs/guides/encoding/`
- xterm.js security guide: `https://xtermjs.org/docs/guides/security/`
- xterm.js Terminal API: `https://xtermjs.org/docs/api/terminal/classes/terminal/`
- Microsoft node-pty README and typings: `https://github.com/microsoft/node-pty`
- Microsoft ConPTY pseudoconsole documentation: `https://learn.microsoft.com/windows/console/creating-a-pseudoconsole-session`
- Microsoft `ClosePseudoConsole` / `ReleasePseudoConsole` documentation.
- Microsoft Windows Job Objects / `AssignProcessToJobObject` documentation.
- Electron Security / Context Isolation / `utilityProcess` documentation: `https://www.electronjs.org/docs/latest/`
- VS Code Terminal Advanced documentation and current terminal process manager/pty-host source.
- Linux man-pages for `setsid(2)` and `killpg(3)`.
- MDN WebSocket API / `bufferedAmount`.

## Research disposition

**GO for architecture specification and fail-closed test design.**

**NO-GO for PTY/Monaco implementation or production promotion until Monaco implementation is verified and the DevOS integration owner explicitly advances the gate.**
