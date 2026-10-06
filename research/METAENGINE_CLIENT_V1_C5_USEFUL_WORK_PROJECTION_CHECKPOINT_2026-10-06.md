# METAENGINE Client V1 C5 — Useful-Work Product Projection Checkpoint

Date: 2026-10-06  
Status: **EVIDENCE_READY — READ-ONLY PRODUCT PROJECTION**  
Branch: `work/client-v1-c5-useful-work-projection-v1`  
Qualified implementation head: `83f015eb1faf81a2c8fb874ba3cc4105e4ab7939`

## Roadmap reconciliation

Canonical Level-1 owner: **C2 — First Serial Coding Loop**.

This slice does not execute useful work and does not prove canonical C2.

It advances the Client-facing evidence surface after the previous C5 durability checkpoint:

- C5 useful-work proof contract exists;
- physical reference repo/edit/test/artifact mechanics exist as SYNTHETIC;
- useful-work proof can survive restart fail-closed;
- this slice projects that already-durable proof into the installed product UI without adding a new mutation or remote authority path.

Primary canonical spine remains:

`R1 → C1 First Real Linux Worker → C2 First Serial Coding Loop`.

Canonical promotion remains external and Supervisor-owned.

## Key architectural finding

No new backend/native readback method is required for this bounded projection.

Existing path:

`ClientGoalJournal → latestClientGoal() → metaengine:client:latest-goal → preload latestGoal() → ME2 UI`

already returns the durable journal entry as a structured clone.

The useful-work durability slice added:

`useful_work_proof`

to that journal entry.

Therefore the safest product step is to extend the UI's typed projection of the already-validated object rather than introduce another Edge/RPC route before a live useful-work server contract exists.

## Electron bridge boundary

The preload already exposes a narrow method:

`latestGoal: latestClientGoal`

which maps only to:

`ipcRenderer.invoke('metaengine:client:latest-goal')`.

This slice adds no:

- generic `ipcRenderer` exposure;
- useful-work submit endpoint;
- accept endpoint;
- retry endpoint;
- promote endpoint;
- new provider mutation.

Electron's current security guidance recommends narrow per-message wrappers over exposing broad IPC primitives through `contextBridge`.

Sources:

- https://www.electronjs.org/docs/latest/tutorial/context-isolation
- https://www.electronjs.org/docs/latest/api/context-bridge

Applied decision:

Reuse the existing narrow read projection. Do not expand the renderer's authority just to show evidence.

## UI contract

`apps/me2-ui/src/components/me2/shell/me2-shell.tsx`

adds a typed:

`ClientUsefulWorkProof`

containing only the product-relevant, already-normalized fields:

- evidence class;
- evidence origin;
- C5 verified boolean;
- canonical promotion false;
- artifact SHA-256;
- provenance SHA-256;
- independent verification receipt SHA-256;
- verification booleans;
- independent review/accepted artifact binding;
- zero-authority flags.

Journal UI type now includes:

`useful_work_proof: ClientUsefulWorkProof | null`.

## Product semantics

### LIVE

The UI may display:

`Live useful work verified`

only when all three are true:

- `client_c5_useful_work_verified === true`;
- `evidence_class === LIVE`;
- `evidence_origin === SIGNED_SUPERVISOR_READBACK`.

A boolean alone is insufficient.

### SYNTHETIC

A controlled reference proof displays:

`Reference evidence only · not live`.

It is never labeled live or accepted Client C5 evidence.

### No proof

Displays:

`Not yet proven`.

### Canonical boundary

If any useful-work evidence exists, the UI explicitly states:

`Evidence only · not promoted`

under:

`Canonical C2`.

The UI does not infer canonical completion from Client evidence.

## Digest-only detail surface

Task Status displays only bounded prefixes of:

- artifact SHA-256;
- provenance SHA-256.

The renderer does not consume or display:

- repository paths;
- workspace paths;
- raw patch/diff;
- stdout/stderr;
- artifact filesystem paths;
- result summary;
- model output;
- page content;
- agent/tab/target identities.

Full digests remain in the durable evidence object; UI uses a 12-hex prefix plus ellipsis for human correlation.

## Honest result copy

The previous task dialog always said:

`A received result still requires independent verification before acceptance.`

That remains correct when there is no useful-work proof.

The text is now conditional:

LIVE signed verified evidence:
- useful-work evidence independently verified;
- canonical C2 promotion remains a separate Supervisor decision.

SYNTHETIC reference:
- mechanics were exercised;
- this is not live Client C5 evidence.

This prevents a verified local proof from being described as unverified, while also preventing a synthetic reference from appearing production-live.

## Read-only reconciliation

The existing main-process latest-goal function:

- loads the durable journal;
- optionally reconciles nonterminal goal state through existing readback;
- returns `structuredClone(latest)`.

The projection test asserts that this path contains no:

- `clientGoalSubmit(...)`;
- `submitClientGoal(...)`;
- `recordUsefulWorkProof(...)`.

The UI view itself therefore creates no work/effect.

Temporal's message-passing model describes Queries as read requests that observe current workflow state without writing history, distinct from Signals/Updates that change state.

Source:

https://docs.temporal.io/encyclopedia/workflow-message-passing

METAENGINE is not claiming to implement Temporal. The applicable design principle is the strict read/write distinction: product evidence inspection must not acquire mutation semantics.

## New adversarial projection tests

`apps/metaengine-browser/test/client-v1-c5-useful-work-projection.test.mjs`

proves:

1. preload exposes only existing `latestGoal` for this projection;
2. no useful-work mutation IPC/API was added;
3. main latest-goal path returns the durable journal entry with no submit fallback;
4. journal carries useful work only as zero-authority evidence;
5. LIVE requires exact LIVE + signed-origin + verified combination;
6. SYNTHETIC is labeled reference-only;
7. artifact/provenance projection uses bounded digest prefixes;
8. raw patch/log/model/page/path fields are not projected;
9. canonical C2 is explicitly not promoted.

The workflow also re-runs:

- useful-work restart durability;
- useful-work proof contract;
- execution-proof integrity.

## Strict production UI build

This slice is not qualified by source inspection alone.

Workflow installs the exact frozen ME2 UI dependency graph using:

- Node `24.21.0`;
- Bun `1.3.3`;
- `bun install --frozen-lockfile`.

Then runs:

`bun run build`

which executes the production Next build and postbuild standalone packaging.

Observed:

- Next.js `16.1.3`;
- optimized production compilation: PASS;
- TypeScript stage: PASS;
- static-page generation: PASS;
- standalone postbuild: PASS.

The build log recorded:

`Compiled successfully`

and:

`[postbuild-standalone] OK`.

## Exact CI

Workflow:

`Client V1 C5 Useful Work Projection`

Run:

`37395862556`

Job:

`112051528254`

Exact head:

`83f015eb1faf81a2c8fb874ba3cc4105e4ab7939`

Conclusion:

**SUCCESS**

Aggregate contract tests:

- tests: **45**
- pass: **45**
- fail: **0**
- skipped: **0**

Frozen UI dependency installation:

**PASS**

Strict production ME2 UI build:

**PASS**

Source checkout unchanged:

**PASS**

## Amplifier research conclusion

### Do not create a remote API merely because the UI needs a field

Electron's context-isolation guidance explicitly favors narrow, purpose-specific bridge methods and warns against exposing overly powerful IPC capability.

The existing latest-goal read lane already supplies the durable evidence object. Adding a parallel useful-work IPC or Edge route now would increase authority surface without increasing truth.

### Classification belongs beside evidence

A digest without origin/classification is easy to overread.

Therefore the product pairs evidence with:

- `LIVE` vs `SYNTHETIC`;
- signed Supervisor vs controlled fixture;
- Client C5 verified boolean;
- canonical promotion false.

### Product readback must remain non-actuating

The same task dialog contains explicit user actions such as refresh/recovery, but merely opening Status or loading latest durable evidence performs no goal submission and no useful-work mutation.

This read/write separation should be preserved when a future signed server-side C5 readback endpoint is introduced.

## Non-claims

This checkpoint does not prove:

- a live signed useful-work server readback exists;
- a live z.ai Agent created the artifact;
- the installed Windows Client executed C5 useful work;
- Windows restart/reboot continuity;
- persistent C1 Linux worker admission;
- canonical C2 completion;
- production promotion.

The UI can display SYNTHETIC reference evidence honestly, but that remains non-live evidence.

## Next safe boundary

The next architectural step would be a **server/native read-only useful-work readback contract** bound to the existing exact Client execution proof.

That work would touch Supabase/Edge source and requires the Supabase-specific workflow/security review before implementation. It can still be implemented PREPARE_ONLY in source/tests, but deploying or exercising a live route would be a separate mutation boundary.

Until that contract exists, the product correctly projects only durable locally validated useful-work evidence.

## Checkpoint

Client C5 useful-work product projection: **EVIDENCE_READY / READ-ONLY**.

Client C5 LIVE useful work: **NOT_PROVEN**.  
Canonical C2: **NOT_PROVEN**.  
Canonical promotion authority: **false**.  
Authority effect: **false**.
