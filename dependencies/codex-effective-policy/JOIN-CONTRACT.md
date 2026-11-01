# Producer, transport and consumer join handoff v1

This versioned handoff documents existing interfaces; it adds no wire schema,
authority, scheduler or trust root. Source review establishes protocol
compatibility subject to the caller obligations below. Full private consumer
admission and native Windows end-to-end qualification remain pending.
[WIRE-CONTRACT-JS-v1.md](WIRE-CONTRACT-JS-v1.md) remains the normative closed
producer event/ACK keyset; [CONTRACT.md](CONTRACT.md) defines activation.

## Exact source and image pins

| Component | Reviewed checkpoint | Tree |
| --- | --- | --- |
| Compute producer, published source checkpoint | `74f0568ec6c3e7e6e6d005413157386986dcdccc` | `299ac4c71c6e31495bf974e138aded4ea277ff16` |
| Transport, `work/effective-policy-transport-20261101` | `6145546e00ab81139e4a7698c8d45863e580efba` | `8e81f6ae5925b273232ef792b4739c73aa56433b` |
| Consumer/probe owner | `22841fced59dbd9439477eb68a258d6e65c50502` | `8a33a2455148d055ab74c54929d35c5280127100` |
| OpenAI Codex `rust-v0.159.0-alpha.3` | `3b01b36fa5eb96ba82a776bd3c2fc57f8969181f` | `d22150f47f6f6d6b1332583987e862981c951388` |

Producer source-input manifest SHA256 is
`5a969fb681c8ffe844940aece03c3bc5f2e7d2b8733fe46f6713b735b821bb37`;
the wiring patch SHA256 is
`068c1e3e8eccef9c29713213e51fa51b638e85e99713c676d805a445229a656c`.
The physically tested Linux root CLI image SHA256 is
`be8e0db3ad73bd0ff96150959565eb527f236564e77376997a928d433c9bd8e4`.
Pin the reviewed Compute overlay and actual image as well as upstream. The
distribution is **pinned upstream + reviewed Compute patch**, without an
unchanged vendor-signed CLI claim. Documentation/test follow-ups may have a
different Compute commit; current [VERIFICATION.json](VERIFICATION.json) binds
their source inputs, image and receipts.

At the published producer checkpoint, fetching the earlier transport object
`46cea51a3060588525ac9cc98dd751c081e2ef97` failed with `upload-pack: not our ref`.
That source-availability blocker is historical: the published transport and
consumer checkpoints above are now available and reviewed. Discovery of those
sources does not complete their runtime join.

## Ownership and implemented interfaces

| Owner | Supplies | Does not establish |
| --- | --- | --- |
| Rust producer | Final resolved `Config` projection from the same fresh exec context; one event; ACK and original-task digest barrier before thread creation/prewarm | Native process/environment custody, lease/task authority, Windows sandbox behavior, model/account routing or release provenance |
| Transport controller/helper | Request-bound phased stdin, output correlation, suspended native process/Job observations and joined cleanup interface | Full policy/schema admission or consistency of producer flags inside argv |
| Private JS consumer/runner | Must validate raw event and independent custody, scope and authorization before committing one ACK/task | This admission is not implemented at the pinned consumer checkpoint |
| Existing native custody/release owners | Must qualify actual image/argv, protected home/environment, Job lifetime, Windows sandbox and release artifacts | Producer event or Linux fixtures cannot substitute for these observations |

Transport sources beneath `apps/metaengine-browser` are
`src/codex-cli-physical-settlement.mjs`,
`src/codex-cli-windows-process-controller.mjs` and
`scripts/codex-cli-job-runner.ps1`.
The transport manifest protocol is `REQUEST_BOUND_POLICY_STDIO_V3`; phased
launch schema is `metaengine.codex-cli.launch.v3`. Native terminal and joined
settlement retain `metaengine.codex-cli.native-terminal.v2` and
`metaengine.codex-cli.joined-settlement.v1`. Legacy launch v2 remains a separate
`resume(prompt)` path and cannot call `bootstrap`; phased launch cannot resume.

The producer event remains `metaengine.effective_policy.v1`; ACK remains
`metaengine.effective_policy.accept.v1` with exactly `type`, `nonce` and
`context_id`, at most 512 bytes including LF. Neither carries a numeric
sequence or prompt hash. Preserve separate native/request/task bindings; do
not add fields to the closed event or ACK to repair a join.

## Required caller sequence

1. Retain the prepared attempt, original nonempty UTF-8 task bytes, protected
   receipt's `prompt_sha256`, authorization and original absolute execution
   deadline. Keep the existing runner's nonempty/32,000-byte guard before
   admission. Do not append LF, trim, normalize or hash framing with the task.
2. Freeze one approved shell-free root argv containing `--no-daemon`, fresh
   `exec --json --ignore-user-config`, approved policy/model/output arguments,
   `--metaengine-effective-policy NONCE`,
   `--metaengine-prompt-sha256 ORIGINAL_PROMPT_SHA256`, and stdin `-`. NONCE is
   fresh 64-character lowercase hex. The digest flag must equal the original
   protected receipt hash. Reject absent, duplicate or conflicting bindings;
   the generic transport does not enforce this argv relationship.
3. Before creating `launch`, set `spec.inputProtocol` to
   `EFFECTIVE_POLICY_ACK_V1`, `spec.policyNonce` to that nonce,
   `spec.promptSha256` to the original task digest and `spec.deadlineAt` to the
   original absolute deadline. Seal these with exact argv, image, cwd, timeout,
   run and existing binding. They are inside the launch request hash. The
   five-field launch identity retains `request_id`, `request_sha256`, `run_id`,
   `binding_sha256`, `prompt_sha256`; its request hash indirectly binds the
   phase mode and nonce. No later digest substitution is permitted.
4. Spawn through the existing owned controller and verify suspended process,
   image/argv, protected home/environment, Job and current authorization. Call
   `handle.bootstrap({deadlineAt: originalAbsoluteDeadline})` with stdin empty
   and open. Supplying the original deadline in both sealed spec and bootstrap
   is required; do not replace it with a fresh `now + timeout` deadline.
5. Receive one original bounded UTF-8 policy record, excluding its LF. Validate
   the complete closed contract, including duplicate/unknown keys, source pins,
   mode/backend, requirements, layer generations and origins against required
   task scope. Recheck the same process/config/home custody, live lease/role,
   deadline and cancellation fence before committing admission. Persist the
   original record and independent bindings privately. Controller checks only
   type/nonce/UUIDv7 context; that correlation is not policy admission.
6. Only after successful private admission, call
   `handle.acceptPolicy(ackBytes, originalPrompt)` once. Controller canonicalizes
   the three-key ACK. Helper writes/flushes it and emits bound
   `policy_ack_written`; only then does controller send one `PROMPT` command.
   Helper checks original prompt SHA again, writes exact bytes and closes child
   stdin. `acceptPolicy` waits for `prompt_written`, which follows that close.
   ACK notification confirms a pipe write, not producer acceptance. Retain the
   existing 32,000-byte task bound although generic transport permits 65,536.
7. Join ordinary JSONL/result handling and the original helper's close through
   existing physical settlement, lease readback and reconciliation. Reserved
   policy records never enter ordinary task output. Do not retransmit input or
   infer delivery/cleanup from a controller write callback or model result.

Use explicit owned protected absolute `CODEX_HOME`. Root arg0 can load its
`.env` before parsing exec flags and prepend helper aliases to PATH. Refuse an
unapproved `.env` without reading secret contents, or independently qualify the
resulting environment/helper paths. Initial environment readback and the
producer packet do not establish post-bootstrap environment custody. Nonempty
`auto_review.required_on_models` remains unsupported and must refuse; never
remove, empty or ignore actual user/managed policy to pass admission.

## Deadline, EOF and cancellation limits

Once BOOTSTRAP starts, native deadline is the minimum of its timeout bound,
BOOTSTRAP absolute deadline and sealed original deadline. It remains fixed
through policy wait, ACK and task/EOF. The controller fallback allows a bounded
cleanup join; it is not permission to extend worker execution. Without a sealed
deadline, generic `resumeDeadline` can use `now + timeout`; production callers
must not rely on that fallback.

The initial suspended helper control read has no running native watchdog.
Controller startup timeout ends when ready proof arrives; running execution
timer begins at bootstrap. The existing owner must bound authorization and
suspended lifetime, cancel expired attempts and refuse bootstrap after expiry.
This source does not prove a native pre-bootstrap deadline guarantee.

EOF after valid ACK and all correctly hashed task bytes activates execution.
Cancel through the owned Job and await original completion; closing stdin alone
is not cancellation. JS termination synchronously fences further phase calls.
Native cleanup kills the Job before explicitly completing/draining its writer,
but the writer independently closes stdin after finishing an in-flight prompt.
That natural EOF can occur between watchdog CANCEL recognition and Job
termination. Do not claim unconditional kill-before-EOF or zero cancellation
effects. Preserve possible activation/effects and uncertain delivery until
physical settlement and reconciliation. Pending ACK/prompt uncertainty cannot
produce a successful joined settlement or authorize replay.

## Current admission and verification limits

At consumer `22841fce`, `codex-cli-runner.mjs` still builds argv without the two
producer flags, seals a legacy spec without phase mode/nonce, and calls
`handle.resume()`. `codex-cli-execution-policy.mjs` still returns
`configuration_attestation:'UNAVAILABLE'`;
`native-coding-host-observers.mjs` refuses configuration equivalence on that
value. Full raw-event validation, phased authorization/ACK commitment, protected
environment qualification and consumer settlement integration remain pending.

Transport source/controller tests on Linux passed 70 cases; four Windows
physical cases were skipped. A joint actual-controller/patched-root Linux
protocol probe is recorded, when completed, in current
[VERIFICATION.json](VERIFICATION.json), with exact tool/source/image hashes and
its test-only bridge scope. Neither that receipt nor synthetic-worker fixtures
qualify the full private consumer admission, Windows helper execution, native
custody or general OS egress. Linux cannot establish Windows Job assignment,
inherited handles, pipe/cancellation races, environment/ACL custody, descendant
termination/accounting, drain and handle-close receipts.

The tested Linux root is a 604,210,216-byte development artifact. Consumer
physical capture permits at most 512 MiB (536,870,912 bytes), so this image fails
that inventory bound. Keep the bound; do not strip or widen it merely to pass a
fixture. A proper release image needs its own build/source/image provenance,
size and Windows binary/signing qualification before installation.
