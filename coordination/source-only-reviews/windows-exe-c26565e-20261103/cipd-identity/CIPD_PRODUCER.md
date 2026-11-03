# Bounded CIPD request and archive identity

The CIPD producers extend the fixed top-level DEPS inventory with explicit
request names, source-derived instance declarations, and data-only archive
membership verification. They do not execute CIPD, an archive member, a hook,
an installer, or a compiler. Full dependency composition and build admission
remain `HOLD`. No production receipt or release authority follows from these
results.

## Requests and concrete declared platform

Inputs remain the exact Electron/Chromium DEPS blobs described in
[the DEPS inventory](custom-electron-deps-composition-v1.md). Preserve all 150
package declarations: 33 selected, two unresolved and 115 excluded under the
explicit candidate native Windows x64 initial-sync profile. This does not
qualify the actual bootstrap gclient, `.gclient`, custom variables, sync host,
CIPD client, platform or phase.

The source retains raw `${{platform}}`/`${{arch}}` strings. A separately named
declared brace-escape model yields `${platform}`/`${arch}`; the reviewed LUCI
template model then yields `windows-amd64`/`amd64` for this declared host.
These model stages are not asserted to be the actual gclient invocation.
Unknown templates or platform values cannot silently become current-host
defaults. Seven selected requests contain platform templates. Explicit package
names stay unchanged, including Windows ARM64/386 updater packages and an
always-selected Linux TypeScript package. Target x64 does not permit filtering
those source declarations out. The two bare-mac Swift conditions remain
unresolved and cannot supply an admitted payload request.

Of the 33 selected requests, eleven already declare canonical SHA256 CIPD
instance IDs. Each identifies the full ZIP body, including archive metadata.
The other 22 requests use symbolic selectors (21 distinct package/version
pairs); no instance resolution was obtained for them. A version selector,
service-shaped JSON, caller digest, `verified:true` flag or a package path
cannot replace the missing source-bound instance declaration.

## DEPS version files

Four source `version_file` declarations refer to Android orderfiles:

| Source path | Git blob |
| --- | --- |
| `chrome/build/android-arm.orderfile.txt` | `099e702efa7b6710f803404efabfb5d9e58581ac` |
| `chrome/build/android-arm64.orderfile.txt` | `cffe236bc9ad92879ea5a8a6fcee282fda066abe` |
| `android_webview/tools/android-webview-arm.orderfile.txt` | `959feb5896dc50b4e59cb5f873cda29ea7c1ee32` |
| `android_webview/tools/android-webview-arm64.orderfile.txt` | `151851e05043748f3ffb8e0873f9ab339636a7db` |

All four were read from the fixed Chromium commit, matched to its root through
raw hashed Git tree chains, and checked as exact blob bytes. Each contains a
canonical 44-character SHA256 instance ID followed by LF. They remain excluded
under the candidate Windows profile. Their verified selector bytes do not
enable their dependencies or prove any downloaded payload. Supplied source
blob bytes must match their fixed Git object membership; arbitrary local
version-file content is not authoritative.

## Archive identity and member inventory

The format model is tied to immutable official LUCI source
`61fc2ffcffaa3d602e13d752206c2285ae9a637c`, with raw file Git/SHA256 evidence.
This is a data-format reference, not qualification of the actual bootstrap
client. CIPD SHA256 instance encoding is the archive digest plus algorithm byte
2 encoded as canonical URL-safe base64. Legacy SHA1 or a version tag cannot
be promoted to this strong identity.

The bounded archive verifier first checks the complete ZIP SHA256 against the
expected instance. It then verifies `.cipdpkg/manifest.json`, format `1.1`, and
the exact expected `package_name`, and derives content/mode identity for all
supported members. The archive manifest does **not** contain a per-file digest
list; that list exists in a deployed manifest. No invented embedded file list
is used as independent evidence. Complete archive binding authenticates the
member bytes from which the inventory is derived.

The supported profile is a narrow regular-file Windows namespace with Store
or Deflate compression and CIPD-normalized owner permissions. Unsupported or
ambiguous ZIP constructs, links, unsafe names and namespaces refuse; they do
not trigger extraction or fallback to another installer. Archive membership
does not qualify NTFS representation, a deployed composed filesystem, host
execution, generated files or source custody through a build.

The fixed parser limits are 128 MiB of archive bytes, 64 MiB per member,
256 MiB of total uncompressed bytes, 8,192 members and 1 MiB for the manifest.
ZIP64 and unsupported metadata are outside this profile. Refusal at a limit
does not prove a package corrupt; it leaves that package unqualified. Successful
source-bound verification discharges the supplied archive-byte obligation and
retains every unrelated phase, custody and installed-output obligation.

The archive manifest's optional `version_file` is a different field from DEPS
`version_file`: it names a generated deployment JSON file. Its path and
obligation remain explicit and unqualified. It must not be silently counted
as an authenticated ZIP member or complete deployed output.

## Service acquisition and minimal network requirement

The only attempted CIPD service request was:

```text
POST https://chrome-infra-packages.appspot.com/prpc/cipd.Repository/ResolveVersion
package: gn/gn/windows-amd64
version: git_revision:641ace93dd9560e75e7add0d08f77b446fbb3b78
```

It failed before the origin POST, during proxy HTTPS CONNECT, with
`Tunnel connection failed: 403 Forbidden`. No instance response or archive was
received. There was no retry, alternate route, network configuration change or
new trust root. Source-format and version-file reads use the existing permitted
official GitHub source channel; they do not retrieve CIPD service payloads.

For resolution, the minimum requested access is outbound HTTPS/CONNECT TCP443
to `chrome-infra-packages.appspot.com`, allowing POST to the above RPC path.
Payload acquisition additionally needs POST to
`/prpc/cipd.Repository/GetInstanceURL` on the same host, then HTTPS GET to the
returned `signed_url`. The exact signed-URL target host remains unknown because
the service returned no URL. Signed URLs are temporary capabilities and must
not be printed or published as evidence. Existing TLS verification stays in
place; no wildcard network rule or additional CA is inferred here.

## Actual proof boundary and next producers

With fixed source bytes and preprovisioned raw tree objects, the request CLI is:

```sh
python3 -B apps/metaengine-browser/scripts/custom-electron-cipd-policy.py \
  --electron-deps /prepared/electron-DEPS \
  --chromium-deps /prepared/chromium-DEPS \
  --chromium-tree-objects /prepared/chromium-tree-objects \
  --source-blob-dir /prepared/version-file-blobs > /new/cipd-requests.json
```

The source blob directory contains only content-addressed `<Git OID>.blob`
files; the supplied bytes must match the fixed-root membership. Exit 0 means
inventory creation, while the JSON retains `HOLD`. No missing input is fetched.

For one of the eleven selected direct-instance requests, the source-bound
archive CLI accepts a separately provisioned archive:

```sh
python3 -B apps/metaengine-browser/scripts/custom-electron-cipd-payload.py \
  --electron-deps /prepared/electron-DEPS \
  --chromium-deps /prepared/chromium-DEPS \
  --owner chromium --path src/tools/skia_goldctl/win --package-index 0 \
  --archive /prepared/goldctl-instance.zip > /new/cipd-members.json
```

It rederives the source request rather than accepting expected package/digest
JSON, and exits 1 with `HOLD` even when bounded archive verification succeeds.
The generic declared-byte API exists for data/fixture checking and explicitly
does not establish a fixed-source binding. No CLI accepts a caller's success
flag or uses a resolution observation to authorize a symbolic source selector.

Positive and negative archive fixtures are inert synthetic data. Actual CIPD
payload readback is `NOT RUN`; no service resolution, ZIP digest/member proof
for a real package, extraction, installation or Windows execution is claimed.
The request inventory records exact remaining selectors and direct instance
declarations separately.

After network access is explicitly repaired, a producer must capture the exact
official request/response association, resolve each selected symbolic request,
bind reviewed immutable instances and full archive bytes, and apply the member
verifier. A server response or caller-authored observation alone cannot become
release trust. Resolve ambiguity and unsupported instances explicitly, preserve
every destination/use, and do not fetch excluded or unresolved requests.

The full build additionally still needs bootstrap gclient/spec/phase identity,
enabled recursive and Electron-patched DEPS, SDK/toolchain and host interpreter
bytes, generated-output identities, physical composed readback and custody.
Those guards remain independent and mandatory. Windows build and client
installation are `NOT RUN`.
