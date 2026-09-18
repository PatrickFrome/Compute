# METAENGINE Browser Shell — Step 1 research checkpoint

Status: implementation candidate; no release/verification claim.

## Goal
Provide a dedicated desktop browser surface where the operator can sign in to ChatGPT while preserving the existing A2 Compute Browser as the primary trusted execution kernel.

## Pre-step findings
- Electron 44 uses `BaseWindow` + `WebContentsView`; `BrowserView` is legacy/deprecated.
- Persistent web login state belongs in an explicit `persist:` session partition.
- Remote web content must have Node integration disabled, context isolation and Chromium sandbox enabled.
- Permission and new-window/navigation handling must be explicit; remote pages must not reach privileged app-local schemes.
- B5 already exposes an authenticated typed loopback HTTP bridge. The shell must consume that protocol rather than expose raw CDP or browser process internals.
- USER_SPACE and COMPUTE_SPACE remain distinct. No cookie/session migration from the shell into B-line profiles is introduced.

## Step 1 boundary
- Electron shell with managed tabs and initial ChatGPT tab.
- `persist:metaengine-user-v1` session for normal user web/auth state.
- HTTPS browsing and loopback HTTP development URLs only.
- `metaengine://shell` privileged local UI scheme is inaccessible from remote tab navigation.
- all remote site permissions denied in this first slice; downloads disabled until the Artifact Plane exists.
- B-line bridge integration is health/read-only only; no shell-side actuation.

## Invariants
- `USER_SESSION_IS_NOT_COMPUTE_PROFILE`
- `REMOTE_RENDERER_HAS_ZERO_NODE_AUTHORITY`
- `REMOTE_PAGE_CANNOT_NAVIGATE_TO_PRIVILEGED_SHELL`
- `COMPUTE_BRIDGE_TOKEN_NEVER_REACHES_RENDERER`
- `SHELL_DOES_NOT_EXPOSE_RAW_CDP`
- `SHELL_CANNOT_MINT_ACTUATION_AUTHORITY`
- all existing A2 Browser hard invariants remain unchanged.

## Non-claims
- no claim that every ChatGPT authentication provider works in embedded Chromium yet;
- no autonomous ChatGPT fleet provisioning in the desktop shell yet;
- no browser downloads/artifact ingestion yet;
- no compute actuation from shell UI yet;
- no remote browser B7 scheduler in this step.
