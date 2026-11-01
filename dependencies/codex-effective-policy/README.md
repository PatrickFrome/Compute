# Pinned Codex effective-policy producer

Compute-local source overlay for OpenAI Codex `rust-v0.159.0-alpha.3` at
`3b01b36fa5eb96ba82a776bd3c2fc57f8969181f`. Label the resulting distribution
**pinned upstream + reviewed Compute patch** and retain both source identities.
The patched build is not an unchanged vendor-signed CLI. Read
[CONTRACT.md](CONTRACT.md) for the producer/consumer boundary and exact private
wire lifecycle; [WIRE-CONTRACT-JS-v1.md](WIRE-CONTRACT-JS-v1.md) specifies every
closed field allowlist and inherited value shape for JS consumers. This patch
is not submitted to OpenAI and does not change any installed Codex executable.

The existing App Server `config/read`/`configRequirements/read` APIs reload
configuration independently and cannot attest a fresh exec thread's resolved
context. Exec's startup config is also too early: thread/start can resolve
project trust and reload. This overlay adds an internal optional one-shot guard
on that final object, before creating the thread or prewarming its model socket.
No public App Server RPC, config schema, scheduler or trust root is added.
Normal ungated clients keep the previous behavior. V1 refuses a nonempty managed
`auto_review.required_on_models` set, because core can mutate permissions after
choosing a model. Do not remove, empty or ignore the user's real requirement to
obtain an event; a disposable negative test preserves this boundary.

## Build preparation

All generated source/build material stays in the ignored
`.codex-effective-policy-build` directory inside Compute. No user home, auth,
platform settings, global Codex installation or OS security policy is changed.

```sh
node dependencies/codex-effective-policy/prepare.mjs
node dependencies/codex-effective-policy/prepare.mjs --check
```

The preparer fetches the exact source commit, verifies the tree, checks all
committed patch/module/license input digests, applies the small wiring patch
and copies the four source modules. It refuses a mismatched source pin,
unrelated tracked edits, unexpected untracked files and drifted prepared
sources. `source-pin.json` records all source inputs. A prepared source tree
is build material only.

Upstream pins Rust 1.95.0. Use an explicitly selected, project-scoped toolchain
and project-scoped Cargo/target caches. The release tag changes workspace
version to 0.159.0-alpha.3 while its lockfile still records 0.0.0 for 158 workspace
packages. Preparation normalizes those exact workspace-version strings only,
checks both original/normalized lockfile digests, and preserves every external
dependency version/checksum. No dependency is added or upgraded by this patch.

```sh
cargo build --locked --manifest-path .codex-effective-policy-build/source/codex-rs/Cargo.toml -p codex-exec --bin codex-exec
```

This builds the directly testable standalone exec binary. The client uses the
root CLI. Its actual root argument transport has now been built and tested on
Linux with `--kind cli`; Windows qualification remains separate:

```sh
cargo build --locked --manifest-path .codex-effective-policy-build/source/codex-rs/Cargo.toml -p codex-cli --bin codex
```

Record the resulting binary hash, target triple, compiler, original pin, source
input hashes, command and check logs in the established release/provenance
pipeline. Ship a distinguishable Compute build artifact. A successful source
build does not qualify that pipeline, signature, protected home or Windows OS
sandbox. Never replace a production CLI from this recipe alone.

## No-model verification

Run the Rust tests through upstream's just/nextest entrypoint:

```sh
cd .codex-effective-policy-build/source
just test -p codex-app-server --lib metaengine_effective_policy
just test -p codex-exec -p codex-app-server-client
```

From Compute, exercise the physical fresh binary with an open empty stdin,
a disposable home and a local HTTP/WebSocket recorder:

```sh
node dependencies/codex-effective-policy/test/no-model-probe.mjs --binary /absolute/path/to/codex-exec --kind exec
```

Use `--kind cli` for the actual built root CLI. The eight-case no-model probe
sends no valid execution acceptance. It verifies inspect exits before thread
creation and rejects wrong nonce/context, unknown ACK fields, EOF before ACK,
invalid nonce, and remote or disabled execution environments. It observes zero
model endpoint/prewarm requests. Raw stdout/stderr remain in a private disposable
evidence directory; only bounded sanitized summaries are printed.

On an unpatched 0.159.0-alpha.3 CLI the first scenario fails because
`--metaengine-effective-policy` is unsupported. The same test must pass on the
built overlay; do not substitute a source regex assertion for this behavior.
`root-bootstrap-probe.mjs` and `root-prompt-transport-probe.mjs` additionally
exercise the real root path with disposable homes and authorized loopback mocks:
original SHA/nonce/deadlines, dotenv effects, duplicate-ACK red-to-green and
cancellation. They make no external model/API call; accepted-path requests use
the loopback mock only. Model inference/prewarm traffic before ACK is forbidden.
Native Windows binary/custody qualification remains separate.

## Digest-gated activation

Execute mode requires the original task's SHA256 in the immutable,
native-attested argv. The following is one shell-free argv list; the approved
argument groups come from the existing native owner:

```js
const args = [
  '--no-daemon', ...approvedRootArgv,
  'exec', '--json', '--color', 'never', '--ignore-user-config',
  ...approvedExecArgv,
  '--metaengine-effective-policy', nonce,
  '--metaengine-prompt-sha256', originalPromptSha256,
  '-',
];
```

Set child `CODEX_HOME` explicitly to the owned protected absolute home. Resume
with stdin open and empty. After the one policy event is validated against the
same owned process, send one ACK line, the exact original nonempty UTF-8 task
bytes (at most 32,000), and EOF. Both ACK and task digest qualify before thread
creation/prewarm. The v1 event and three-key ACK remain unchanged; neither
contains the prompt digest or a numeric sequence field.

Hash only the original task bytes from the existing protected launch/receipt.
Do not hash ACK+task, retransmit ACK, add a newline or normalize task bytes. EOF
after valid ACK and a complete correctly hashed task activates execution.
Cancellation or uncertain delivery must terminate/fence the owned job first,
then close its pipes and reconcile possible effects. Dropping the stdin writer
alone is not a cancellation guarantee. The original native deadline includes
bootstrap, ACK and task/EOF waits; it must not restart after admission.

`--metaengine-policy-only` inspects without reading task bytes or requiring the
prompt digest. Qualified `.env`/PATH bootstrap and environment/home custody
remain native-owner responsibilities. Do not weaken genuine model, sandbox,
approval or rule requirements to make a probe pass. The baseline Windows
`resume(prompt)` helper reviewed here writes task data and closes stdin; the
separate transport owner must supply the staged handshake inside the existing
owned job.
Do not change `launchIdentity.prompt_sha256` to cover framing.

The actual v3 consumer/native join remains pending. At this verification point,
the parent-designated v3 checkpoint
`46cea51a3060588525ac9cc98dd751c081e2ef97` is unavailable as an object/ref in this
checkout; its exact fetch reported `upload-pack: not our ref`. The Linux fixtures
do not complete that integration.
The original `7dbeed76` verification, patch and contract are retained under
`evidence/7dbeed76`.

## License and compatibility

Upstream is Apache 2.0; original [LICENSE](LICENSE) and [NOTICE](NOTICE) are
retained, including Ratatui/MIT attribution. The overlay carries modification
notices. This is source-license compatibility bookkeeping, not a claim that a
new binary's complete third-party distribution has been reviewed. Preserve the
existing dependency notices and binary provenance requirements when packaging.
The private flags/event require the pinned consumer update; stock upstream
clients do not implement this contract. GLM is not part of this dependency.
