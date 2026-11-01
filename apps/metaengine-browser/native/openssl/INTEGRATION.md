# Same-build native consumer integration

Scope: canonical C2, Level-2 T0_HERMETIC_TOOLCHAIN_CONTRACT (source/build
integration evidence only; no milestone or installed-runtime promotion).
Consumer base: `9e1b4818aec7c0c7bfe6427be1706a67c47d23c1`.
Producer source: `845732d8cc1f47787d5ce4be1bf1fed42eafc28d`, delta from
`6af8ba9b309fa4725f3d06ee4a94fe52ba1f1d09`.

`build-guardian-native-package.ps1` invokes the existing authenticated OpenSSL
producer once, then the existing service, peer and bootstrap builders in the
same PowerShell process. Example from a clean Windows checkout:

```powershell
./apps/metaengine-browser/scripts/build-guardian-native-package.ps1 `
  -SourceDir C:\qualification\authenticated-source `
  -CryptoOutputDir C:\qualification\empty-crypto-output `
  -OutputRoot C:\qualification\native-package `
  -TestLinkedNamespace
```

The source directory comes from `acquire-guardian-openssl-source.py` at the same
HEAD, using the official **public** OpenSSL certificate. It is not a METAENGINE
signing private key. Python 3.11+, Node 24+, native Windows Perl, GPG and MSVC must
already exist on the build host. No installed client compiles or acquires source.

The module records the identity of a fresh in-memory build context only after
the producer succeeds. Callers cannot deserialize JSON or supply a directory to
import an old build. Before and after linkage, the byte checker compares actual
pinned source archives/signature, lock copies, GPG evidence, certificate copies,
source head, verifier source, complete artifact inventories and public header.
The proof digest is captured on return from the producer and must remain exact.
Read handles deny artifact write/delete sharing through all consumers. This is
a trusted build-host orchestration boundary, not protection against an attacker
who can execute arbitrary code inside that build process or replace its tools.
The Python byte checker alone is explicitly not authentication/build provenance;
actual GPG and compilation remain the existing producer's responsibility.

Both the service and Node-API peer compile the existing namespace with
`METAENGINE_GUARDIAN_RELEASE_SIGNATURE_LINKED`, `/MT`, and the exact production
`guardian-release-signature.lib` and `libcrypto.lib`. The public header used by
the consumer must equal the producer's staged header. The configurator, elevated
bootstrap and origin coordinator do not call this verifier and get no crypto
linkage. The bootstrap accepts only service/configurator/manifest files
registered by the same context and still embeds those held bytes as resources.
Final service/peer linker maps must contain the production verifier and EVP
implementation from their archives, so an unused library argument cannot count
as linkage. PE reports enforce x64 and a system-DLL allowlist; OpenSSL,
Node, dynamic CRT and other external DLL imports fail the build. OpenSSL notices
are copied into the native service staging directory.

The packaging hook calls this orchestrator and then reads the actual staged
service, peer and bootstrap bytes back. It compares their digests, lengths,
source/version and common crypto binding. These JSON records are evidence;
they are never runtime admission capabilities. The nested binding uses
`contract` and `build_source_head` because the native peer's bounded staging
reader requires unique `schema`, `source_head` and `package_version` keys across
the entire document.

For direct packaging, set `ME2_GUARDIAN_CRYPTO_SOURCE_DIR` to the authenticated
source directory; optionally set `ME2_GUARDIAN_CRYPTO_OUTPUT_DIR` to a fresh empty
build output directory outside the checkout. Package Smoke acquires source in
its Linux preflight, before reserving a package version, using the non-secret
repository variable `GUARDIAN_OPENSSL_SIGNING_CERTIFICATE_B64`. It hands that
source to the Windows job in the same workflow run; the producer independently
reauthenticates it offline. No certificate is synthesized or fetched from a
private service. Missing certificate/source fails closed. Other legacy package
callers must provide the same source input; they have no implicit unlinked
fallback. The dedicated static-crypto dispatch lane uses its existing public
certificate input and runs the actual package builders plus linked namespace
negatives. Its producer-only proof correctly continues to say that the producer
itself did not link the service; final linkage evidence lives in native manifests.

The existing independent Windows mechanics workflows explicitly request
`-UnlinkedTestBuild`. Both missing mode and simultaneous linked/unlinked modes
are errors. Such outputs are marked and rejected by production packaging. The
unlinked namespace control and PR1422 quoting, exact oversized HELLO errors and
Node-API byte attributes are preserved. Linked namespace tests additionally
exercise missing/noncanonical envelopes, invalid/noncanonical Base64, zero
signatures and a public RFC signature against the unchanged production root.
Mandatory linked cases cannot skip. The existing mechanical mutation/ACL/oplock
cases run in the same probe. RFC vectors and synthetic byte-binding fixtures
are not production-root positive evidence.

Source/unit checks, Linux native signature tests, Windows MSVC/upstream/PE/runtime
qualification and installation are separate evidence classes. The public
certificate and actual Windows run remain prerequisites for the latter build
qualification. A successful build still does not qualify production-root
positive signatures, release freshness/rollback policy, Authenticode signer
binding, authenticated external placement, first Owner, installed namespace
custody, loaded code, or MAIN launch. No trust root, signature semantics, release
policy or runtime admission behavior is changed here.
