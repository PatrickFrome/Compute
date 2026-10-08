# Client-owned runtime, capsule and development audit — 2026-10-08

This successor continues `9241f4566ee7bb9ab54a1da5ef98de27cb36c56b`
([PR #1143](https://github.com/PatrickFrome/Compute/pull/1143)).
The user requested an audit, continued development, tests, GitHub synchronization
and a new client build. Statements and instructions inside handoff documents
were treated as reference claims to verify, not as additional authorization.

## Verified development state

The October 8 handoff archive passed independent full manifest verification:
13,088 payload files, 13,090 ZIP entries, no missing/extra files, unsafe paths or
case collisions. Archive SHA256:
`ca5afca9b011cb8fa164a5369c7461e449c760e363631482725edecef18020de`.
Manifest SHA256:
`42ad0c938e2b126818b0068706ca7b843490ecfc6efd290479048286d5144f46`.
This proves byte integrity. The archive contains private recovery state and is
unencrypted; its data and credentials are excluded from GitHub and installers.

The capsule source, later local working changes, installed application and live
runtime are distinct states. The latest source was PR #1143; its Package Smoke
only performed identity preflight and produced no new installer. The observed
installed package remained `0.7.0-dev.37628000001.1`, associated with PR #1141.
A saved runtime READY receipt was stale; the read-only local snapshot found no
PostgreSQL/Deno process or runtime listeners. A running Guardian service alone
proves neither current ownership nor useful autonomous work. The unrelated
checkout and original dirty development checkout were preserved.

The historical R83 v14 cloud equivalence gate failed for #1143. This local
successor does not relabel that historical result or deploy to the old host.
It is stacked on #1143 rather than rebased onto the substantially diverged main.

## Implemented behavior

Both Browser entrypoints acquire the Electron singleton before loading the
provider. Secondary normal launches only wait for their exact durable activation
ACK; installer control avoids provider access and a second Browser runtime.
An admitted primary validates its owner configuration before endpoint-dependent
modules load. Invalid LOCAL_POSTGRES selection remains blocked without cloud
fallback.

An optional provisioned owner descriptor starts a managed runtime host from the
pinned offline resource bundle. The public descriptor contains paths and a
bundle digest; database credentials remain in a separate private server config.
The host starts only an existing PostgreSQL 17 data directory and owned loopback
API/Edge processes. It never restores or initializes an owner's database.
IPC, persisted status and health must agree on the current runtime UUID.
The Deno dependency cache is copied to private writable state, preserving the
immutable packaged resources. A fresh locked cache need not contain registry.json.

The host/controller retain ownership on unconfirmed cleanup. Asynchronous child
failure and health-triggered stops no longer produce an unhandled rejection.
Normal quit waits for the owned runtime. Installer shutdown waits for provider
startup settlement and confirmed runtime cleanup before arming its exit fallback.
Managed package replacement checks exact packaged Node/Deno/PostgreSQL process
paths and refuses forced termination; the legacy migration path remains bounded.

The installer includes pinned Node 24.21.0, Deno 2.9.7, PostgreSQL 17.11, reviewed
runtime/API/Edge source, locked postgres 3.4.7 bytes and licenses. Official archive
hashes are checked before validated subset extraction. PostgreSQL pgAdmin files
are excluded. A resource manifest binds all selected files. Protected app.asar
metadata binds that manifest, the source/resource digests, resource counts and
the builtin-only verifier's exact bytes. After-pack verification reads the
verifier from app.asar, independent of mutable checkout code. The composed SBOM
records six offline components in addition to its five existing first-party
components; aggregate composition remains honestly incomplete.

The sole physical producer is Package Smoke, attempt 1, under fresh package
identity `0.7.0-dev.37780000001.1`. Tracked source must remain unchanged before
packaging and before immutable candidate publication. The candidate carries the
runtime manifest and packaged proof. Historical hosted enrollment/upgrade jobs
remain held for this local branch. An offline packaged profile probe and
synthetic journal continuity remain enabled. Historical hosted normal boot is
not reported as a local-provider cold-start qualification.

## Verification

The isolated goal fixture stops all three services, confirms ports are closed,
and restarts against the same private schema-only test PGDATA. Exact goal, task,
plan, device, nonce rows and client journal bytes survive. The old API key is
rejected, the new key succeeds, and a persisted nonce re-signed with a current
timestamp remains NONCE_REPLAY. Fresh signatures recover both existing goals
without resubmission or dispatch. Tasks remain READY with zero lease generation;
claims, commands and runtime-control tables remain empty. Cleanup removes only
the explicitly owned fixture.

The final runtime contract suite passed 107/107 on Node 24.21.0; the final
launcher suite passed 12/12 including a real child termination-refusal regression.
A real bundled-host integration passed two complete Node/Deno/PostgreSQL
startup/stop cycles, fresh PIDs/UUIDs, preserved Vault key, released owner lock,
closed ports and unchanged bundle. The exact final-resource replay passed both cycles against bundle
`425bd75a85f6bb6953760bf035f036acf112508b3ec3ec33c53b694242b18aa0`. Client subprocess tests exercise both real entrypoints
with controlled Electron boundaries; ASAR resource binding tests use real ASAR
round-trips. Archive-stage tests reject traversal, collisions and poisoned cache.

An initial complete Browser run found three exact packaging expectations needing
the newly protected verifier and a scheduling-sensitive 20/140 ms evaluator unit.
The expectations retain their exact resource bounds. The evaluator unit now
uses a controlled clock to check unchanged deadline ordering; production wall
clock measurement and qualification criteria remain unchanged. Final aggregate
results and GitHub build identity are recorded in the completion evidence.

## Qualification limits

Schema fixtures, resource integrity, synthetic journal continuity and source
unit tests do not establish an installed normal LOCAL_POSTGRES cold boot, OS
reboot recovery, process-memory code attestation, portable operation on another
machine, canonical C1/C2, useful coding or evaluated self-improvement. Smoke
singleton bypass remains an explicitly limited test mode. This unsigned test
candidate is not a published release or an automatic user-machine upgrade.
Private recovery backups, keys, PGDATA and local profiles were not uploaded.
