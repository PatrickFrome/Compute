# W60 Host Owner producers — reviewable SOURCE, NOT installed Owner proof

Parent: W52 #1282 `b88f595192e5f40c7b462a85efe37ff441d5a52f`.
Owner branch: `work/metaengine-client-wave10-w60-20261015`.
W57 roadmap remains authoritative; W59 owns integration; W61 owns own-PG birth; W58 owns NTFS backup DACL.

## What is actually wired

- `main.mjs` now constructs all six concrete `trustedNativeOwnerReaders`
  through `createHostNativeOwnerReadersW60`. W52's object/method protocol
  gap is eliminated in real main construction; this is NOT a passing Owner.
- Fixed Windows PID+StartTime census and fixed local executable Authenticode +
  full byte digest are now executable read-only native producers. No caller PID,
  URL, path, process name, shell or query is accepted on the Host wire.
- Existing Host Agent HMAC-authenticated nonce-fenced named-pipe/Unix-socket
  protocol adds `OWNER_NATIVE_READBACK`, producing a native *process-only*
  diagnostic. This explicitly sets `owner_binding_proven: false`.
- Existing Guardian machine bootstrap `status()` is sampled but its old
  boolean `OWNER_BOUND` does not contain Owner PID/birth/generation/epoch:
  that is NEVER promoted to W52's canonical readGuardianOwner receipt.
- The stored device enrollment identity is not elevated to Owner. A genuine
  private Host-custody `readHostOwnerIncarnation` and
  `readPrivateOwnerGatewayCredential` protocol is still absent from the
  installed `SupervisorDeviceIdentity` class. The consumers exist and
  fail closed. This is an explicit unimplemented native authority producer,
  not an implementation of private custody.
- Even valid Windows Authenticode is insufficient: the existing packaged
  trust root lacks pinned installed EXE SHA256, signing thumbprint and signed
  proof identity needed by W60. Until a source-backed, reviewed trust-root
  extension is present, `readSignedInstalledExecutable` returns null, never
  synthesizes `proof_identity` from caller supplied fields.
- `readOwnPostgresBirth` is a narrow W61 callback, strictly nullable pending
  W61 exact provider. No temporary database birth is passed as production.
- W58's constructor-fixed protected backup root/Owner-incarnation must be
  reconciled on W59 integration after W58 exact parent is consumed; no guessed
  user path or unsafe backup root is introduced on this W52-based branch.

## Security limitations / required follow-up

This is a **partial W60 source implementation**. To finish the requested work,
extend the existing Host/Guardian *trusted* custody authority to return a signed
canonical Owner enrollment/proof row and a fixed private Gateway credential
readback without giving model/renderer/public IPC access. Bind exact PID +
kernel birth + immutable incarnation, project/device/epoch, protected archive
root, trusted original executable signer and registered build bytes with
before-and-after generation checks. No new root, privileged service or enrollment
is authorized. Never report installed/LIVE from generated signatures.

Untrusted fields, `verified=true`, device liveness, Guardian READY, synthetic
fixtures or an unsigned Windows installer do not satisfy this contract.

## Executed and CI qualification

Run the `Client Host Owner Producers W60` pull-request matrix on Windows and
Ubuntu at the **W60 commit SHA**, together with W52 and W44 native-context
negatives. Automated unit tests verify default construction, OS read commands,
tamper, PID/birth mismatch, owner transfer/staleness, staging exclusion,
unsigned bytes, protected secret absence, Host IPC HMAC replay/auth and
forged arguments. Tests exercise disposable Node processes and in-memory
witnesses only. These are SOURCE/STAGING receipts, never physical Owner proof.
