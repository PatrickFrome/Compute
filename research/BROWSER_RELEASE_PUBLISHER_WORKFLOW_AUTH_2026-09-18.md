# METAENGINE Browser Release Publisher Workflow-Authorization Checkpoint

Date: 2026-09-18 UTC  
Authority effect: false  
Production/release promotion performed by this checkpoint: false  
Automatic retry allowed: false

## Exact observed state

- Installed Browser version: `0.7.0-dev.35364924124.1`
- Installed source head: `273963cd2b92ced10b6c10c6a44eee75981ee3fa`
- Current release branch head: `9756c06240973c912ec451a188b32989bd6978f2`
- Current release branch: `release/self-update-ambiguity-live-v2`
- Candidate version physically verified by Fast Self Update E2E: `0.7.0-dev.35391417304.1`
- Fast Verified Dev Release run: `35391417347`
- Failed job: `105750399083`
- Failure step: `Create draft from exact tested bytes`
- Failure: `HTTP 403: Resource not accessible by integration`
- Release Evidence Gate for the exact head: SUCCESS
- Fast Self Update E2E for the exact head: SUCCESS
- Full Self Update E2E for the exact head: SUCCESS
- Critical Audit for the exact head: SUCCESS
- Windows Installed Chat Qualification for the exact head: SUCCESS
- Windows Package Smoke for the exact head: SUCCESS
- Windows Autonomous Soak for the exact head: SUCCESS

The failure occurred after artifact, installer, installed executable, verified-self-update manifest,
Guardian staging manifest, Guardian service binary and Guardian configurator binary digests had
all been verified. No draft release was proven created by the failed job.

## Root cause

The publisher workflow already declares:

```yaml
permissions:
  actions: read
  contents: write
```

and is byte-identical between the last successfully published source head
`273963cd2b92ced10b6c10c6a44eee75981ee3fa` and failed target
`9756c06240973c912ec451a188b32989bd6978f2`.

The relevant change is the release target itself. GitHub currently requires a token authorized
to modify workflows when a release target commit adds or modifies files under
`.github/workflows/` relative to the repository default branch. The workflow-local
`GITHUB_TOKEN` cannot be granted that Workflows-write authority.

Observed repository drift at this checkpoint:

- default branch: `main`
- default branch head: `0d1c074c7f513f25000d967761c7bb13912dacaa`
- workflow entries on main: 32
- workflow entries on release head: 96
- differing workflow entries: 67

Therefore repeated runs of the same publisher with the same `GITHUB_TOKEN` are not a valid
repair for this target. The error must not be classified as an ordinary transient API failure.

## Research basis

GitHub REST release documentation states that creating or updating a release whose resolved
target modifies `.github/workflows/` relative to the default branch requires workflow
authorization in addition to ordinary contents write authority. GitHub also documents that
the built-in Actions `GITHUB_TOKEN` cannot be granted that additional workflow authority.

Relevant current documentation:

- https://docs.github.com/en/rest/releases/releases
- https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
- https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens

## Implemented accelerator

Branch: `work/browser-release-workflow-auth-preflight-v1`

Added:

- `apps/metaengine-browser/scripts/release-target-workflow-auth-preflight.cjs`
- `apps/metaengine-browser/test/release-target-workflow-auth-preflight.test.mjs`
- release-check syntax coverage for the preflight script

The preflight consumes two already-fetched GitHub workflow-directory manifests and emits a
bounded receipt:

- `GITHUB_TOKEN_ELIGIBLE` only when workflow manifests are identical;
- `BLOCKED_WORKFLOWS_WRITE_REQUIRED` when any workflow entry differs;
- bounded sorted drift sample;
- `automatic_retry_allowed=false`;
- `authority_effect=false`.

It performs no network action and has no release/publish authority.

## Safe continuation

Supported delivery paths, in order of least architectural disturbance:

1. Provision a dedicated trusted release actor (prefer a narrowly scoped GitHub App installation
   token) with the repository permissions needed for release creation when workflow files differ.
   The actor must remain downstream of the existing exact-SHA release/e2e evidence gates.
2. Converge the default-branch workflow control plane so release targets no longer differ in
   `.github/workflows/`; this is a larger convergence operation and must not be performed merely
   to bypass release authorization.
3. Do not use blind publisher reruns as a repair. A rerun with the same built-in
   `GITHUB_TOKEN` does not acquire the missing workflow authority.

No secret is requested or persisted by this checkpoint.
