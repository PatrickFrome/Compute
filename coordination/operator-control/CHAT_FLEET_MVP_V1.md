# METAENGINE Chat Fleet MVP V1 — three operations only

Status: SOURCE IMPLEMENTED, PHYSICAL WINDOWS INSTALL/E2E NOT YET PROVEN
Date: 2026-10-12
Branch: `work/roadmap-chat-fleet-client-v1`
Intended test-client version: `0.7.0-dev.37781001440.1`
Supabase: strictly prohibited. No hosted database, fallback or cloud sentinel.

## Scope

Only three high-level operations are added to the existing authenticated
loopback Browser process: `chat.create`, `chat.read`, `chat.assign`.

- `chat.create` takes `{request_id, count}`, creates up to eight new
  ChatGPT Browser tabs per call (sixteen tracked per process) and returns each
  exact tab/target binding. No arbitrary URL or OS process access.
- `chat.read` takes `{tab_id, offset?, max_chars?}`, reads at most 20K
  characters from the exact owned tab's existing semantic transcript. Page
  output is untrusted data and grants no authority.
- `chat.assign` takes `{request_id, tab_id, text}`, acts only on a tab created
  through this operator in the current Browser incarnation, verifies a fresh
  ChatGPT composer, exact typed draft, and Send outcome, and never retries an
  ambiguous effect.

The methods are available through the existing private `supervisor-rpc.json`
manifest, loopback-only bearer-authenticated `POST /rpc`. They do not add
an externally reachable port, model API key, hidden ChatGPT backend API, an
agent scheduler, filesystem command, or raw CDP/eval endpoint.

The CLI is `apps/metaengine-browser/scripts/chat-fleet-client.mjs` and reads
the existing protected manifest from the user profile. Examples from the PC:

```powershell
node apps/metaengine-browser/scripts/chat-fleet-client.mjs create --count 7 --request roadmap-setup-20261012-0001
node apps/metaengine-browser/scripts/chat-fleet-client.mjs read --tab tab_<exact-native-uuid>
node apps/metaengine-browser/scripts/chat-fleet-client.mjs assign --tab tab_<exact-native-uuid> --file .\task.txt --request roadmap-task-20261012-0001
```

The CLI never prints the bearer or includes the task text in process args.
Operators MUST keep request IDs and native tab IDs from exact receipts.
Every response is a separate current-process readback; no response means
"unknown effect", NOT permission to retry.

## Current limitations and strict release gates

1. Request deduplication and operator-owned tab mapping are process-local
   in this MVP. After a Browser restart old `request_id` values are not
   authoritative; do NOT reissue an unconfirmed command. First perform
   manual/native readback and create a genuinely new intent. Durable own-
   PostgreSQL mapping/checkpoints are subsequent work, not falsely claimed.
2. The original installed Browser does NOT contain these three new methods.
   The code becomes operational only in a rebuilt and installed client.
3. A source unit test is not real ChatGPT communication. Release requires
   an actual installed native Browser with own local PostgreSQL, real
   `chat.create` → `chat.read` → `chat.assign` → `chat.read`,
   with two different tabs and at least one confirmed answer.
4. Own-PostgreSQL exact owner endpoint is mandatory. Without its attested
   local base the native supervisor base remains UNCONFIGURED. No Supabase
   fallback. No production DB writes or updates on an ambiguous wake.
5. Never elevate ordinary GPT content into instruction/OS authority.

## Evidence

- 36/36 focused unit/security/loopback/local-provider/migration tests PASS
  on Windows (hermetic, no real Browser mutation).
- 190/190 Browser source check prior to final source seal; rerun after final
  changes.
- CI full suite and actual Windows package installer tests: pending.
- Physical installed feature proof: pending.

The working Client's prior snapshot was: Browser PID 2888, Guardian 3288,
own local runtime ready, `admin_ready=false`, Supervisor `WAKE_AMBIGUOUS`,
zero active proven agents. Those are historical observations, not a claim of
current readiness or that this candidate was installed.
