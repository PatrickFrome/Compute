# METAENGINE Windows payload: offline qualification harness

**Purpose:** independently establish a file-level origin → packaging destination → cryptographic integrity → consumer record for the five Windows toolchains **Node, Deno, PostgreSQL, Git and Codex**. A partial catalog or a missing staging directory must **not** turn into an installation-ready claim.

**Source constraints:** the specified historical GitHub transfer is `PatrickFrome/Compute`, branch `work/source-transfer-c26565e-20261103`, commit `accb28e72c87c059e780efb8e6681886b33e9b4f`; integrated patch is at `d53ccd4135f28206d91d6804cf0626095565e6af`. This is an older, historical transfer, **not** a claim about current HEAD.

This is an inert stdlib-only Python 3.11+ helper. It never downloads binaries, accesses installed clients, starts installers, real services, databases, or socket listeners, or changes original source. The `tree` subcommand uses Git only in a **new temporary local clone**. No Windows PE execution or signing occurs.

## Offline commands (only after acquiring the exact authorized GitHub bytes)

```bash
python windows_payload_audit.py transfer archive.part00 archive.part01 archive.part02
# Expected archive SHA256: 4200e492828dbb857aaa737a7ce56d0aeda3c97c84f7743b1501ef2f229d3636
# The command checks each Git blob SHA-1 AND the SHA-256 of concatenated bytes in that order.

# After unpacking the verified archive and preparing a local Git checkout:
python windows_payload_audit.py tree \
  --checkout /path/to/disposable/source-checkout \
  --patch /path/to/integrated-c265-to-e30.patch
# Requires source commit c26565e58ab92dcbcda9663c4d231bdf4a9a7ee6,
# source tree 2dbe253e97379532f6f4b52ef7edf26109a9266d,
# expected postpatch tree 90fa5633d7926dd71a7303266073e0625325e740.

# File-by-file proof requires two independently collected inputs from that exact
# source: an authoritative package catalog and a provenance/consumer matrix.
python windows_payload_audit.py inventory \
  --catalog /path/to/generated-package-catalog.json \
  --matrix /path/to/reviewed-file-matrix.json \
  --checkout /path/to/disposable/source-checkout \
  --origin-root /path/to/disposable/origin-bytes \
  --staging-root /path/to/disposable/package-staging

python -m unittest -v test_windows_payload_audit.py
```

## Contract for inventory inputs

Both JSON documents must bind `"source_tree"` to the exact expected **post-patch** Git tree. The catalog is independently derived from the source's authoritative package declaration; it must enumerate **every required file** (not just the five executables):

```json
{"source_tree":"90fa5633d7926dd71a7303266073e0625325e740","files":[
  {"component":"node","package_path":"tooling/node/node.exe"}
]}
```

The example path above is **synthetic** and **not** a claim that METAENGINE uses this packaging path. The catalog must include entries for all five components. The separate reviewed matrix has the same `source_tree` and exactly the same `(component,package_path)` pairs, each with:

- `component`: `node`, `deno`, `postgresql`, `git`, or `codex`.
- `origin_path`: relative path to the immutable input byte file within `--origin-root`.
- `provenance`: reviewed origin identifier (e.g. pinned version + original release/repository source); present but not independently network-attested by the harness.
- `package_path`: canonical POSIX-style path relative to the Windows staging directory.
- `sha256`: pinned SHA-256, checked separately against origin bytes **and** staged bytes.
- `consumer_path`: source checkout file with a concrete reference to the packaged artifact.
- `consumer_literal`: exact literal reference to find in that consumer file.

`consumer_literal` is a static traceability guard, **not** proof of runtime invocation. Dynamic consumers need a separately reviewed integration test. Missing source catalog, source tree, origin bytes or staging bytes cannot be treated as a passing physical check. A matching manually authored catalog alone does **not** prove source closure; it must be generated and independently reviewed from exact production packaging declarations.

The CLI prints JSON rows with `PASS`, `FAIL`, and `NOT RUN` and exits `0` only for all-PASS results; `1` for FAIL; `2` for NOT RUN without FAIL. All tests use tiny invented temporary fixtures and do not exercise actual METAENGINE binaries.

## Known limitation / exact-source gate

The current GitHub connector gives metadata for the 7.2 MB + 7.2 MB + 1.66 MB archive parts but returns no content bytes for the large part; the published patch (1,269,917 bytes) also cannot be read through the available connector. The isolated execution container cannot resolve the GitHub raw hostname. No actual archive SHA256, post-patch tree, package catalog, or staged-file checksum has therefore been independently verified in this run. See `REPORT.md`; real Windows clean install, upgrade, attached database and first useful task remain `NOT RUN`.
