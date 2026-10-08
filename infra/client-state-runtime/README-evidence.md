# Local evidence archive

`evidence-archive.mjs` stores private, content-addressed evidence next to the
client-owned database. The archive has no HTTP client, upload, GitHub publication,
or authority/promotion operation. Keep its root outside the Git checkout,
release package and public output folders.

```js
import { createEvidenceArchive } from './evidence-archive.mjs';

const archive = await createEvidenceArchive({ root: absolutePrivateArchivePath });
const receipt = await archive.put({
  kind: 'RESTORE_VERIFICATION',
  content: actualRestoreResult,
  source: {
    repository: 'PatrickFrome/Compute',
    commit: actualCommit,
    treeSha256: actualSourceTreeDigest,
    dirty: true,
    provider: 'CLIENT_POSTGRES',
    instance: actualRuntimeInstance,
    acquiredAt: new Date().toISOString(),
  },
});
const { bytes, integrity } = await archive.get(receipt.evidence_id);
```

The caller must measure the actual source tree and preserve how that digest was
computed. A commit alone does not identify local edits. The archive cryptographically
binds the caller-supplied source descriptor to the receipt; it does not independently
attest repository identity or the truth of a restore/test claim.

`put()` accepts JSON values, strings, Buffers or Uint8Arrays. Its default limit
is 64 MiB per object, configurable up to 512 MiB. Media types are JSON, SQL,
octet-stream and plain text. `get()` rechecks both receipt and object digests;
`list({ limit })` returns verified receipts, with a limit between 1 and 1000.
Objects are deduplicated by byte digest. Receipts also bind kind, source and
verification claims, so identical bytes from different sources have distinct
evidence identities.

Optional `verification` must have exact keys `method`, `result`, `verifierId`,
`verifiedAt`, `independent`, and `subjectSha256`. Its result is `PASS`, `FAIL` or
`UNVERIFIED`, and its subject digest must equal the actual bytes. These are
explicit caller claims. Every computed readback retains
`source_authenticity_attested:false`, `semantic_truth_verified:false`, and
`authority_effect:false`; every receipt retains `promotion_authorized:false`.

Archive directories contain `objects/<sha256>.bin` and
`receipts/evidence_sha256_<sha256>.json`. File publication uses an exclusive
temporary file followed by a hard link, avoiding partially published objects or
replacement of existing evidence. The filesystem must support hard links
(including Windows NTFS). Symlink/junction directories and nonregular files are
refused. Directory and file permissions request owner-only POSIX modes; Windows
access remains governed by the parent directory's ACL. Use a private client data
directory with the existing client-user ACL.

Database dumps, table rows and secrets must never be sent to GitHub by copying
this archive into an artifact. `data_policy.classification` is always
`LOCAL_PRIVATE`, and `remote_export_allowed` is always false. Publishing public
CI/release evidence is a separate, explicitly redacted producer workflow.

Run `node --test infra/client-state-runtime/test/evidence-archive.test.mjs` for
concurrent publication, source identity, tamper detection, bounds and Windows
junction checks. Hash integrity is not encryption or an independent backup.
