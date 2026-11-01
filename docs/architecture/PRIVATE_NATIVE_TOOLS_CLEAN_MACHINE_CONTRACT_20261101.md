# Private Git/Codex package contract

Base audited: `0e43a569ad52134bee65dea3182ee9a4c4bbc56f`, tree
`897948a6e65c980f560f97b71abaca96c91e4069`. The base packaged only the
Codex process helper, and managed Git used ambient PATH. This change supplies
complete package-owned Git/Codex trees and implements host-only consumer injection. Main integration is owned by
the coordinating stream after the new offline-bundle contract is agreed.
It does not qualify a Windows installation or the effective CLI security policy.

## Producer and release inventory

`scripts/stage-private-native-tools.mjs` is build-only. It acquires the exact
GitHub releases/assets in `build/private-native-tools.lock.json`, verifies the
archive byte size and SHA-256, safely extracts all members, and adds pinned
original license/notice files. No downloaded binary runs during staging.

* Git: official MinGit `2.56.0.windows.4`, release `423939713`, asset `677312705`.
  Archive SHA-256 `e3bf78351fe777fba47ddee5950082f8a98bb0f02604fdc7ba3ee2cb68ffa877`.
* Codex: official full `rust-v0.166.0` package, release `428320524`, asset
  `689710836`. Archive SHA-256
  `d559bb88e74d471265857b93b7f19bc250dae527673b9191b33534478093f6bc`.

The full official Codex package is required: the standalone executable archive
omits helpers, rg, and other resources. Full Git DLL/libexec/config/CA/license
and Codex helper/resource/license trees are retained. Original bytes are not
patched or claimed to carry a locally verified vendor signature. The source
lock also pins each complete extracted inventory, including added notices.
Reused staging must match these pins, preventing an incomplete self-consistent
manifest from being repackaged.

`electron-builder-before-pack.cjs` stages/verifies this output and puts
`metaenginePrivateNativeTools` in integrity-protected package metadata:

```
{schema:"metaengine.private-native-tools.binding.v1",
 manifest_sha256, manifest_bytes, file_count}
```

`extraResources` copies `native-dist/private-native-tools` to
`resources/private-native-tools`. The existing W77/W68 full installed-image
inventory already includes every resource and therefore covers these bytes.
No separate signing root, service, readiness flag or exclusion is introduced.
The adjacent manifest is data; it has authority only through the existing
ASAR/release-proof binding. Runtime refuses a missing binding/payload; it never
acquires a missing tool or falls back to a global installation.

## Bootstrap producer / Main consumers

Bootstrap owner must obtain `readPackagedPrivateNativeTools({app,resourcesPath})`
from `src/private-native-tools.mjs`. The private host capability contains:

```
{gitExecutable,cliExecutable,gitExecutableSha256,cliExecutableSha256,
 environment,revalidate}
```

Use the existing protected operator-config publisher to write these exact paths:

* `cli_executable = <resources>/private-native-tools/codex/bin/codex.exe`
* `git_executable = <resources>/private-native-tools/git/ucrt64/bin/git.exe`

Keep `codex_home`, journals, temporary roots, result indexes and sandbox receipts
in their existing protected mutable state locations. This stream does not create
credentials, enrollment data, ACLs or operator files. Internal enrollment stays
on the existing trust chain; external login and Windows UAC remain legitimate
user steps. Do not copy a preinstalled CLI's authentication or modify user Git,
PostgreSQL, Guardian, registry, global PATH or user configuration.

Main integration must reject protected operator paths pointing to any other
installation. It must pass the capability to managed repository configure/read
and fixed-plan execution, native runner and native host observers. This stream
leaves Main unchanged after the coordinating owner proposed the new versioned
offline-bundle contract; packaged Main must not be declared qualified until
that integration is complete. The sandbox-probe API also
accepts `privateTools`; the bootstrap owner must pass the same capability to
`runCodexCliSandboxProbe({privateTools,...})` before publishing actual receipts.
Legacy source/developer APIs retain their explicit external-tool behavior;
the new packaged Main integration must supply the private capability and must
not use that default. Historical read-only recovery/backup must not acquire or
require new CLI/Git/sandbox state.

The child-only environment selects private Git/rg/helpers/CA/OpenSSL paths and
fixed OS directories. It is not merged with ambient PATH. Package verification
checks every file byte initially and fences full file/directory metadata before
each relevant process use. Once drift occurs that capability stays invalidated.
This is on-disk byte protection, not proof of native loaded-image custody;
the existing native-custody workstream must still provide its own guarantees.

## Effective CLI producer handoff

The pinned artifact is unmodified upstream Codex. No effective-policy receipt,
login success, sandbox readiness or live execution is inferred from its presence
or `--version`. If the effective CLI producer needs a reviewed upstream patch,
it must update the release source/artifact binding and complete inventory pins
and preserve the license/notice closure. A locally changed CLI must never be
labelled as the vendor-signed artifact above. Runtime permits still bind the
actual CLI executable SHA; a mismatch fails closed.

## Evidence and remaining qualification

Linux byte/staging verification downloaded both official Windows artifacts and
checked their SHA-256 before/after safe extraction. Output contains 375 Git files
and 50 Codex files (including four added original notices). Combined manifest:
SHA-256 `9454eb967bd19b38ee74222733a1b12fbacbdd4b84dc8ca5ecbb948ba102fef7`,
80581 bytes, 425 files. No Windows executable was run on Linux.

Required Windows validation remains:

1. Build/package the exact integrated SHA with the normal release signer and
   validate the installed full inventory and loader/custody proofs.
2. On disposable supported Windows with global Node/Git/Codex absent, verify
   private Git/CLI/helper startup with empty/decoy PATH and original version
   outputs. Use build tools only for the test harness, never as client inputs.
3. Exercise the existing fixed Git worktree operations; tamper/remove a DLL,
   helper, CA/config or manifest and demonstrate refusal with no global fallback.
4. Bootstrap publishes the protected operator paths and actual sandbox receipts;
   the effective-policy producer validates the same working CLI launch.
5. Execute the real clean-machine installer scenario without prior METAENGINE
   services/config/data, then legitimate external login and complete workflow.
   A hosted runner containing development tools is not that clean-machine proof.

Publication of this stream's branch/Draft PR remains pending the coordinator.
No main merge, client installation, real credential creation or OS-security
change is performed by this stream.

## Coordinating offline-bundle v2 proposal

The Main owner proposes including these components in the versioned existing
`client-state-runtime` inventory. Actual verified portable layouts require:

* `executables.git = runtime/git/ucrt64/bin/git.exe`
* `executables.codex = runtime/codex/bin/codex.exe`
* `paths.gitExecutable` and `paths.codexExecutable` from that verifier.

The producer output's component-relative files map directly to
`runtime/<component.id>/<row.path>`. Each original row has `path`, `bytes`,
`sha256`; the existing bundle producer adds its established `component`, `kind`
and component-origin representation. Origin material is the exact repository,
tag, release_id, asset_id, archive_name, archive_bytes, archive_sha256 and pinned
full-inventory hash from the source lock. PostgreSQL's existing binding is
unchanged. Preserve v1 reading/recovery; fresh execution requires v2 payloads.

This branch implements a self-contained extraResources/ASAR binding for the
actual 0e43 base because its offline bundle has no Codex/Git fields. If the
coordinator selects the proposed v2 placement, adapt/omit this branch's
`electron-builder.test.json` and `electron-builder-before-pack.cjs` resource
wiring and consume the producer from the existing bundle builder. Avoid
shipping duplicate trees. The Main/offline-bundle owner must provide the same
private capability semantics from its verified full inventory. No public
`verified`/mode flag can replace that proof.

Final Linux validation on this worktree: related 1310-test run completed
1283 PASS, 27 explicit platform/optional skips, 0 failures; source checker
276 PASS. This included real offline staging of both pinned vendor archives.
The optional actual Windows payload-startup test is checked in as
`test/private-native-tools-windows.test.mjs`; it was skipped on Linux.
An independent final review confirmed closure of the three resolver findings
(path aliases, incomplete inventories, manifest replacement window).
No Windows binary execution or installation evidence is claimed.

Additional read-only static import audit: 220 PE files and 381 private DLL
import edges resolve from each importer directory or the actual private PATH;
no private dependency was found only in an unrelated payload directory. The
94 remaining external Windows/API/CLR names still require Windows loading
qualification. Codex voice's 26 runtime libraries and vcruntime140.dll match
the vendor's included inventories. This is not a loaded-image attestation.

MinGit's optional GCM 2.9.1 targets .NET Framework 4.7.2 (its managed imports
include mscoree.dll). It is not an app-local self-contained CLR. Preserve
GIT_CONFIG_NOSYSTEM=1 and GIT_CONFIG_GLOBAL=NUL: the shipped etc/gitconfig
otherwise includes Program Files Git configs and credential.helper=manager.
The Windows startup test also checks GCM --version without login or credential
creation. The OS baseline/CLR, helper/voice loading and actual sandbox bootstrap
remain Windows qualification requirements.
