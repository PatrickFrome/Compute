# Guardian Windows static OpenSSL dependency

This builds a candidate OpenSSL 3.5.9 dependency and the existing Guardian
release-signature primitive with the MSVC static CRT. It compiles a separate
production library, exercises the original tests, and links a public-API probe.
The dependency builder alone does not mount the primitive in the service, issue a production signature,
install a client/service, attest loaded code or open the execution gate.

The integrated consumer path is described in [INTEGRATION.md](INTEGRATION.md).
It builds the service and peer from one fresh dependency build and embeds the
actual service/configurator bytes in the bootstrap. Historical producer results
below are not qualification of a later integration commit.

`guardian-openssl-source-lock.json` fixes the OpenSSL release archive and
detached-signature bytes, the complete signing primary/subkey fingerprints,
and NASM's exact official source commit/archive. OpenSSL's
[downloads page](https://openssl-library.org/source/) publishes the primary
fingerprint. NASM's annotated release tag is unsigned; the NASM pin records
the official source identity and content digest, not a signature verification.

The acquisition command requires an actual public OpenSSL release certificate:

```sh
python3 apps/metaengine-browser/scripts/acquire-guardian-openssl-source.py \
  --certificate-file /absolute/path/official-openssl-public-certificate.asc \
  --output-dir /absolute/path/empty-source-handoff
```

The certificate is matched to the checked-in fingerprints. GPG runs in an
isolated temporary keyring with automatic key retrieval disabled. Hash or
signature failure prevents a success manifest. The caller does not establish
a new trust root by supplying certificate bytes. A private key is rejected.
The script does not fetch keys or retry failed network transfers.

On Windows, from a clean checkout of the same Git HEAD:

```powershell
./apps/metaengine-browser/scripts/build-guardian-openssl-static.ps1 `
  -SourceDir C:\qualification\source-handoff `
  -OutputDir C:\qualification\new-build-output
```

The builder uses the existing MSVC x64 environment, native Windows Perl and
Python. `-VcVarsPath`, `-MsvcToolsetVersion` and `-WindowsSdkVersion` permit
selection of an already installed toolchain. It builds pinned NASM source
with upstream Perl generators and MSVC `/MT`, then runs OpenSSL `nmake` and
`nmake test`. No installer or `nmake install` is invoked. Archive extraction
checks content hashes and rejects traversal, links, duplicate Windows names
and special entries before writing any member.
The extractor reads at most the pinned size plus one byte into a private
immutable snapshot, with a 128 MiB archive limit. It checks that snapshot's
size and SHA256, then parses only those same bytes. Renaming or rewriting
the caller's archive after verification cannot change the extracted source;
mutation during the snapshot read must still produce the pinned digest or
fail before creating the extraction directory.
Node 24 or newer is required for the existing project tests. `-NodePath` can
select an installed executable; a hosted runner's existing tool cache is used
when its default PATH points to an older Node. No runtime is downloaded, and
the actual executable hash/version are recorded.

The profile is `VC-WIN64A --release no-shared no-module no-dso no-engine
no-autoload-config no-legacy ASFLAGS=--reproducible`. Apps and upstream tests stay enabled. A small
dependency probe checks the SHA256 known answer, built-in default provider and
rejection of a real adversarial provider DLL under hostile `OPENSSL_*`
environment settings. It is not a replacement signature verifier. PE reports
must show x64 and only the reviewed Windows system DLL imports; dynamic CRT
and OpenSSL DLL imports fail the build. The adversarial DLL stays in the
disposable `work/` directory and is not in the deliverable.

Before building, Windows independently repeats the detached-signature check
without networking. It discovers an existing `gpg.exe` (including Git for
Windows' copy), or accepts `-GpgPath`. A hand-edited `signature_verified` field
cannot substitute for this actual GPG verification. Fresh verification logs
are preserved separately from the acquisition producer's evidence.

Deliverables are `artifacts/openssl-static/`, `artifacts/guardian-signature/`, `evidence/` and
`openssl-static-build-proof.json`. They contain library/header/notice hashes,
source/GPG evidence, tool versions, configuration, full upstream-test log,
provider-negative-test output and PE reports. OpenSSL's unmodified
`LICENSE.txt` is included; its source archive has no root NOTICE. NASM's
BSD/Zlib/ISC notices accompany build-tool evidence. Generated manifests retain
`production_qualified:false`, `native_verifier_linked:false` and `CLOSED`.
Here `native_verifier_linked:false` means the Guardian service has no mounted
consumer. Separate proof fields record production-library compilation and
test/public-API executable linkage. A test binary is never a production asset.

The workflow `browser-guardian-openssl-static-v1.yml` runs offline adversarial
tests and Windows PowerShell parsing on PRs. Its dependency build is manually dispatched with
`openssl_signing_certificate_b64`, the base64 of the public official
certificate. The certificate is passed through environment data and checked
against the fixed fingerprints. Linux acquisition hands verified inputs to
the Windows job within the same run; it does not obtain blocked certificate
material from a different execution environment.

## Interface for the Guardian service/custody owner

Use `artifacts/openssl-static/include` and
`artifacts/openssl-static/lib/libcrypto.lib`, compiling every verifier
translation unit with `/MT`. Preserve the verifier's signature semantics and
existing tests. Use an isolated OpenSSL library context, the built-in default
provider and applicable context-aware EVP APIs. Do not load caller-selected
config, engine or provider paths. Link upstream's required Windows system
libraries; inspect the actual final verifier/Guardian PE imports in addition
to this dependency probe's imports.

The existing primitive is `native/browser-guardian-scm/browser-guardian-release-signature.cpp`.
Its public API/header and separately compiled archive are staged under
`artifacts/guardian-signature/include` and `artifacts/guardian-signature/lib`.
The builder runs its existing RFC8032/root-rejection tests and the real Node
canonical/SPKI comparisons. A separate probe links the production archive and
calls the public API on malformed and valid-format/invalid-signature input.
Both probes run under hostile provider/config settings with a persistent
sentinel marker. Existing tests use binary CRT stdin/stdout on Windows so raw
DER and canonical bytes retain their original LF bytes.

Mounting this API in the actual Guardian service requires the service/custody
owner's reviewed interface. Bind final service PE/evidence digests to the exact
source SHA and rerun its actual effect/custody tests. Signature validity alone
does not establish loaded code, Owner authority or freshness. Genuine
production-root positive signature evidence remains unavailable; RFC vectors
are explicitly test-only. Stop/I/O lifecycle and loaded-file custody remain
owned by their independent streams.

## Historical producer evidence and remaining qualification

Implementation base: `0e43a569ad52134bee65dea3182ee9a4c4bbc56f`.
Native source base: `e6c72339ad4246018176407a971811c0dfceccf3`, tree
`58441b46100f2347b9588855d5c7a544a7d65a0d`, fetched from Draft PR 1393.
The cached OpenSSL archive/signature and NASM source archive matched the fixed
sizes/digests. Local offline tests cover GPG identity/error statuses, failed
acquisition, corruption and hostile archives. NASM's upstream Perl generator
recipes ran on Linux with a documented path-separator adaptation; this is
not a Windows MSVC result.

An actual local Linux OpenSSL 3.5.9 build with the same disabling flags passed
four upstream recipes (provider, SHA, dgst and EVP): 133 tests. The dependency
probe passed its SHA256/provider negative checks; a separate positive control
confirmed that the Linux sentinel records loading. These results do not
qualify Windows. The actual native production object and original test
executable also compiled against this static 3.5.9 library; its 20 Node
cross-language tests passed under hostile provider settings. Requested names
`test_sha2`, `test_ed25519` and `test_ed448` had no matching standalone recipe;
they are not counted as passed. FIPS preparation was skipped for this profile.

No official certificate bytes were available in this environment: prior GPG
verification returned `NO_PUBKEY`, not `VALIDSIG`. An actual official public
certificate, Windows MSVC execution, full upstream Windows/native results and
actual service/custody integration remain required. Recorded tool versions and
source pins do not establish bit-identical reproduction; compare independent
clean builds before making that claim.
OpenSSL build metadata uses the pinned release-signature creation timestamp
`SOURCE_DATE_EPOCH=1790690724` through upstream's supported build-info generator;
this alone does not remove every MSVC/PE reproducibility source.
NASM gets its supported `--reproducible` option for generated COFF objects and
inherited `NASMENV` is cleared. NASM's own binary still embeds its MSVC
`__DATE__`; upstream has no `SOURCE_DATE_EPOCH` support. This and remaining
MSVC/PE timestamp/path variation are limitations and possible future
improvements, not added installation blockers.

## Existing artifact acceptance boundary

The inspected release/installer gates on native base `e6c72339` do not require
an independent byte-identical rebuild. In fact,
`scripts/installer-provenance.mjs` specifies building exactly once and
downstream verification of the same immutable bytes, and
`.github/workflows/metaengine-browser-fast-autorelease.yml` requires
`target_build_count == 1`. The native staging verifier checks exact source,
size and SHA256, while the release evidence gate requires terminal success
of the independent exact-SHA Windows/source/physical workflows. Relevant
signatures and attestations remain required. Older generic operator-ZIP
reproducibility checks belong to a different pipeline.

Accordingly `bit_identical_reproducibility_verified:false` is informational.
This qualification lane does not require it to become true, does not rebuild
an installer to establish acceptance and does not weaken existing gates.
The priorities remain official hash/signature source authentication, actual
Windows upstream/native tests and PE imports, verified source/build
provenance, and immutable artifact hashes. Compare independent builds only
when evaluating or claiming the separate bit-reproducibility property.
