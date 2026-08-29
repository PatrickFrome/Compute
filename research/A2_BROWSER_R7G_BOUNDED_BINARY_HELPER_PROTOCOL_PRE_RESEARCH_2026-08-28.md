# A2 Browser R7G — Bounded Binary Skill-Source Helper Protocol

Date: 2026-08-28
Status: pre-implementation research and architecture decision

## Goal

Expose the already-confined R7F/R7F.1 Linux skill source through a process boundary without giving a future Node daemon ambient filesystem authority and without creating a generic filesystem RPC surface.

R7G intentionally stops at the helper protocol/process contract. Node integration and Landlock process confinement are separate later steps so parser/IPC bugs and sandbox-policy bugs cannot hide each other in one milestone.

## Research comparisons

### Chromium Linux sandbox IPC and syscall broker

Chromium uses a deliberately small, low-level Linux sandbox IPC that is separate from its main IPC mechanisms. The syscall broker similarly exposes a narrow command set, applies policy checks, and treats invalid IPC commands as errors. Current Chromium code also carries explicit maximum message lengths rather than allowing arbitrary messages.

A2 adopts the same architectural direction but with a narrower contract: the helper has only `LIST_SKILLS` and `READ_PACKAGE`. It never accepts an arbitrary path, file descriptor request, browser command, shell command, or generic filesystem operation.

Sources:
- https://chromium.googlesource.com/chromium/src.git/+/master/docs/linux/sandbox_ipc.md
- https://chromium.googlesource.com/chromium/src/+/HEAD/sandbox/linux/syscall_broker/broker_process.h
- https://chromium.googlesource.com/chromium/src/+/master/sandbox/linux/services/credentials.cc

### Chromium Mojo security guidance

Chromium's Mojo security guidance says input crossing a lower-trust boundary must be treated as potentially malicious. Lengths, offsets, arithmetic and privilege-presuming data need validation before use; a malformed message can be treated as a bad message rather than being partially interpreted.

R7G therefore distinguishes two classes:

1. malformed wire protocol => fail closed and terminate the helper without emitting a response;
2. structurally valid request whose confined source operation fails => return one bounded typed error token and keep the stream usable.

Source:
- https://chromium.googlesource.com/chromium/src/+/master/docs/security/mojo.md

### gRPC and SSH framing

Both gRPC and SSH use explicit network-order length fields. This is a useful primitive because receivers can reject oversized input before allocating a body buffer. R7G keeps only that simple idea; it does not adopt gRPC compression, HTTP/2, SSH padding, negotiation, extension frames, or generic method names.

Sources:
- https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md
- https://www.rfc-editor.org/rfc/rfc4253.html

### Cap'n Proto traversal limits

Cap'n Proto demonstrates why byte-size limits are not sufficient: a compact or adversarial structure can amplify traversal work through counts or nesting. R7F.1 was completed before R7G specifically to make backend directory traversal bounded as well as the wire parser. R7G itself has no recursive structures and has explicit list/file cardinality limits.

Sources:
- https://capnproto.org/cxx.html
- https://capnproto.org/encoding.html

## Protocol v1

Every frame starts with a four-byte unsigned big-endian payload length. The length is validated before body allocation.

### Request header — fixed 12 bytes

- `version: u8` — exactly `1`;
- `opcode: u8` — exactly `1` (`LIST_SKILLS`) or `2` (`READ_PACKAGE`);
- `flags: u16` — must be zero;
- `request_id: u64` — non-zero, daemon-selected correlation token.

Maximum request payload is only 77 bytes:

- `LIST_SKILLS`: exactly the 12-byte header;
- `READ_PACKAGE`: header + one-byte skill-name length + at most 64 ASCII bytes.

There is no path field. The lexical skill name is the only selector; R7F constructs and confines all filesystem paths itself.

### Response header — fixed 12 bytes

- `version: u8`;
- `opcode: u8`;
- `status: u8` — `OK` or `ERROR`;
- reserved byte — zero;
- echoed `request_id: u64`.

`LIST_SKILLS` returns at most 128 strictly sorted validated names.

`READ_PACKAGE` returns at most 65 strictly sorted files. Before encoding, the protocol layer independently revalidates:

- path grammar: `SKILL.md` or one level under `assets/`, `references/`, `scripts/`;
- exactly one non-executable `SKILL.md`;
- per-file byte budgets;
- total package byte budget;
- response frame budget;
- file ordering and cardinality.

This duplicates some R7F validation intentionally. The process boundary must not assume its source object can never regress.

### Error channel

A valid request may receive an `ERROR` response containing only a lowercase/digit/underscore token of at most 64 bytes, for example `skill_loader_confined_open_failed`. Raw OS errors, paths and arbitrary strings are not serializable on this channel.

Protocol parser errors are not converted into an error response because the request header itself is untrusted. They terminate the process with a typed stderr code.

## Work and memory bounds

- request body allocation: <= 77 bytes;
- response package raw bytes: <= R7F package budget (~2.1 MiB);
- skills: <= 128;
- package files: <= 65;
- parser recursion: none;
- compression: none;
- dynamic schema/reflection: none;
- concurrent requests: none in v1;
- backend directory enumeration: bounded by R7F.1 before this protocol is reached.

Sequential processing is intentional for v1. It preserves causal request/response order and avoids creating a second scheduler before the security boundary itself is proven.

### Validate-first direct response streaming

An early draft encoded the complete response into a second package-sized `Vec` before writing it. Although bounded, that would approximately double peak package memory at the process boundary. The final R7G design instead performs a complete validation/size preflight first and then writes the length prefix, header, metadata and existing file byte slices directly to stdout.

This gives both properties simultaneously:

- no response byte is emitted before the complete logical response has passed validation;
- no second ~2.2 MiB wire buffer is allocated for a maximum package.

I/O failure after emission begins is treated as fatal process failure; the consumer must discard the incomplete frame.

## Dependency and TCB decision

R7G adds no serialization or IPC dependency. Encoding/decoding is a small manual fixed-layout parser using checked integer arithmetic and standard I/O. The crate retains one direct dependency, exact-pinned `rustix = 1.1.4`, inherited from R7F.

This is preferable to pulling in Protobuf/Cap'n Proto/Serde for a protocol with two commands and two response shapes: generic frameworks would increase parser/codegen/dependency surface without adding useful expressiveness here.

## Process contract

The standalone helper:

1. accepts exactly one operator-provided root argument;
2. opens it through `LinuxSkillSource`;
3. reads length-prefixed requests from stdin;
4. performs only `LIST_SKILLS` or `READ_PACKAGE`;
5. writes framed responses to stdout and flushes after each response;
6. emits only a typed fatal code to stderr and exits non-zero on malformed protocol/internal protocol failure;
7. contains no network API, browser API, child-process execution, shell execution, or arbitrary path RPC.

## Next step after R7G

R7H should add Linux process confinement before any Node adapter is allowed:

`open configured root -> establish Landlock read-only policy -> drop ambient filesystem/network rights -> serve the R7G stream`.

Landlock needs its own milestone because already-open file descriptors and ABI compatibility need explicit tests; process sandboxing should not be silently coupled to protocol correctness.
