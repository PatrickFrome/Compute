# A1 Zero-Spend Execution Fabric

Status: **PREPARED / NON-AUTHORITY**

This lane uses two independent CI providers for the same H205F22 execution contract:

- GitHub Actions — primary ephemeral executor for the public `PatrickFrome/Compute` repository.
- AppVeyor — independent hosted Linux witness for cross-provider reproduction.

Neither provider satisfies `W1_PERSISTENT_LINUX_WORKER_SAFETY`. Both are ephemeral CI execution substrates.

## Common contract

Both providers run:

```text
coordination/execution/zero_spend_runner.py
```

The runner:

1. reads the provider-supplied exact commit SHA;
2. proves `git rev-parse HEAD` equals that SHA;
3. records the Git tree SHA;
4. requires a clean tracked tree before execution;
5. runs the same A1/PAP/guard regression set;
6. emits a provider-neutral result hash;
7. emits a provider-specific evidence manifest without environment dumps or credentials.

The provider-neutral hash is intended for cross-provider comparison. A mismatch does not automatically identify which provider is wrong; it opens a disagreement/reproduction investigation.

## Evidence classes

A successful run may claim only:

```text
LIVE_EPHEMERAL_CI_EXECUTION_NON_AUTHORITY
```

It must not claim:

- persistent worker proof;
- W1 verification;
- provider reboot proof;
- project authority;
- canonical state.

All manifests carry:

```json
{
  "execution_authority": false,
  "canonical": false,
  "authority_effect": false,
  "persistent_worker_proof": false,
  "w1_verified": false
}
```

## GitHub Actions

Workflow:

```text
.github/workflows/a1-zero-spend-execution.yml
```

It runs on the standard Ubuntu 24.04 GitHub-hosted runner and uploads:

```text
evidence/github-actions-zero-spend.json
```

The repository is public, so this lane is intended for software-development lifecycle work only: build, test, regression, reproducibility and project evidence. It is not a generic hosted-compute service.

## AppVeyor

Configuration:

```text
appveyor.yml
```

The config selects:

```text
image: Ubuntu2404
```

and uploads:

```text
evidence/appveyor-zero-spend.json
```

No AppVeyor secret is required for the build itself. The public GitHub repository must first be added to an AppVeyor account/project. Until an AppVeyor build is independently observed, the AppVeyor lane remains:

```text
CONFIGURED / NOT LIVE
```

### AppVeyor activation

1. Sign in to AppVeyor with GitHub.
2. Authorize public-repository access only if that is sufficient for the account.
3. Add `PatrickFrome/Compute` as a project.
4. Leave repository configuration sourced from root `appveyor.yml`.
5. Register the AppVeyor webhook in the GitHub repository. As of 2026-08-23 this step is reported complete; the endpoint value is intentionally not stored in the repository.
6. Trigger one build of the current A1 branch or `main` after merge.
7. Download/read `a1-appveyor-zero-spend-evidence`.
8. Compare its `provider_neutral_result_sha256` with the GitHub Actions artifact for the exact same Git SHA.

Do not store GitHub PATs, Supabase service-role keys, OpenAI keys, webhook ingress URLs, or other project secrets/sensitive endpoints in `appveyor.yml` or evidence artifacts.

## Cross-provider acceptance

A cross-provider result is comparable only when all of the following are identical:

- exact Git SHA;
- tree SHA;
- execution-contract SHA-256;
- provider-neutral result SHA-256.

Initial target:

```text
GitHub Actions PASS
+
AppVeyor PASS
+
same Git SHA
+
same provider-neutral result hash
=
CROSS_PROVIDER_REPRODUCED
```

`CROSS_PROVIDER_REPRODUCED` is execution evidence only. It still has no project-authority effect.
