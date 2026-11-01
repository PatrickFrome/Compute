# METAENGINE Codex effective policy v1

This is a proposed private CLI integration for Compute. It is not an upstream
App Server API or a qualified Windows distribution. The source pin is OpenAI
Codex `rust-v0.159.0-alpha.3`, commit
`3b01b36fa5eb96ba82a776bd3c2fc57f8969181f`, tree
`d22150f47f6f6d6b1332583987e862981c951388`.

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

Native environment custody must account for upstream arg0 bootstrap: it reads
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
by the Host for this launch. Use `--no-daemon` on the root CLI. This private mode
rejects resume, fork, review, `--worktree`, `--oss`, images, positional task text
remote/disabled execution environments and configurations without `--ignore-user-config`. The environment provider snapshot is prepared once and must resolve to the enabled local backend. Supply the task through
stdin `-`. `--ignore-rules` is separately exposed in `load_mode`; ignoring user
config does not imply ignoring project config or execpolicy rules.

1. Resume the already attested native process with stdin open and **no task
   bytes**. Its final thread config is resolved before reading the task.
2. The producer writes and flushes one JSONL event of at most 65,536 bytes
   excluding newline:

   ```json
   {"type":"metaengine.effective_policy.v1","nonce":"HOST_NONCE","context_id":"PRODUCER_UUID","mode":"execute","strict_config":false,"thread_start_overrides":{},"policy":{}}
   ```

3. The Host validates the complete bounded event and all independent custody
   evidence. It must reject missing/duplicate events, unknown contract/source
   pins, unsafe policy, generation mismatch, lost custody and expired deadlines.
   Hash and persist the exact original event bytes privately with the native
   process incarnation/launch, nonce, task/lease/role and original receipts.
   `context_id` is correlation, not a signature or a new trust root.
4. Only on success, write exactly one newline-terminated frame (at most 512
   bytes including newline), followed by the existing prompt transport:

   ```json
   {"type":"metaengine.effective_policy.accept.v1","nonce":"HOST_NONCE","context_id":"PRODUCER_UUID"}
   ```

   All three fields are required; unknown fields, duplicate keys, wrong nonce,
   stale context, malformed JSON, oversized frames and EOF are refused before
   thread creation. The producer consumes only that frame; the prompt stays in
   stdin for the established exec reader. The Host closes stdin after the
   bounded prompt as before. A rejection must close stdin/terminate the owned
   job and preserve physical settlement/reconciliation state.

The existing native controller owns the absolute handshake/execution deadline.
The producer's frame-size limit does not replace that native lifetime bound.
No prompt may be sent while awaiting admission. After acceptance, normal JSONL
thread/turn/result events follow. Consumers must handle the policy event before
passing subsequent events to the normal exec JSONL decoder. No model-supplied
result can fabricate this pre-thread event through the admitted stdout pipe.

For inspection use the same args plus `--metaengine-policy-only`. Mode becomes
`inspect`; after the flushed event, exec exits successfully before thread
creation and without reading stdin. Never send an acceptance in inspect mode.
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
  `values` and `sources`. Canonical JSON recursively sorts object keys lexicographically by UTF-8 bytes and
  preserves array order. It identifies this policy projection, not all hidden
  configuration bytes. Full layer generations retain their original upstream
  canonical-TOML fingerprints.

V1 refuses managed `auto_review.required_on_models` constraints whenever the
normalized model set is present. Upstream core can change approval reviewer and
permissions after selecting the model, beyond this hook. Refusal occurs before
a policy event; this limitation must not be converted into an admission or
worked around with a separate config read. Supporting it requires a later
producer hook at the actual post-model-selection policy boundary.

Limits fail closed: 128 layers, 1024 policy origins, 64 KiB projection/event.
Do not add `verified:true`, parse model text as evidence or admit from an
operator-edited JSON file. Native binary image/environment custody, owned
protected home/config provenance, Windows sandbox behavior and useful task
acceptance remain independent gates.
