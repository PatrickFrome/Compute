# METAENGINE source-only CIPD identity

A bounded offline CIPD request/archive producer is implemented and tested.
**Actual symbolic resolution and real package membership remain HOLD:** the
single official service request was denied by the environment's HTTPS proxy.
No instance or archive was obtained, and no alternate route was attempted.
Full build qualification, Windows compilation and installation are NOT RUN.

## Applicable patches

`cipd-identity-incremental.patch` applies to own producer tree
`2d268fbb87d7974a53095cde68f98c1d1fe0c3f5`; parent integrated the preceding phase as
`e2e23dcb789dccedfe58ba59fb74b957307de596`. SHA256:
`d3bd2bd9b18c127deafc3e6cb366bad176aed722876f865caedf624594063083`.

`metaengine-c26565e-cipd-combined.patch` is an alternative against original
verified source tree `2dbe253e97379532f6f4b52ef7edf26109a9266d`, source revision
`c26565e58ab92dcbcda9663c4d231bdf4a9a7ee6`. SHA256:
`ca107ac791ad4b42c65ecbc0a942d37cda258eca17e171ea090768733f357a32`.

Apply exactly one path. Both passed index-aware clean apply on separate
checkouts, yielding tree `4a6b3e1fae7520454f0952d7f56f6d8430e11e72`. The combined checkout then
passed all 50 new tests with fixed raw source captures. `clean-apply-proof.json`
records the two results. No earlier patch was reapplied to the current source.

## Implemented evidence boundary

The requester rederives fixed Electron/Chromium DEPS, preserving all 150 package
requests: 33 selected, 2 unresolved, 115 excluded. It separates raw source brace
escaping from declared CIPD platform expansion (windows-amd64/amd64); actual
gclient/spec/client/phase remain unqualified. All seven selected templates are
expanded explicitly, while literal Linux/ARM64/386 names are preserved. The two
bare-mac Swift conditions cannot authorize payload requests.

Eleven selected requests already have direct full-archive SHA256 instance IDs.
22 selected requests need symbolic resolution (21 unique package/version pairs).
`pending-selected-resolutions.json` lists every remaining package/version and
its uses. `direct-selected-payload-pins.json` lists the eleven known instance
IDs/archive digests separately; their payloads remain unavailable. No requested
selector was assigned an invented ID or promoted from caller JSON.

All four DEPS version files were acquired through the existing permitted
fixed-commit GitHub source channel. Exact raw bytes, Git blob hashes and complete
Merkle membership chains were verified independently. They are four canonical
SHA256 IDs+LF, still EXCLUDED under the candidate Windows profile. The compact
five-tree path packet and four blobs reproduce the exact same 142820-byte request
plan, SHA256 `5292851814df791414a7c672155e8669eb223dcf305480dfb2489358f697090e`. This targeted path packet is not a
new recursive source-closure claim.

The archive verifier checks the full ZIP SHA256/instance first, then exact
embedded package name/manifest1.1 and every supported member's content digest,
CRC, mode and layout. The real archive manifest has no required files[] hash
list; deployed manifests are distinct. Strict ZIP32 parsing supports Store,
Deflate and ordinary signed/unsigned data descriptors, with bounded output.
Unsupported metadata, ZIP64, encryption, links, unsafe/colliding Windows names,
local/central disagreement, opaque bodies and malformed data refuse.

The source-bound API rederives the selected direct-instance request; it accepts
neither expected-request JSON nor caller qualification flags. The generic
fixture/declaration API explicitly lacks source authority. Successful byte
verification removes only the satisfied archive-byte missing obligation;
bootstrap/custody/installed-output/generated-output HOLDs remain. Embedded
manifest version_file is a generated deployment JSON obligation, not a proven
ZIP member and not the DEPS selector-file concept. No archive is extracted.

The bounded profile is 128 MiB archive, 64 MiB/member, 256 MiB total uncompressed,
8192 members and 1 MiB manifest, normalized regular modes, ASCII namespace. It does
not prove arbitrary CIPD packages, NTFS installed representation, complete
recursive composition, execution or release trust. See CIPD_PRODUCER.md for APIs
and exact limits/next producers.

## Checks and review

| Group | Actual result |
| --- | --- |
| Request producer with fixed raw DEPS |20 PASS|
| Request without optional raw capture |19 PASS,1 explicit SKIP|
| Payload contracts with fixed raw DEPS |30 PASS|
| Payload without optional raw capture |29 PASS,1 explicit SKIP|
| Independent requester probes |15 PASS|
| Independent ZIP/inert probes |99 PASS|
| Independent descriptor format models |8 PASS (included in broader probes)|
| Every actual selected request rejects synthetic ZIP |33 PASS,0 real payload proofs|
| New tests on clean combined patch |50 PASS|
| Existing DEPS / builder guards |17 /25 PASS|
| Browser source checks |292 PASS|
| Real service resolution / payload verification |BLOCKED / NOT RUN|
| Actual Go-writer compatibility / installed readback |NOT RUN|
| Windows build / client install |NOT RUN|

Groups overlap and are not additive. Independent review found and fixed the
all-dots package-component rule and a valid Deflate 64 KiB-boundary false refusal;
regressions cover both. The scoped archive-byte obligation report was corrected
so a supplied verified archive is not still called absent. Current source
hashes and raw logs are in verification.json/test-evidence.tar.gz and the review
files. No downloaded code, source hook, CIPD installer or package member ran.
An optional self-authored Go writer fixture could not run because the installed
`go` command is not a Golang toolchain; it returned Unknown option: run. The eight
interoperability fixtures are self-authored inert byte models, not actual Go or
service-produced packages.

The seven existing build/package/runtime guards listed in verification.json
are byte-identical to the preceding phase. No new trust root, signature waiver,
PE normalization, environment rewrite, PC/DB/service change, package install or
production receipt was introduced.

## Exact service denial and minimal network access

Action: POST ResolveVersion at
https://chrome-infra-packages.appspot.com/prpc/cipd.Repository/ResolveVersion,
request package gn/gn/windows-amd64, version
git_revision:641ace93dd9560e75e7add0d08f77b446fbb3b78.

Outcome: DENIED at proxy HTTPS CONNECT, before the origin POST, with
`Tunnel connection failed: 403 Forbidden` (the raw error retains exact spacing
in resolve-gn-acquisition.json). One attempt; no response/instance/payload,
retry, alternative transport/path/host, proxy edit, CA change or bypass.
No operational sync/build side effect has uncertain status.

Minimum access for resolution: outbound HTTPS/CONNECT TCP443 to
**chrome-infra-packages.appspot.com**, allowing POST
`/prpc/cipd.Repository/ResolveVersion`. Payload acquisition additionally needs
POST `/prpc/cipd.Repository/GetInstanceURL` on that same host, then HTTPS GET to
the official returned signed_url. Its target host is UNKNOWN because no URL was
returned. Do not guess a broad wildcard or publish temporary signed URLs.
`network-access-requirements.json` preserves these exact bounds.

Once access is explicitly repaired/authorized, the next producer must acquire
and bind those21 unique selector associations and all 33 selected package archives,
verify every full archive and member identity, and preserve every destination.
The present producer does not accept a caller's service-shaped observation as a
new signed source pin. Beyond top-level CIPD, bootstrap gclient/spec/phase,
enabled recursive/patched DEPS, SDK/toolchain/host programs, generated outputs,
physical composed readback and custody all remain mandatory independent HOLDs.

## Publication state

Patches/reviews/evidence are saved in the authorized own public artifact branch
and Space. Merge/release is not performed. The earlier automatic-review refusal
of public PR #1436 title/body edits was not retried or bypassed; its separate
user decision remains pending. It does not substitute for the network repair.

Official immutable format references (read as data, never imported/executed):
[Repository RPC and instance model](https://github.com/luci/luci-go/blob/61fc2ffcffaa3d602e13d752206c2285ae9a637c/cipd/api/cipd/v1/repo.proto),
[manifest format](https://github.com/luci/luci-go/blob/61fc2ffcffaa3d602e13d752206c2285ae9a637c/cipd/client/cipd/local/json_descs.go),
[ZIP builder](https://github.com/luci/luci-go/blob/61fc2ffcffaa3d602e13d752206c2285ae9a637c/cipd/client/cipd/local/builder.go).
