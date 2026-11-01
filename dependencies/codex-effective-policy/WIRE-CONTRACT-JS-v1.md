# JS consumer wire contract: digest-gated Compute producer v1

Normative keysets below are checked against the current Rust producer and pinned
upstream types. This updates the preserved `7dbeed76` supplement without changing
it. Upstream: OpenAI Codex `rust-v0.159.0-alpha.3`, commit
`3b01b36fa5eb96ba82a776bd3c2fc57f8969181f`, tree
`d22150f47f6f6d6b1332583987e862981c951388`. Current patch/input and binary pins are
in `source-pin.json` and `VERIFICATION.json`; the upstream pin alone does not
identify our patch. Distribution identity: **pinned upstream + reviewed Compute
patch**, without an unchanged vendor-signed CLI claim.

## Invocation and ordering

Set child `CODEX_HOME` explicitly to the owned protected absolute home. The root
CLI receives one shell-free argv list, with the native owner's frozen approved
argument groups:

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

Execute requires `originalPromptSha256`: 64 lowercase hex characters hashing
only the exact original UTF-8 task bytes from the existing protected
launch/receipt. Bind it in native-attested immutable argv before launch. Do not
hash ACK+task, recompute it from received framing, append LF or normalize bytes.
Standalone `codex-exec` receives the exec options directly, without `exec` or
`--no-daemon`. Use genuine approved model/sandbox/approval/rule settings;
`--ignore-rules` is not a mandatory production override.

1. Resume the owned attested process with stdin open and empty. The final
   project-trust reload resolves Config.
2. Before thread creation/prewarm, producer flushes one policy JSONL record,
   at most 65,536 UTF-8 bytes excluding LF.
3. Host validates the record, original pins/generations and independent native
   custody/authorization/deadline. It sends one ACK, then only the original
   nonempty UTF-8 task bytes (at most 32,000) and EOF.
4. Before thread creation/prewarm, guard verifies ACK, then exact task SHA256,
   UTF-8 and nonempty content. No BOM stripping, trimming or newline conversion
   changes task data. Exec takes the validated string once, with no second
   stdin read. Do not wait for `thread.started` before sending task/EOF.

Inspect adds `--metaengine-policy-only`, needs no prompt digest, emits mode
`inspect`, then exits 0 before thread creation without reading stdin. Send no
ACK/task. An inspect record cannot admit any other process.

## Closed envelope and projection keysets

The schematic envelope elides the object bodies; empty objects do not constitute
valid policy evidence:

```json
{"type":"metaengine.effective_policy.v1","nonce":"HOST_64_LOWERCASE_HEX","context_id":"UUIDv7","mode":"execute","strict_config":false,"thread_start_overrides":{},"policy":{}}
```

Exactly these seven envelope keys are present: `type, nonce, context_id, mode,
strict_config, thread_start_overrides, policy`. `mode` is `execute`/`inspect`;
`strict_config` is boolean. Each fixed object below has exactly the listed keys;
values may be null where declared. Reject unknown/missing keys and unsupported
values; do not coerce or silently lose integer precision. Dynamic maps and
upstream optional members are identified separately.

```text
thread_start_overrides:
  scope = TYPED_THREAD_START_OVERRIDES
  approval_policy, approvals_reviewer, sandbox_mode, permission_profile
  default_permissions, persisted_permission_profile_id
  cwd, workspace_roots, additional_writable_roots

policy:
  schema = metaengine.codex.effective-policy.v1
  upstream_commit = 3b01b36fa5eb96ba82a776bd3c2fc57f8969181f
  stage = THREAD_START_RESOLVED_BEFORE_SPAWN
  cwd, load_mode, effective, requirements, layers, origins, origins_scope

load_mode:
  ignore_user_config, ignore_project_config
  ignore_managed_requirements, ignore_login_requirements
  ignore_user_and_project_exec_policy_rules
  user_config_profile, user_config_path_override

effective:
  permission_profile, active_permission_profile
  explicit_permission_profile_mode, approval_policy, approvals_reviewer
  allow_login_shell, workspace_roots, permission_workspace_roots
  profile_workspace_roots
  windows: {configured_mode, configured_backend, effective_local_backend}

requirements:
  values, sources, source_scope = NORMALIZED_CONSTRAINT, generation

requirements.values AND requirements.sources (same literal JSON keys):
  allowed_approval_policies, allowed_approvals_reviewers
  allowed_sandbox_modes, allowed_permission_profiles, default_permissions
  allow_login_shell, windows.allowed_sandbox_implementations
  permission_profile, permissions.filesystem, experimental_network

experimental_network (null or this selected object):
  enabled, http_port, socks_port, allow_upstream_proxy
  dangerously_allow_non_loopback_proxy, dangerously_allow_all_unix_sockets
  domains, managed_allowed_domains_only, unix_sockets, allow_local_binding

permissions.filesystem (null or this selected object):
  deny_read

layers[]:
  name, source: {kind, identity_generation}, version
  enabled, loader_ignored, content_scope

origins[path]:
  name, source: {kind, identity_generation}, version
```

`requirements.values` and `.sources` each contain the same ten keys above. Dots
in `windows.allowed_sandbox_implementations` and `permissions.filesystem` are
literal key characters; `effective.windows` is a nested object.

- `layers[].source` and `origins[path].source`: exactly `kind,identity_generation`.
  Layer `name`/source `kind`: `packaged_defaults, mdm, system, enterprise_managed,
  user, project, session_flags, legacy_managed_file, legacy_managed_mdm`.
  Generations are `sha256:` plus 64 lowercase hex.
- Each requirement source is null, `{kind:"unknown"}`,
  `{kind:"legacy_managed_mdm"}`, `{kind,identity_generation}` for `mdm,
  enterprise_managed, system_requirements, legacy_managed_file`, or recursive
  `{kind:"composite",sources:[source,...]}`. No source paths/raw config or
  arbitrary disabled reasons are emitted.
- `content_scope`: `IGNORED_EMPTY_PLACEHOLDER` for loader-ignored User metadata,
  `RESOLVED_LAYER_CONTENT` otherwise. An ignored User layer may remain enabled;
  require `loader_ignored:true` and the placeholder scope. Its version hashes
  the empty placeholder, not ignored file bytes.
- `load_mode` ignore flags and `user_config_path_override` are booleans;
  `user_config_profile` is null or the literal `selected`.
- `cwd`, `workspace_roots` and `permission_workspace_roots` use upstream absolute
  path strings. `profile_workspace_roots` uses URI strings; do not flatten the
  three root scopes or reinterpret paths for a different OS.

## Closed inherited value shapes

These serializers come from the pinned upstream, reused by `effective`, typed
`thread_start_overrides` and `requirements.values.permission_profile` as
applicable. `?` below means omitted when absent, not an extra arbitrary member.

```text
Approval = "untrusted" | "on-request" | "never" |
  {granular:{sandbox_approval:bool, rules:bool, skill_approval:bool,
             request_permissions:bool, mcp_elicitations:bool}}
Reviewer = "user" | "auto_review"
SandboxMode = "read-only" | "workspace-write" | "danger-full-access"
PermissionProfile = {type:"managed", file_system:FileSystem, network:Network} |
  {type:"disabled"} | {type:"external", network:Network}
Network = "restricted" | "enabled"
FileSystem = {type:"restricted", entries:Entry[], glob_scan_max_depth?:positive_integer} |
  {type:"unrestricted"}
Entry = {path:Path, access:"read"|"write"|"deny", missing_path_behavior?:"skip"}
Path = {type:"path", path:string} | {type:"glob_pattern", pattern:string} |
  {type:"special", value:Special}
Special = {kind:"root"|"minimal"|"tmpdir"|"slash_tmp"} |
  {kind:"project_roots", subpath?:string} | {kind:"unknown", path:string, subpath?:string}
ActiveProfile = null | {id:string, extends?:string}
WindowsMode = null | "elevated" | "unelevated" | "mxc"
Backend = "none" | "macosSeatbelt" | "linuxSeccomp" |
  "windowsRestrictedToken" | "windowsMxc"
```

Typed thread-start override values are null when absent; its path roots are
arrays, and `default_permissions`/`persisted_permission_profile_id` are null or
strings. `effective.explicit_permission_profile_mode`/`allow_login_shell` are
booleans. `effective.active_permission_profile` uses ActiveProfile.
`effective.windows` uses WindowsMode and Backend. Linux output does not qualify
a Windows backend. Input aliases such as `on-failure`/`guardian_subagent` are not
emitted enum values. Known `unknown` source/path representations may be refused
by the Host; recognizing their shape grants no permission.

`requirements.values` types (null is preserved):

```text
allowed_approval_policies: null | Approval[]
allowed_approvals_reviewers: null | Reviewer[]
allowed_sandbox_modes: null | (SandboxMode | "external-sandbox")[]
allowed_permission_profiles: null | map<string,bool>
default_permissions: null | string
allow_login_shell: null | bool
windows.allowed_sandbox_implementations: null | ("elevated"|"unelevated")[]
permission_profile: null | PermissionProfile
permissions.filesystem: null | {deny_read:string[]}
experimental_network: null | the eleven-key object listed above
```

In `experimental_network`, `http_port`/`socks_port` are null or u16 integers;
`domains`/`unix_sockets` are null or flat `map<string,"allow"|"deny">` objects,
without an `entries` wrapper. Other members are null or booleans. Header
injections, provider/auth definitions, account IDs and instructions are excluded.

`origins` is a dynamic map keyed by opaque upstream flattened origin strings,
not executable rules. Its scope is exactly
`CONFIG_LAYER_MERGE_EXCLUDING_REQUIREMENTS_AND_HARNESS_OVERRIDES`.
Requirement source scope is `NORMALIZED_CONSTRAINT`, not exact raw-field
provenance. `requirements.generation` is SHA256 of compact UTF-8 canonical JSON
containing exactly `{values,sources}`: recursively sort object keys by UTF-8 byte
order and preserve array order. It does not fingerprint all hidden config bytes.
Layer versions retain upstream canonical-TOML hashes. Origins are limited to
permission-related paths selected in the Rust projection; they exclude managed
requirement paths and do not override the effective constrained values.

## Bindings and ACK

Host nonce is fresh 32 random bytes encoded as 64 lowercase hex for this launch.
`context_id` is producer-generated UUIDv7. There is no numeric sequence/revision
field, prompt digest, signature, PID/job/task/lease/role or environment proof in
the event/ACK. Host privately binds the exact raw event bytes/hash and
nonce/context to its same owned native handle, process incarnation/job, actual
image and argv (including original task SHA256), environment/home evidence,
task/lease/role and original absolute deadline.

ACK is one UTF-8 JSON line, at most 512 bytes including LF:

```json
{"type":"metaengine.effective_policy.accept.v1","nonce":"HOST_64_LOWERCASE_HEX","context_id":"UUIDv7"}
```

Exactly three required keys: `type, nonce, context_id`; values must match the
type above and emitted nonce/context. No sequence, `verified` or native-proof
members. Internal shared state is one-shot: `0->1` before projection, inspect
`->2` after flush, execute `->3` only after ACK and complete task validation;
errors leave the guard used. These internal numbers are not wire fields.

## Refusal, reread and cancellation

Producer refuses invalid nonce/digest or missing execute digest; incompatible
modes/flags; remote/disabled environment; ACK type/nonce/context mismatch,
unknown/duplicate keys, malformed JSON, oversized ACK or EOF before completion;
task >32,000 bytes, wrong SHA256, invalid UTF-8 or empty/whitespace-only task;
guard reuse; >128 layers, >1024 origins, >64 KiB event/projection; or inconsistent
nonempty ignored User metadata. It also refuses a **nonempty** real managed
`auto_review.required_on_models` set before emission. Preserve that policy: do
not remove, empty, ignore it or select a weaker model/config to obtain an event.
Supporting it requires a later post-model-selection producer boundary.

Host refuses missing/duplicate/malformed events, premature thread/turn records,
wrong schema/source/binary pins, unsafe/unsupported policy, generation mismatch,
custody loss, expiry or uncertain transport. It may assemble chunks of the same
bounded record from the same owned pipe or revalidate captured bytes; a second
`config/read`, another inspect process, sidecar JSON or restarted guard cannot
replace that evidence.

Send ACK once, then only the original task and EOF. A retransmitted ACK becomes
extra task data and fails the original digest; never change that digest to cover
framing. EOF after a valid complete task is activation, not cancellation. On
cancellation/uncertain delivery, terminate/fence the owned job **first**, close
pipes, retain original receipts and reconcile possible effects. Dropping a Tokio
stdin reader/writer alone does not terminate the process. No automatic retry,
new lease, reset or transfer follows from a failed/uncertain exchange.

The existing native controller's original absolute deadline includes bootstrap,
ACK and task/EOF waits; it never restarts at ACK. The guard supplies no separate
wall-clock timeout. Native custody/protected configuration must remain valid
through admission. Root arg0 may load non-CODEX variables from `.env` and prepend
helper PATH entries before flag parsing: explicit protected `CODEX_HOME`, refusal
of unapproved `.env`, or independently qualified resulting environment/helper
paths remain native-owner responsibilities. This packet supplies no native,
authentication/model/account, OS-sandbox or useful-work attestation.

## Physical evidence and pending join

Current digest-gated root `codex --no-daemon exec` is self-built Linux,
`x86_64-unknown-linux-gnu`, Rust 1.95.0, dev/debug=0:
`be8e0db3ad73bd0ff96150959565eb527f236564e77376997a928d433c9bd8e4`.
Its eight physical no-model cases passed with zero HTTP/WebSocket/model
requests; JS reproduced the projected requirements generation. Separate root
bootstrap (5) and prompt-transport (10) probes use disposable homes and loopback
mocks only. Source/image binding and exact check scopes are in `VERIFICATION.json`.

The original `7dbeed76` standalone exec image
`5bb78cd7ae0d2c451452ad9757fad3797352090b7e02d851049ce42e2f1deb02`
and original root baseline
`f0980f72638a4c581299865d6f61c9114127359d2b742b5069cb1a4903cf13da`
have their own earlier receipts; do not attribute the digest gate to those images.
The original supplement remains unchanged at
`.codex-effective-policy-build/evidence-7dbeed76/WIRE-CONTRACT-JS-v1.md`.

At the first published producer checkpoint, fetching transport object
`46cea51a3060588525ac9cc98dd751c081e2ef97` reported `upload-pack: not our ref`.
Its published source is now reviewed at
`6145546e00ab81139e4a7698c8d45863e580efba`. The actual JS controller and patched
root have a passing Linux protocol join; the test helper is explicitly synthetic
and emits no native terminal or joined settlement. See
[JOIN-CONTRACT.md](JOIN-CONTRACT.md) and current [VERIFICATION.json](VERIFICATION.json).
Production consumer admission/bootstrap wiring, native Windows custody,
release provenance/signing and installation remain pending. Do not pass ACK+task
to the old helper or alter `launchIdentity.prompt_sha256`. The staged owner must
preserve the original digest/nonce/deadline and reconcile possible effects when
an in-flight prompt EOF races cancellation. Linux protocol evidence cannot
qualify the actual Windows helper or private consumer admission.
