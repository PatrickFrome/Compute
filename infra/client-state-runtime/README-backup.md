# Read-only backup verification

`backup-verifier.mjs` checks an exporter backup against its actual bytes and a
separately measured restore report. It performs no network requests, restore,
publication, upload or file writes.

```text
node infra/client-state-runtime/backup-verifier.mjs ABSOLUTE_BACKUP_ROOT PROJECT_REF [ABSOLUTE_RESTORE_REPORT] [EXPECTED_MANIFEST_SHA256]
```

The program prints a JSON result. Keep that result private: table inventory,
local instance identity and configuration may disclose private project state.
The CLI exits nonzero when the database archive or Storage bytes are incomplete.
Callers requiring proven restore must additionally require `database_complete`;
an exit code alone is not a restore acceptance gate.

`verifyBackup({root, expectedProject, restoreReportPath, expectedManifestSha256})`
supports `metaengine.full-database-backup.v1` from the full exporter. File names
must remain within the absolute backup root; symlinks, junctions, duplicate
manifest entries and path traversal are refused. Each manifest-bound file is
streamed through SHA-256 and its length checked. File changes during hashing
fail verification. PostgreSQL archive/SQL/role/TOC headers are checked as format
indicators; they do not replace a real `pg_restore` operation.

Result distinctions:

- `archive_integrity_verified`: all declared files match their manifest hashes.
- `database_archive_complete`: required database parts, exporter stages and a
  valid same-snapshot table inventory with row counts and content digests exist
  and pass checks.
- `restore_data_complete`: the independently supplied report binds the exact
  source dump, inventory and snapshot; all restored tables have the exact source
  row count and `content_md5`, without missing or extra tables.
- `restore_schema_exact`: the restore producer explicitly checked schema and
  declared no DDL adaptations. This producer claim is separate from content
  equality; independent authentication remains unproven.
- `database_complete`: archive, data restore and schema exactness all pass.
- `storage_bytes_complete`: bucket/object counts match source Storage inventory,
  every unique object has its exact downloaded bytes and digest, and the exporter
  declared full object capture.
- `platform_metadata_complete`: configuration/secret metadata, deployed-function
  inventory and downloaded Edge sources are all manifest-bound and exported.
- `platform_recovery_complete`: always false in this format because role password
  hashes and Edge secret plaintext are excluded, and platform capture occurs
  after the transactional database snapshot.

Restore report format:

```json
{
  "schema": "metaengine.database-restore-report.v1",
  "source_project": "jhriwwsryeqsvvvufkok",
  "source_snapshot_id": "actual-exported-snapshot-id",
  "source_dump_sha256": "actual-dump-sha256",
  "source_inventory_sha256": "actual-inventory-sha256",
  "tables": [
    {"schema":"public","name":"actual_table","rows":"12","content_md5":"actual-content-md5"}
  ],
  "errors": [],
  "ddl_adaptations": [],
  "schema_verified": true
}
```

All counts and digests must be measured from the restored database. The table
content query must use the exporter's deterministic ordering and UTC session:
`md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),''))`.
Reports with DDL/extension adaptations can verify data preservation but cannot
claim exact schema restore. Copying the source inventory into the report is not
a restore measurement; this verifier checks declared bindings and consistency,
not the honesty or independence of the report producer.

Optional `expectedManifestSha256` binds an externally retained manifest digest.
Without a separate trust anchor an attacker could replace both objects and the
manifest. Even with that digest, source authenticity is not attested by this
module. `data_policy` remains `LOCAL_PRIVATE` and `remote_export_allowed:false`.
Sensitive dumps, rows, object bytes and keys must never become GitHub artifacts.

Run `node --test infra/client-state-runtime/test/backup-verifier.test.mjs` for
tampering, incomplete archives, source mismatches, equal-count content drift,
DDL adaptations, Storage and traversal checks.
