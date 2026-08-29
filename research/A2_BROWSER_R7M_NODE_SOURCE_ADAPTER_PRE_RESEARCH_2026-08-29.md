# A2 Browser R7M — Node Source Adapter — Pre-Implementation Research

Date: 2026-08-29
Parent verified runtime: R7L `8eb4931e3090f3d36a5fbe15527cfcd1870811b0`
Milestone: `R7M_NODE_SOURCE_ADAPTER_V1`

## Problem

R7E already defines a transactional, metadata-only skill registry whose only source-facing capabilities are `listSkillNames()` and `readSkillPackage(name)`. R7G–R7L now provide a bounded binary helper protocol behind a Linux launcher that cuts inherited descriptors/environment, sets `no_new_privs`, confines fixed-sibling helper lookup with `openat2`, and performs FD-bound execution.

The missing boundary is the long-lived Node/Compute Browser daemon adapter. A naïve `child_process` wrapper can accidentally reintroduce ambient environment, shell/path lookup, unbounded stdio buffering, concurrent request ambiguity, silent process restart, malformed-frame desynchronization, or planner-visible executable/filesystem authority.

The goal is therefore **not** a general subprocess API. It is a narrow transport capability that exposes only the two R7E source operations while keeping launcher/root configuration, child handles, PID, and restart authority private to daemon-owned bootstrap code.

## Primary-source findings

### Node.js `child_process`

Node documents that `spawn()` uses pipes of finite, platform-specific capacity, that an unconsumed child stdout can block the child, that `options.env` defaults to `process.env`, and that shell execution is optional with `shell: false` as the direct-spawn mode. It also documents that command lookup may use PATH when a non-absolute command is supplied.

Implication: R7M must require an absolute launcher path, set `shell: false`, provide an explicit empty environment, consume stdout/stderr continuously, and bound both protocol frames and diagnostic stderr.

Source: https://nodejs.org/api/child_process.html

### Chrome native messaging

Chrome's native messaging design keeps a native process alive for a connected port and uses explicitly length-prefixed messages over stdin/stdout, with message-size limits to protect the browser from a misbehaving native peer.

Implication: a long-lived bounded framed port is a proven browser/native integration shape, but R7M should retain the already-defined R7G binary protocol rather than introducing JSON/native-messaging semantics or browser authority.

Source: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging

### Chromium sandbox broker/target split

Chromium separates a controller/broker from restricted target processes and centralizes policy/IPC rather than exposing privileged mechanisms to arbitrary target code.

Implication: the Node daemon may own adapter construction, but planner-facing code should receive only the semantic source capability, never launcher paths, child handles, generic spawn, filesystem APIs, or restart controls.

Source: https://chromium.googlesource.com/chromium/src/+/HEAD/docs/design/sandbox.md

## Candidate approaches

### A. Spawn a fresh launcher per semantic request

SECURITY: medium — short lifetime, but every request repeats pathname execution and bootstrap.

RELIABILITY: low/medium — restart is implicit and can hide process failure between list/read phases.

TCB SIZE: small.

COMPLEXITY: low.

SUPPLY CHAIN: none.

PORTABILITY: Linux launcher only.

OBSERVABILITY: medium.

TESTABILITY: high.

FAILURE MODE: list and package reads can come from different process/install states; process churn makes refresh atomicity harder to reason about.

Decision: reject.

### B. Long-lived child plus ad-hoc JSON lines

SECURITY: medium — easy to inspect, but replaces an already verified protocol and creates a second parser/contract.

RELIABILITY: medium.

TCB SIZE: larger because two protocol definitions coexist.

COMPLEXITY: medium.

SUPPLY CHAIN: none.

PORTABILITY: high at Node layer.

OBSERVABILITY: high.

TESTABILITY: high.

FAILURE MODE: delimiter/encoding/buffering ambiguity and contract drift from R7G.

Decision: reject.

### C. Long-lived Node adapter over the existing R7G bounded binary protocol

SECURITY: high if configuration is private, spawn is direct/absolute, env is empty, parser is bounded, and desync is terminal.

RELIABILITY: high — list/read share one process epoch; no silent respawn; exactly one outstanding request removes response correlation races.

TCB SIZE: small/medium — one Node framing/decoder module, no new package.

COMPLEXITY: medium.

SUPPLY CHAIN: zero new dependencies; Node built-ins only.

PORTABILITY: Node layer portable, authoritative launcher runtime remains Linux-only.

OBSERVABILITY: high through bounded typed state/errors without raw stderr/path disclosure.

TESTABILITY: high with fake-protocol peers plus the real R7L launcher/helper on Linux.

FAILURE MODE: child exit, timeout, malformed frame, unexpected response, backpressure failure; all can be made terminal/fail-closed.

Decision: choose.

### D. Generic subprocess broker exposed to planner/runtime code

SECURITY: low — transfers executable-path and process authority across the semantic boundary.

RELIABILITY: medium.

TCB SIZE: large.

COMPLEXITY: high.

SUPPLY CHAIN: potentially none.

PORTABILITY: high.

OBSERVABILITY: medium.

TESTABILITY: medium.

FAILURE MODE: confused-deputy arbitrary execution.

Decision: reject.

## DECISION

Implement `createLinuxSkillSourceAdapter()` as a daemon-owned, frozen capability with only:

- `listSkillNames()`;
- `readSkillPackage(name)`;
- explicit lifecycle `close()` for the owner.

The constructor captures and never re-exposes an absolute normalized launcher path and absolute normalized skill root. It directly spawns the launcher with `shell: false`, `cwd: '/'`, `env: {}`, and exactly three pipe descriptors. The adapter is lazy and long-lived; after any terminal protocol/process/timeout failure it never silently respawns. A new adapter instance is required for recovery.

Wire behavior:

- protocol version 1 only;
- two opcodes only;
- monotonically increasing non-zero u64 request ids;
- exactly one outstanding request;
- big-endian u32 frame prefix;
- frame length checked before allocation/accumulation;
- bounded list/package cardinality and bytes before materialization;
- exact opcode/request-id/status/reserved-field checks;
- trailing bytes are a bad message;
- malformed, unsolicited, duplicated, or oversized responses terminate the transport;
- bounded stderr is consumed but never returned verbatim to planner-facing callers;
- per-request timeout terminates the transport;
- stdin backpressure/write failures are explicit failures.

The adapter returns package files in the exact existing R7E shape `{path, type:'file', executable, bytes}`. It does not parse SKILL.md semantics and it does not grant execution eligibility.

## WHY

This is the smallest semantic slice that converts the already-verified Linux boundary into a usable daemon source without bypassing it. It preserves the R7E transaction model and R7G wire contract, adds no dependency, and makes every ambiguous transport state terminal rather than guessing/retrying.

## REJECTED_ALTERNATIVES

- per-request respawn: breaks process-epoch continuity and can hide mid-refresh failure;
- JSON/newline bridge: duplicates a verified protocol;
- generic spawn broker: creates a confused-deputy execution capability;
- automatic restart: can combine a registry refresh across two native process/install epochs;
- buffering full stdout/stderr then parsing: violates bounded-stream requirements.

## NEW_INVARIANTS

- `NODE_SOURCE_ADAPTER_EXPOSES_ONLY_LIST_READ_AND_OWNER_CLOSE`.
- `PLANNER_NEVER_RECEIVES_LAUNCHER_PATH_CHILD_HANDLE_PID_OR_GENERIC_SPAWN`.
- `LAUNCHER_PATH_IS_ABSOLUTE_AND_LEXICALLY_NORMALIZED`.
- `NODE_CHILD_ENVIRONMENT_IS_EXPLICITLY_EMPTY`.
- `NODE_CHILD_SHELL_IS_DISABLED`.
- `ONE_ADAPTER_ONE_LONG_LIVED_PROCESS_EPOCH`.
- `EXACTLY_ONE_OUTSTANDING_HELPER_REQUEST`.
- `PROTOCOL_DESYNCHRONIZATION_IS_TERMINAL`.
- `TIMEOUT_IS_TERMINAL_AND_NEVER_SILENTLY_RETRIED`.
- `STDOUT_AND_STDERR_ARE_CONTINUOUSLY_CONSUMED_AND_BOUNDED`.
- `R7G_WIRE_LIMITS_ARE_REENFORCED_IN_NODE_BEFORE_MATERIALIZATION`.
- `ZERO_NEW_DEPENDENCY_PACKAGES`.

## Explicit non-claims

- R7M does not make a Node pathname spawn cryptographically identity-bound; launcher installation path ownership remains a trusted deployment input inherited from R7L's deployment assumptions.
- R7M does not drop daemon privileges, create namespaces/cgroups, or add a process supervisor.
- R7M does not introduce browser, network, WebMCP invoke, or actuation authority.
- R7M does not auto-restart a failed source process.
- Linux x86_64 remains the required runtime-proof platform for the native launcher/helper path.