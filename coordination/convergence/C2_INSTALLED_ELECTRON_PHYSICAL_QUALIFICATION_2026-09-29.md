# C2 INSTALLED ELECTRON PHYSICAL QUALIFICATION — 2026-09-29

## Exact physical subject
Product branch:
`work/client-v1-c2-new-supabase-rehome-v1`

Frozen qualification subject:
`00d7c814213a97ac17504d5c598818bd99c588cb`

The product branch was not moved while the physical artifact was built, installed, enrolled, commanded, and read back.

## Exact CI evidence

All ordinary exact-head gates reached terminal SUCCESS for the subject, including:
- Windows Package Smoke: run `36561974797`
- Windows Autonomous Soak: run `36561974828`
- Final Runtime Activation: run `36561974812`
- Windows Installed Chat Qualification: run `36561974745`
- Critical Audit: run `36561974813`
- Browser Shell: run `36561974883`
- Self Update E2E: run `36561974779`
- R83 Edge Canary Qualification: run `36561974817`
- Client V1 Supabase Edge Live Probe: run `36561969735`

Installed Electron Live Qualification:
- workflow run: `36561969764`
- successful run attempt: `2`
- exact source head: `00d7c814213a97ac17504d5c598818bd99c588cb`
- exact Package Smoke producer run: `36561974797`
- producer run number: `2962`
- producer run attempt: `1`
- package version: `0.7.0-dev.36516587173.1`
- installer sha256: `0214578fa908d703f613506ebc3519149e7c1d8a63bb6ebe452da7d5c4796486`
- producer terminal success: true
- exact checkout unchanged: true

## Installed Browser proof

Correlated enrollment request:
- request id: `e7dcb6b6-37ee-4dd8-8fcc-eaf58732207a`
- client id: `5147c320-78bc-4d57-a069-d7f3ac77c7fc`
- qualification kind: `INSTALLED_ELECTRON`
- qualification run id: `36561969764`
- source head: `00d7c814213a97ac17504d5c598818bd99c588cb`
- key fingerprint sha256: `80f0ccfccdaf22e8a9ba346b448c250f8120042d17a8caba82bbeeaccfcd6e5a`

The exact request was explicitly approved and subsequently became `CLAIMED`.

Activated device:
- device id: `778e4811-eba8-4ccf-83f6-1552a6626f10`
- active: true
- private key exported: false
- encrypted private key present on the installed host: true
- installed process alive at proof capture: true
- control mode: `CONTROL`
- armed: true
- signed transport ready: true

## Durable physical command round trip

One externally issued, deterministic, read-only command was used:
- command id: `d89881a8-8330-4c49-8dbe-bcf428ef0825`
- action: `POLL`
- lane: `READ_ONLY`
- idempotency key: `client-v1-installed:36561969764:attempt2:poll`
- target client: `5147c320-78bc-4d57-a069-d7f3ac77c7fc`
- terminal status: `COMPLETED`
- authority effect: false
- leased by the exact installed client
- durable terminal receipt recorded
- receipt runtime source SHA: `00d7c814213a97ac17504d5c598818bd99c588cb`

This proves the chain:
`exact source -> exact Package Smoke installer -> installed Electron -> signed enrollment -> explicit approval -> signed state -> durable READ_ONLY lease -> installed Browser execution -> terminal durable receipt`.

## Edge convergence after qualification

The temporary diagnostic stable deployment was removed.

Stable and canary were both redeployed from the exact qualified source closure pinned to:
`00d7c814213a97ac17504d5c598818bd99c588cb`

Current live readback:
- stable `a2-browser-native-supervisor-v1`: version `8`
- canary `a2-browser-native-supervisor-v14-canary`: version `16`
- stable digest: `3ce87ea81481dbf8fd6afee819bed3bd3b41528e7b5c6842a2d7b7be38ccf829`
- canary digest: `3ce87ea81481dbf8fd6afee819bed3bd3b41528e7b5c6842a2d7b7be38ccf829`
- verify_jwt: false for both
- public stable/canary health probe after convergence: SUCCESS

Current-candidate rollback drill:
1. canary rolled back to source `d0caf994fffb22a863a68d99255e181d1a3acbd3`
2. rollback canary version: `15`
3. rollback digest: `b6a280c00204e35ff0b24d118451d8b8cc7e43119b4f8624b477ba6625b07a5d`
4. public stable/canary health probe during rollback: SUCCESS
5. canary restored to exact qualified source `00d7c814213a97ac17504d5c598818bd99c588cb`
6. restore canary version: `16`
7. restore digest: `3ce87ea81481dbf8fd6afee819bed3bd3b41528e7b5c6842a2d7b7be38ccf829`
8. public health probe after restore: SUCCESS

## Research after physical qualification

Supabase's current platform guidance explicitly treats deployed Edge Functions separately from database point-in-time restoration: a database revert does not revert deployed Edge Functions. It also recommends development branches, explicit Edge deployments, and production security checks.

Repository research shows the existing METAENGINE evidence systems repeatedly separate:
- immutable execution subject / artifact digest,
- producer workflow/run/head,
- independently persisted or attested evidence.

That pattern is preferable here to mutating the already-qualified artifact subject merely to write its own post-hoc proof into the subject commit.

## Evidence-sealing boundary

The frozen product subject remains `00d7c814...`.

Do not create an infinite evidence loop where:
`physical proof -> evidence commit -> new exact SHA -> new physical proof -> evidence commit -> ...`.

The next implementation step is therefore a bounded R83 evidence-seal contract that:
1. names `00d7c814...` as the immutable qualification subject;
2. binds exact installer digest, producer run, installed run/attempt, enrollment/device identity, command/receipt identity, Edge stable/canary digests, rollback/restore versions, and health-probe attempts;
3. lives outside the immutable artifact subject or is independently attested;
4. cannot itself become execution or promotion authority merely because it exists;
5. is consumed by promotion/reconciliation only after exact digest/run/readback verification.

Until that evidence-seal contract is implemented and independently verified, keep the committed R83 manifest's promotion flag fail-closed.
