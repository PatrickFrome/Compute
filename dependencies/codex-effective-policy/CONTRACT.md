# METAENGINE Codex effective policy v1

This is a private CLI integration for Compute with Linux source and root CLI
checks. Actual native v3 integration and Windows qualification remain pending.
The distribution identity is **pinned upstream + reviewed Compute patch**, not
an unchanged vendor-signed CLI. The upstream source pin is OpenAI
Codex `rust-v0.159.0-alpha.3`, commit
`3b01b36fa5eb96ba82a776bd3c2fc57f8969181f`, tree
`d22150f47f6f6d6b1332583987e862981c951388`.

[WIRE-CONTRACT-JS-v1.md](WIRE-CONTRACT-JS-v1.md) is the normative closed keyset
and inherited-value reference for JS consumers. This document describes the
activation and custody lifecycle. [JOIN-CONTRACT.md](JOIN-CONTRACT.md) pins the
separate transport/consumer interfaces and records their remaining join gaps.

## Producer and consumer ownership

The Rust producer runs in the exact fresh `codex exec` process. It observes the
last resolved `Config` after the App Server's project-trust reload and before
`StartThreadOptions::new(config)` and `ThreadManager.start_thread`. The same
object moves into the existing thread start path. There is no second config
read and no runtime policy sidecar. A gated exec also omits startup-derived
cwd/approval/effort overrides from its initial `turn/start`, retaining this
thread's resolved configuration.

The JS probe/runner owner consumes the event from the native-owned process
pipe. It checks policy against the Host's required task scope, then writes an
acceptance frame. It must not treat the producer as native process, environment,
filesystem ACL, sandbox canary, executable provenance, lease or task authority.
The existing native custody owner supplies those observations independently.
An inspect result from one process never admits a different process.

Native environment custody must account for root arg0 bootstrap: it reads
`$CODEX_HOME/.env` before exec parses flags (filtering `CODEX_` names), then may
prepend helper aliases to PATH. `--ignore-user-config` does not disable that
bootstrap. The Host must refuse an unapproved `.env` file without reading its
secret contents, or independently qualify the resulting environment and helper
paths before acceptance. This policy event supplies no environment attestation.
Model/account routing and actual model-version evidence remain the existing
separate policy gates.

## Invocation and wire order

Keep the existing native-owned absolute executable, pinned binary hash,
protected home/environment, suspended process/job proof and absolute deadline.
Add `--metaengine-effective-policy NONCE` to the fresh `exec --json
--ignore-user-config` invocation; NONCE is 64 lowercase hex characters sampled
by the Host for this launch. Use `--no-daemon` on the root CLI.
Execute additionally requires `--metaengine-prompt-sha256 ORIGINAL_PROMPT_SHA256`
in the immutable, native-attested argv. It is 64 lowercase hex characters: the
SHA256 of the original UTF-8 task bytes from the existing protected launch/receipt,
never ACK bytes or ACK+task. Keep that digest fixed throughout bootstrap and
delivery. This activation tightening is additional to `7dbeed76`; the v1
event/ACK keysets remain unchanged. This private mode
rejects resume, fork, review, `--worktree`, `--oss`, images, positional task text
or remote/disabled execution environments and configurations without
`--ignore-user-config`. The environment provider snapshot is prepared once and
must resolve to the enabled local backend. Supply the task through
stdin `-`. `--ignore-rules` is separately exposed in `load_mode`; ignoring user
config does not imply ignoring project config or execpolicy rules.

1. Resume the already attested native process with stdin open and **no task
   bytes**. Its final thread config is resolved before reading the task.
2. The producer writes and flushes one JSONL event of at most 65,536 bytes
   excluding newline:

   ```json
   {"type":"metaengine.effective_policy.v1","nonce":"HOST_NONCE","context_id":"PRODUCER_UUID","mode":"execute","strict_config":false,"thread_start_overrides":{},"policy":{}}
   ```

   The closed envelope keyset is exactly `type, nonce, context_id, mode,
   strict_config, thread_start_overrides, policy`. `context_id` is a
   producer-generated UUIDv7. There is no numeric sequence/revision,
   `prompt_sha256`, PID/job, task/lease or authority field on this wire. The Host
   enforces the one-event/one-ACK sequence and retains those native/task bindings
   separately; the guard's internal one-shot state is not a serialized sequence.

3. The Host validates the complete bounded event and all independent custody
   evidence. It must reject missing/duplicate events, unknown contract/source
   pins, unsafe policy, generation mismatch, lost custody and expired deadlines.
   Hash and persist the exact original event bytes privately with the native
   process incarnation/launch, nonce, task/lease/role and original receipts.
   `context_id` is correlation, not a signature or a new trust root.
4. Only on success, write exactly one newline-terminated frame (at most 512
   bytes including newline), followed by the original task bytes and EOF:

   ```json
   {"type":"metaengine.effective_policy.accept.v1","nonce":"HOST_NONCE","context_id":"PRODUCER_UUID"}
   ```

   All three fields are required; unknown fields, duplicate keys, wrong nonce,
   stale context, malformed JSON, oversized frames and EOF before ACK completion
   are refused. After the one ACK, the guard reads the remaining task bytes to
   EOF, at most 32,000 bytes, verifies the original argv SHA256 before decoding,
   then requires valid nonempty UTF-8. It does not strip BOM, normalize newlines
   or trim the task. The exact admitted string is transferred to exec once,
   without a second stdin read. Thread creation/prewarm is blocked until both
   ACK and complete task validation succeed. A second ACK or altered/additional
   task byte changes the original digest and is refused before thread startup.

   EOF after valid ACK and a complete correctly hashed task is normal activation,
   not cancellation. Cancellation/uncertain delivery must terminate/fence the
   owned native job FIRST, then close its pipes and preserve physical settlement
   and reconciliation state. Never retransmit ACK, restart a guard or reset a
   lease after uncertain delivery. New work requires the existing authorization
   and reconciliation rules, not an automatic retry. Dropping a Tokio stdin
   reader/writer is not a process termination guarantee. If all task bytes may
   already have arrived, record possible effects even when cancellation races
   with EOF or native termination.

The existing native controller owns the absolute handshake/execution deadline.
It includes bootstrap, ACK and complete task/EOF waits and cannot be extended or
restarted after ACK. The guard has no separate timeout that replaces it.
The producer's frame-size limit does not replace that native lifetime bound.
No prompt may be sent while awaiting policy admission. After the one ACK, send
only the original UTF-8 task bytes and EOF; do not wait for `thread.started`,
which cannot occur before the task digest qualifies. No model/prewarm occurs
before ACK, or while a complete task is held without EOF. After full validation,
normal JSONL thread/turn/result events follow. Consumers must handle the policy
event before passing subsequent events to the normal exec JSONL decoder. No
model-supplied result can fabricate this pre-thread event through the admitted
stdout pipe.

Read partial chunks only from that same owned pipe until the bounded event's
newline. Do not repair missing or mismatched evidence with a second
`config/read`, another process's inspect event, a repeated ACK or a new guard.
Preserve the original event/receipt for reconciliation. Keep native custody and
protected configuration valid through complete task admission; a lost binding
requires cancellation through the existing owned job.

For inspection use the same args plus `--metaengine-policy-only`. Mode becomes
`inspect`; after the flushed event, exec exits successfully before thread
creation and without reading stdin. It does not require
`--metaengine-prompt-sha256`. Never send an
acceptance or task in inspect mode.
This tests resolution/gate ordering without a model request. Cloud/bootstrap
configuration and model metadata loading may precede the barrier, so this is
not a claim of zero network traffic or authentication-free startup.

## Policy shape and precise provenance scopes

`policy.schema` is `metaengine.codex.effective-policy.v1`; `stage` is
`THREAD_START_RESOLVED_BEFORE_SPAWN`; `upstream_commit` is the exact pin above.
All field names in the Rust JSON projection are normative for v1. The consumer
must reject unsupported schema/pins rather than reinterpret a newer CLI.

- `cwd` and `load_mode` describe the actual final config's loader flags.
  `strict_config` is the actual strict loader flag on the envelope.
- `effective` contains the materialized permission profile, selected active
  profile, legacy/named-profile mode, approval/reviewer, login-shell selection,
  all three root scopes and Windows configured mode/backend versus effective
  local backend. `None`/`null` is retained; Linux output does not qualify a
  Windows backend. Paths remain private Host data.
- `thread_start_overrides` explicitly projects the typed thread-start permission
  and path overrides. CLI `-c` origins remain in `session_flags` metadata. This
  map intentionally excludes instructions, provider/auth details and shell env.
- `layers` is high-to-low precedence metadata: closed source kind, source
  identity fingerprint, original upstream content `version`, original upstream
  enabled bit, `loader_ignored` and `content_scope`. Upstream retains an empty
  enabled User layer even with `--ignore-user-config`; such metadata is marked
  `loader_ignored:true`, `content_scope:IGNORED_EMPTY_PLACEHOLDER`. Its version
  fingerprints the empty placeholder, not the ignored file. Require this scope
  and the actual load flag rather than assuming that the User layer is absent.
  Disabled layer contents/reasons are not dumped. A generation is a content
  fingerprint, never an authority claim.
- `origins` includes only permission-related layer merge origins. Its scope is
  `CONFIG_LAYER_MERGE_EXCLUDING_REQUIREMENTS_AND_HARNESS_OVERRIDES`; it must not
  be interpreted as the origin of the final constrained value.
- `requirements.values` is a strict allowlist of approval, permission, backend,
  filesystem and network policy constraints. Header injections, auth/provider
  definitions, account/workspace IDs and instructions are excluded.
  `requirements.sources` describes normalized constraint sources, explicitly
  `source_scope: NORMALIZED_CONSTRAINT`. Some upstream raw requirements share
  the normalized permission-profile source; no per-raw-field source claim is
  made. Unknown sources remain explicit and can be refused by the Host.
- `requirements.generation` is `sha256:` of canonical JSON containing exactly
  `values` and `sources`. Canonical JSON recursively sorts object keys
  lexicographically by UTF-8 bytes and preserves array order. It identifies this
  policy projection, not all hidden configuration bytes. Full layer generations
  retain their original upstream canonical-TOML fingerprints.

V1 refuses a nonempty managed `auto_review.required_on_models` set. Upstream
normalization omits an empty set; no policy is changed to obtain an event.
Upstream core can change approval reviewer and permissions after selecting the
model, beyond this hook. Refusal occurs before a policy event; this limitation
must not be converted into an admission or worked around with a separate config
read. Never remove, empty or ignore a
genuine user/managed requirement to make this path pass. Supporting the nonempty
set requires a later producer hook at the actual post-model-selection policy
boundary.

Limits fail closed: 128 layers, 1024 policy origins, 64 KiB projection/event.
Do not add `verified:true`, parse model text as evidence or admit from an
operator-edited JSON file. Native binary image/environment custody, owned
protected home/config provenance, Windows sandbox behavior and useful task
acceptance remain independent gates.

## Exact root CLI activation and current qualification

Launch the pinned patched root `codex` executable with child `CODEX_HOME` set to
the owned protected absolute home. Construct one shell-free argv vector:

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

Use the actual approved profile, including its genuine requirements/model/rule
and approval settings; do not weaken them to get an event. The approved argument
groups are frozen by the native owner before launch, and their readback must
include the original task digest. Neither the upstream commit alone nor the v1
event identifies the additional Compute patch: pin the reviewed overlay/input
manifest and the actual executable hash as well. `--ignore-rules` appears only in
our disposable fixtures, not as a mandatory production policy change. Windows
writer/critic sandbox flags and output-schema/output paths stay exactly as
approved by their existing native owner. Set CODEX_HOME explicitly; allowlist
environment values and private TEMP/TMP/TMPDIR through the existing custody
path, excluding arbitrary inherited API/Git variables. A protected home with an
unapproved `.env` must be refused, or its resulting environment and helper PATH
must be independently qualified. Initial environment readback alone does not
prove post-bootstrap environment, because root arg0 can load non-CODEX variables
and prepend helper aliases.

The legacy Windows `resume(prompt)` path writes task data and closes stdin; it
cannot carry this handshake. Do not call it with `ACK+prompt` or replace its
original `launchIdentity.prompt_sha256` with a framing hash. Published transport
`6145546e00ab81139e4a7698c8d45863e580efba` supplies a separate bootstrap -> policy
-> one ACK -> original task -> EOF API inside the existing owned job. The
consumer must wire that API with the original nonce/digest/deadline and
single-delivery invariants described in [JOIN-CONTRACT.md](JOIN-CONTRACT.md).
Producer does not supply native authority.

Root CLI has been built and physically tested on Linux. The original `7dbeed76`
root baseline, SHA256
`f0980f72638a4c581299865d6f61c9114127359d2b742b5069cb1a4903cf13da`,
passed eight no-model cases. The additional digest-gated root, SHA256
`be8e0db3ad73bd0ff96150959565eb527f236564e77376997a928d433c9bd8e4`,
was checked separately: eight no-model cases, five bootstrap cases and ten
prompt-transport cases. Its root CLI Rust selection passed 307 tests with one
skip; the App Server library passed 380 tests with no skips. These are separate
check groups; their receipts retain the exact commands and scopes.

The added hardening must have its own source overlay/input manifest and receipts;
do not attribute that binary to the old `7dbeed76` bundle. See current
`VERIFICATION.json` and the preserved `evidence/7dbeed76` record.

The source-availability failure recorded at producer checkpoint
`74f0568ec6c3e7e6e6d005413157386986dcdccc` is historical. The earlier exact fetch
of `46cea51a3060588525ac9cc98dd751c081e2ef97` reported `upload-pack: not our ref`;
published transport `6145546e00ab81139e4a7698c8d45863e580efba` and consumer
`22841fced59dbd9439477eb68a258d6e65c50502` are now available and reviewed. The
consumer still seals a legacy launch, calls `resume()` and retains
`configuration_attestation:'UNAVAILABLE'`; private policy admission and the full
consumer/native join remain pending. See [JOIN-CONTRACT.md](JOIN-CONTRACT.md)
for exact checkpoints, caller obligations, the pre-bootstrap deadline gap and
in-flight EOF/cancellation uncertainty. Any joint actual-controller/root Linux
protocol receipt belongs in current [VERIFICATION.json](VERIFICATION.json); it
does not qualify full consumer admission or Windows delivery. Windows binary,
physical native custody and release provenance/signing remain independent gates.
