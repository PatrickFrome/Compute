# Clean-machine bootstrap integration

Base: `0e43a569ad52134bee65dea3182ee9a4c4bbc56f`, tree
`897948a6e65c980f560f97b71abaca96c91e4069`.

This is source/staging implementation evidence. It does not qualify a Windows
installation, authenticate a release publisher, approve elevation, or authorize
an external account. GLM is not a prerequisite.

## Prerequisites before and after installation

| Component | Clean PC before install | Delivered/configured by METAENGINE |
| --- | --- | --- |
| Browser | Absent | Existing signed installer and integrity-protected ASAR |
| Guardian | Absent | Existing embedded native bootstrap and service install; authenticated Owner bridge still required |
| PostgreSQL 17 | Absent | Existing pinned offline runtime, private owned cluster, random own ports, roles, schema/migrations, Vault and device enrollment |
| Node / Deno | Absent | Existing pinned offline runtime; no global PATH selection |
| Git | Absent | Full pinned MinGit tree in `resources/native-tools/git` |
| Codex CLI | Absent | Full canonical pinned package in `resources/native-tools/codex`, retaining its execution/sandbox helpers |
| Owner config / old userData | Absent | Existing explicit fresh-provider operator publishes protected own configuration after its health/enrollment checks |
| External Codex account | No existing login required | Supported user login must be completed; a delivered CLI is not an authenticated account or effective-policy receipt |

Own PostgreSQL remains a managed process/cluster under the existing runtime
Host. No additional PostgreSQL SCM service is introduced. Unrelated installed
PostgreSQL and Guardian installations must not be used as clean-install proof
or modified by this work.

## Implemented production changes

`beforePack` now obtains exact archives from checked-in
`build/native-tools-lock.json`. URLs, tags, archive lengths and SHA256 are pinned;
there is no latest-version lookup, npm installation, shell extraction or client
runtime download. The full Codex package retains `bin`, `codex-path` and
`codex-resources`, including the command runner, execution server and sandbox
setup. MinGit retains its real executable, HTTPS helper, libraries and licenses.

The source identities were read from the official
[Codex 0.166.0 release](https://github.com/openai/codex/releases/tag/rust-v0.166.0)
and [Git for Windows 2.56.0(4) release](https://github.com/git-for-windows/git/releases/tag/v2.56.0.windows.4).
Hash selection does not replace the release-signing owner's publisher and
Authenticode qualification.

Every build rederives the manifest from hash-verified archives in a new private
staging directory. Existing staging is reusable only if it matches this new
independent result. An adjacent mutable manifest cannot appoint its own trusted
digest. Failed downloads do not publish a payload; stale/partial output remains
available for review. The package embeds the resulting manifest digest, source
head, package version and file count in ASAR metadata `metaengineNativeTools`.

Installed first-run preparation verifies this binding, all inventory files and
required native helpers before the fresh database operator can run. Missing or
changed payloads stop preparation. This check does not create credentials or
call a system installation. The managed-worktree and development-verification
Git executors resolve own Git rather than looking it up in global PATH. Their
packaged child discovery uses own Git helpers and fixed OS directories.

Fresh initdb, PG control and Host startup use only verified own runtime
directories and fixed Windows directories for child discovery. Inherited
PATH/Path, Node/module overrides, PG credentials and proxy settings cannot
supply a missing dependency. The Host's private lifecycle context remains
mutable so terminal events can preserve the existing admission fence.

## Producer / consumer contracts still needed

* **Release producer:** build/sign the exact resulting Browser, Guardian,
  offline runtime and native-tools payloads through the existing release trust
  chain. Consumer: integrity-bound package metadata and existing provenance
  gates. No new global signing root or `verified: true` substitute is introduced.
  Include `resources/native-tools/native-tools-manifest.json` and its full
  Codex/Git inventory in the release/SBOM producer; the existing composed SBOM
  function only enumerates the older component groups. Qualify the actual
  Windows import/runtime dependency closure on a clean image, including any
  required redistributable; a developer runner's preinstalled DLLs are not proof.
* **Native Guardian producer:** complete the existing authenticated local Owner
  bridge. `BrowserGuardianUpdateActuatorClient.ensureOwnerBound` currently
  returns `GUARDIAN_LOCAL_OWNER_BRIDGE_REQUIRED`; the native consumer is deny-only.
  The existing private own-Host ticket-consume operation must receive the exact
  native protected-custody request and return its existing enrollment/readback
  evidence. A local socket, same SID, service liveness, device ADMIN status or
  client-supplied JSON must not replace this proof.
  The current private envelope is `{body, headers}`; `body` has exactly
  `schema: metaengine.private.guardian-owner-consume.v1`, `request_id`,
  `host_instance_id`, `host_pid`, `parent_pid`, `launch_nonce`,
  `challenge_sha256`, `ticket`, `ticket_sha256`, `owner_sid_sha256`,
  `key_fingerprint_sha256`, `admin_grant_epoch`. Headers are the existing
  `A2_DEVICE_HTTP_SIGNATURE_V1` signed device headers for the fixed signing
  path `/private/guardian/owner-ticket/consume`. This is existing ChildProcess
  IPC, not permission to add an HTTP endpoint. Its `DB_TICKET_CONSUMED` result
  still says `native_bridge_authenticated: false` and `guardian_ready: false`;
  native authenticated custody and durable Guardian owner readback are the
  missing producer output.
* **Main/onboarding consumer:** call `loadInstalledNativeTools()` from trusted
  native composition. It returns `paths.codexExecutable`, `paths.gitExecutable`,
  the complete manifest and its SHA256. It explicitly returns
  `external_login_required: true`, `execution_ready: false`. Use those exact
  paths when creating the existing protected native operator configuration;
  do not accept preinstalled paths or fabricate sandbox receipts. A dedicated
  private CODEX_HOME, legitimate account login, actual effective policy from
  the same CLI run and existing provider/agent-specific sandbox pins remain
  required. This branch does not invent missing operator configuration.
  The existing descriptor schema is `metaengine.native-coding.operator-paths.v1`
  with exactly `schema`, `cli_executable`, `codex_home`, `git_executable`,
  `journal_root`, `worker_temp_root`, `result_index_root`, `sandbox_receipts`.
  The last field contains `IMPLEMENTER` and `CRITIC` pins `{path, sha256}`.
  Optional `provider_sandbox_receipts` uses exact
  `{provider_id, agent_id, role, path, sha256}` rows. Its protected publication
  needs real policy producers and existing ACL/readback verification; JSON
  fields alone cannot prove those admissions.
* **Installer/first-boot consumer:** compose the existing owner consent,
  confirmed own-PG/device setup and package-bound Guardian activation under the
  intended installation action. Preserve legitimate UAC and external login.
  Startup observation alone must not trigger elevation. Pending or ambiguous
  effects remain held for exact readback; do not blindly repeat installation,
  enrollment or initdb. Existing journals, data and original receipts survive
  failures. Rollback of a machine service requires native typed physical proof;
  database cleanup is not that proof.

## Verification and outstanding physical proof

Unit/disposable tests cover absent own payloads, hostile/absent PATH, complete
helper inventory, byte/manifest substitution, links and archive traversal,
case collisions, failed/truncated/oversized/interrupted downloads, partial
staging, forged reuse, exact package generation binding, initdb partial state,
restart refusal and original consent/cancellation behavior. Actual Git tests
continue to cover locked worktrees, crash readback and non-replay of ambiguous
effects. Generated archive and inert-child tests are not Windows physical proof.

Windows acceptance must start with recorded absence of METAENGINE services,
configuration and private data, and demonstrate no dependency on runner-installed
Node/Git/PG/Codex. It must install the exact signed artifact, create its own
cluster/configuration, complete authenticated Guardian enrollment, perform
legitimate external onboarding, verify health, restart, and exercise failure
and recovery with original receipts preserved. A hosted developer-tool runner,
an attached old Keeper database, or an upgrade cannot establish clean-machine
acceptance. No such installation has been performed by this branch.
