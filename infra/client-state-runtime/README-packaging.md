# Reviewed runtime source bundle

`package-runtime-resources.mjs` stages a **source and Node dependency bundle**.
It is not a portable PostgreSQL distribution, Electron installer, database
backup, automatic startup service or installed-client qualification.

## Review boundary

The caller must supply a sanitized `compute.runtime-startup-manifest.v1`
receipt and its **independently reviewed exact source digest**. The module
does not treat a caller-authored receipt or its self-reported hash as publisher
authority. Obtain the expected digest through the existing review process;
do not derive that trusted input from an untrusted receipt at staging time.

Only source/dependency bytes already selected by that receipt can be copied.
The source set must exactly match the existing `sourceClosure` of three fixed
entry points: the launcher, database API and native supervisor. It preserves
their repository-relative paths, the three runtime lock/metadata files and
the complete reviewed `postgres@3.4.7` Node package. Any additional dependency
file, source drift, duplicate or case-colliding path fails before copying.
Selected files are limited to 16 MiB each and 64 MiB in total.
The current reviewed source set does **not** contain Browser persistent
provider bootstrap, and the bundle does not claim to include it.

The destination must already be an empty, canonical absolute directory,
outside and not an ancestor of the checkout. Files are created exclusively;
existing content is never overwritten or deleted. Symbolic links, junction
aliases and hardlinked files are rejected. On a write failure, a partial stage
can remain for inspection; this module never recursively removes it.
The caller must own the staging directory exclusively through verification,
copying and consumption. Canonical checks are point-in-time checks, not a
defense against hostile concurrent same-user directory replacement.

Private configuration, database data, dumps, runtime binaries and Deno cache
records are not copied. Private paths, known access-token prefixes, private
key markers and password-bearing source connection literals are refused.
These checks are defense in depth, **not a universal secret detector**:
source review remains necessary. The output receipt has relative paths and
digests only; it does not repeat startup PIDs, machine paths or credentials.

## API

```js
import { stageRuntimeSourceBundle, verifyRuntimeSourceBundle }
  from './package-runtime-resources.mjs';

const bundle = await stageRuntimeSourceBundle({
  repositoryRoot,       // canonical absolute checkout directory
  stagingDirectory,     // existing empty external directory
  startupManifest,      // reviewed sanitized startup receipt object
  expectedSourceDigest, // pinned through independent source review
});

await verifyRuntimeSourceBundle({
  stagingDirectory,
  startupManifest,
  expectedSourceDigest,
  expectedBundleDigest: bundle.bundle_sha256,
});
```

`runtime-source-bundle.json` is deterministic for the same reviewed bytes.
Verification needs both the reviewed startup receipt/digest and a pinned
bundle digest; a self-rewritten bundle receipt cannot authorize new files.
Staging does not spawn any process, connect to a database or use the network.

Run `node --test package-runtime-resources.test.mjs` from this directory. The
tests use disposable directories and an import-only child process with no
runtime credentials. Importing the staged launcher/API proves path resolution
outside the checkout, **not** database readiness or a cold installed launch.

## Before A Packaged Cold Start

No production Electron builder configuration changes are made here. A later
reviewed release step must place runtime resources outside ASAR and resolve
them from `process.resourcesPath`, not the current working directory. Electron
does not support an ASAR directory as a subprocess working directory, and
binary spawning within ASAR has restrictions. Source layout preservation
alone does not make a runtime relocatable.

PostgreSQL needs more than `postgres` and `psql`: build-dependent `bindir`,
`sharedir`, `pkglibdir`, `libdir`, extensions and dynamic libraries, potentially
including ICU, zlib and OpenSSL, require complete provenance and platform
qualification. Node, Deno, its frozen offline npm cache, license material,
database restore/init, protected local configuration and reboot ownership
remain separate work. No automatic download, install, profile write, machine
startup registration or fallback to Supabase is introduced.

Official references:

- [Electron process.resourcesPath](https://www.electronjs.org/docs/latest/api/process#processresourcespath-readonly)
- [Electron ASAR limitations](https://www.electronjs.org/docs/latest/tutorial/asar-archives)
- [PostgreSQL 17 pg_config directories](https://www.postgresql.org/docs/17/app-pgconfig.html)
- [PostgreSQL 17 build requirements](https://www.postgresql.org/docs/17/install-requirements.html)
