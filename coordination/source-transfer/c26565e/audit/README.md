# METAENGINE e30 Windows payload: historical source-only qualification

This PR audits **Node, Deno, PostgreSQL, Git and Codex** on the **historical**, not-current GitHub reconstructed tree. The verified `METAENGINE-e30-github-only-source.zip` was provided through an authorized ChatGPT Space Library file. **No installation readiness** is claimed.

- Exact Space archive SHA-256: `169f4dc6379605d68d34360c9d28d687b4da3dc856aea6fc1fb27e6bc6d3ba06`.
- Independently computed Git tree: `90fa5633d7926dd71a7303266073e0625325e740`; **4,346 tracked files**, including **74 executable modes (100755)**.
- GitHub origin: source transfer `accb28e72c87c059e780efb8e6681886b33e9b4f`, then integrated patch `d53ccd4135f28206d91d6804cf0626095565e6af`.
- Source producer, exact destination and consumer mapping for the **44 explicit minimum required files**: [PACKAGE_FILE_MATRIX.md](./PACKAGE_FILE_MATRIX.md).
- Detailed source/physical evidence and PASS / FAIL / SKIP / NOT RUN accounting: [REPORT.md](./REPORT.md).
- Narrow synthetic PostgreSQL fixture regression: [fixture-pg10-regression.patch](./fixture-pg10-regression.patch).

## Run the read-only ZIP verifier

Python 3.11+ and Git are required; Git is invoked only in a **new temporary, disposable directory** to create an index and compute a tree. ZIP bytes, SHA-256, file count, execute modes and Git tree are checked. No vendor executable, installer, service, database, user PC, listener, or remote process is launched.

```sh
python windows_payload_audit.py snapshot --archive /path/to/METAENGINE-e30-github-only-source.zip
python -m unittest -v test_windows_payload_audit.py
```

Expected ZIP result: **3 PASS** (`zip.sha256`, `zip.files-modes`, `zip.tree`). Synthetic unittest result: **10 PASS**.

The older `transfer` and `tree` commands remain available for independent reconstruction from the original three split GitHub parts and separate patch **if those bytes are independently obtained**; those earlier split-archive SHA checks were not rerun with the restored ZIP. They are not prerequisites for byte-verified evidence from the supplied recovered ZIP.

## File-level physical inventory is a separate gate

The `inventory` command consumes **independently reviewed** `--catalog` and `--matrix` JSON, both bound to source tree `90fa5633d7926dd71a7303266073e0625325e740`, plus optional `--origin-root`, `--staging-root`, `--checkout`. The catalog enumerates every mandatory packaged file for all five components; the matrix contains a nonempty source provenance, relative packaged path, exact SHA-256, source consumer path and literal. Example *synthetic* format:

```json
{"source_tree":"90fa5633d7926dd71a7303266073e0625325e740","files":[
  {"component":"node","package_path":"client-state-runtime/runtime/node/node.exe"}
]}
```

For a real run, **all five components and every dynamically included file** are required. The present [44-row matrix](./PACKAGE_FILE_MATRIX.md) is an explicit minimum only, not the authoritative physical catalog. Without real pinned vendor ZIP/TAR archives and independently observed staging bytes, `inventory` returns **NOT RUN** (nonzero exit), not PASS; static source/consumer references cannot prove Windows execution. The repo's private tool full-inventory expectations are approximately **375 Git** and **50 Codex** files, not just an executable.

## Inert test scope and correction

The historical `infra/client-state-runtime/native-tools-installed-binding.test.mjs` fixture included 5 PostgreSQL CLI placeholders, while the current verifier demanded 10. The reviewed patch only changes that test fixture and adds a negative missing-`pg_dump.exe` regression; production assertions and trust gates are unchanged. The patch is provided separately because this GitHub PR base holds the historical original snapshot in compressed transfer artifacts, not individual working-tree production source files.

Source diagnostics were run on Linux Node **22.16.0** (the app expects **>=24**), Python **3.13.5**, Git **2.47.3**. Targeted Node results after fix: **65 PASS / 1 FAIL** (missing local `@electron/asar`) / **4 SKIP**. The independently verified source archive, source-level matrix and fixture corrections do **not** qualify a physical Windows installer. Actual vendor bytes, packaging, PE/installer, clean install, update and first useful task are **NOT RUN**.

No secrets, user data, deployment action or merge are included.
