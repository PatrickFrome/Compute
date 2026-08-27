# W1 Host Safety Package Supply Chain — research checkpoint

Status: deterministic local package implementation; no live cloud provisioning authority.

## Goal

Produce one content-identifiable W1 safety runtime that can later be delivered by different provisioning backends without changing the capture/admission trust contract.

The current source lock is:

- commit: `73ab09c75b71a6ea40f11e953cbcf9d9b94b9a89`
- tree: `c8ae850c8ce2ab9f688ae0525cbce55d39186d78`
- runtime install root: `/opt/metaengine/w1/safety/73ab09c75b71a6ea40f11e953cbcf9d9b94b9a89`
- execution user: `metaengine-w1`
- writable workspace: `/var/lib/metaengine/w1/workspace`

## Deterministic package design

`controller/w1/build_host_safety_package.py`:

- accepts no source revision, package root, execution user, or workspace from the caller;
- verifies each runtime source against its expected Git blob identity before packaging;
- computes per-file SHA-256 and a canonical payload lock;
- writes a ZIP with sorted entries, normalized timestamp and fixed Unix modes;
- emits a package SHA-256 receipt;
- includes fixed `install.sh` and `uninstall.sh`;
- grants no AWS, Supabase, reboot, admission, or runtime authority itself.

The installer runs only as root provisioning authority. Before copying any payload it recomputes the payload lock, SHA-256 values and Git object identities. Installed runtime files are root:root `0444`; package directories are root-owned/read-only; the dedicated workspace is `0700` and owned by `metaengine-w1`.

Uninstall removes only the immutable runtime version. It deliberately does **not** delete the dedicated account or workspace because worker identity/state lifecycle is separate from package lifecycle.

## AWS Distributor research

AWS Systems Manager Distributor Advanced packages require Linux `install.sh` and `uninstall.sh` at the ZIP root and a manifest that records SHA-256 checksums for ZIP assets. Distributor package manifests also have explicit package versions.

References:
- https://docs.aws.amazon.com/systems-manager/latest/userguide/distributor.html
- https://docs.aws.amazon.com/systems-manager/latest/userguide/distributor-working-with-packages-create.html

This makes Distributor a viable **provisioning backend** for the deterministic archive.

However, one-time Distributor installation is performed through the generic, parameterized `AWS-ConfigureAWSPackage` Run Command document. That is a materially broader authority surface than the W1 parameterless safety capture document and therefore must never be added to the capture session role.

Reference: https://docs.aws.amazon.com/systems-manager/latest/userguide/distributor-working-with-packages-deploy.html

## Architectural decision

Separate the roles:

- **package builder** — local/reproducible, no cloud authority;
- **provisioning principal/session** — may install one exact package version/hash on one exact candidate host;
- **capture principal/session** — may only run the exact parameterless safety capture document against the exact tagged host;
- **verification plane** — recomputes evidence and persists a dedicated non-authority verification receipt;
- **admission plane** — reads persisted receipts and never trusts caller-supplied booleans.

Distributor, a custom S3 provisioner, an AMI bake, or offline image construction may later implement the provisioning role. None of them may change the package source lock or capture semantics without a reviewed package version change.

## Why not embed the entire runtime in the SSM capture document

SSM document content is limited to 64 KB. More importantly, embedding runtime bytes in the capture document would couple transport authority and runtime code identity. Keeping a separately content-addressed package preserves a smaller reviewable capture document and allows package provisioning to be audited independently.

Reference: https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_CreateDocument.html

## Verification matrix

Required CI properties:

1. Two builds from the same source produce byte-identical ZIPs and identical receipts.
2. ZIP contains only the fixed expected entries and normalized modes/timestamps.
3. Every source file has SHA-256 and expected Git object identity in the payload lock.
4. Installer rejects non-root invocation and verifies all payloads before mutation.
5. Installed runtime is root-owned/read-only; workspace is dedicated-user-owned `0700`.
6. Installed bundle executes as non-root and remains non-authoritative.
7. Uninstall removes runtime but preserves workspace/state.
8. Builder source contains no external control-plane client.

## Remaining gap

This closes reproducible package construction, not live provisioning. A future provisioning contract must bind an independently authenticated AWS principal to one exact package SHA-256/version and one exact host, and must remain disjoint from the capture role. No W1 verification should advance merely because a package artifact exists or installs successfully on CI.
