# R61 Track C1 — Cursor Cloud Agents + Environment + Self-Hosted (research catalog)

- Agent: research-track-C1 (general-purpose), RESEARCH-ONLY
- Corpus: /tmp/r61-corpus/ (docs/cloud-agent*.txt, 8 blog files), all FETCHED_AT 2026-09-24
- Rule: corpus evidence only; UNKNOWN marked; current vs historical distinguished. Autonomy scale L0 manual … L4 fully-autonomous.
- Naming note: "Cloud Agents were formerly called Background Agents" (docs/cloud-agent.txt).

---

## A. VM environment & isolation

### cloud-vm-full-dev-env: Full dev environment in per-agent cloud VM
- Category: environment
- Cursor Status: GA
- Source: docs/cloud-agent.txt (2026-09-24); blog__cloud-agents (2025-10-30)
- What: Agent runs in isolated cloud VM instead of local machine; env mirrors a laptop setup.
- Invoke: Web cursor.com/agents, IDE "Cloud" in agent dropdown, Slack/GitHub/Linear @cursor, API, iOS.
- Runtime behind: Cursor-managed provisioning of isolated VMs; clones repo, installs deps, injects secrets, network access.
- Prereqs: admin connects source control (GitHub/GitLab/Bitbucket/Azure DevOps); paid plan; read-write repo privileges.
- Limitations: Ubuntu VMs only (no custom OS); no direct shell access to remote machine ("you do not get direct access to the remote machine").
- Autonomy: L3 (auto-runs terminal commands, human reviews PR)
- Evidence: "run in isolated VMs in the cloud with full development environments"; "You can run as many agents as you want in parallel"; "isolated Ubuntu machines".
- Confidence: HIGH

### parallel-agents: Massive parallelism, laptop-independent
- Category: cloud-exec
- Cursor Status: GA
- Source: docs/cloud-agent.txt; blog__cloud-agents (2025-10-30)
- What: Any number of concurrent agents; local machine need not be online. No explicit documented cap for managed cloud (UNKNOWN — no number published).
- Autonomy: L3
- Evidence: "run as many agents as you want in parallel, and they do not require your local machine to be connected"; "run many agents at once, without requiring your laptop".
- Confidence: HIGH (no hard cap found)

### microvm-isolation: Firecracker microVMs in separate AWS account
- Category: security
- Cursor Status: GA
- Source: docs/cloud-agent__security.txt (2026-09-24)
- What: One VM boundary per agent (not shared process sandbox); runtime workspaces on Firecracker-based microVM infra in a separate AWS account from other Cursor services.
- Limitations: Cursor employees have no access to VM code; access attempts monitored.
- Autonomy: L3
- Evidence: "Each agent runs in its own VM boundary, not a shared process sandbox"; "MicroVM isolation. Runtime workspaces run on Firecracker-based microVM infrastructure".
- Confidence: HIGH

### encryption-retention: Per-agent keys, snapshot 90-day window
- Category: security
- Cursor Status: GA (retention policies EARLY ACCESS for Enterprise)
- Source: docs/cloud-agent__security.txt; docs/cloud-agent__security-network.txt
- What: TLS1.2+ in transit; AES-256 at rest with per-agent keys; Enterprise CMEK/BYOK. Conversation state kept indefinitely by default (deletable); VM snapshots rolling 90 days of inactivity (each start/resume extends), auto-deleted; Delete Agent API removes transcript+artifacts; Enterprise retention windows: Indefinite or 90 days.
- Autonomy: L3
- Evidence: "AES-256, with per-agent keys"; "Snapshots are deleted after 90 days of inactivity"; "Custom retention windows are in early access".
- Confidence: HIGH

### vm-lifecycle-recycle: Provision→Run→Persist→Handoff→Recycle
- Category: lifecycle
- Cursor Status: GA
- Source: docs/cloud-agent__security.txt
- What: Documented run stages: start, provision isolated VM + clone, run + stream, persist conversation/artifacts, push branch + draft PR, recycle: "VM runtime resources are hibernated and then deleted on lifecycle timers once the run is idle". Runtime workspace timer refreshes on follow-up prompts.
- Autonomy: L3
- Evidence: "Cursor provisions an isolated VM for that agent and clones the authorized repository"; "hibernated and then deleted on lifecycle timers once the run is idle".
- Confidence: HIGH

### hibernate-checkpoint-fork: VM hibernation/resume, checkpoint & fork pipelines
- Category: lifecycle
- Cursor Status: GA (engine primitives; not user-facing controls) — fork tooling described as internal capability
- Source: blog__cloud-agent-lessons (2026-06-02); docs/cloud-agent__security-network.txt (snapshots "allow agents to start or resume without recloning")
- What: Cursor built "methods to efficiently hibernate and resume agent VMs between messages" and "pipelines to quickly and durably checkpoint, restore, and fork VM images"; agent loop decoupled from machine (Temporal), enabling pod hibernation/resume, readonly VMs, prewarmed VMs; a subagent may outlive its parent.
- Autonomy: L3
- Evidence: "hibernate and resume agent VMs between messages"; "checkpoint, restore, and fork VM images"; "pod hibernation and resumption, and runs that stretch across days".
- Confidence: HIGH (exists), MED (exact user-facing fork/snapshot APIs)

### resource-limits: Default VM profile, limits raisable by support
- Category: environment
- Cursor Status: GA; self-serve custom resources ANNOUNCED ("coming soon")
- Source: docs/cloud-agent__setup.txt
- What: "Each cloud agent runs on a default VM profile with limited memory and CPU"; Enterprise can contact support to raise workspace limits. No published CPU/RAM numbers (UNKNOWN).
- Autonomy: L3
- Evidence: "default VM profile with limited memory and CPU"; "Self-serve custom resource configuration is coming soon."
- Confidence: HIGH (existence), UNKNOWN (specs)

### builds-snapshots: Builds prepare env; snapshot-based environments
- Category: environment
- Cursor Status: GA
- Source: docs/cloud-agent__setup.txt; docs/cloud-agent__settings.txt; docs/cloud-agent.txt
- What: Build = base image + clone repos + run install to completion; successful Build captures disk state and becomes active; new agents start from active Build; failed Build doesn't replace active one; Builds tab: logs, trigger, pin active Build, start agent from specific Build; layer caching (changed layers only; "Builds that hit the cache run 70% faster" — blog May 2026); Builds preserve disk state only (processes/env vars don't carry over — use start/terminals).
- Invoke: dashboard Environments → Builds; environment.json "snapshot" ID; Cursor Cloud MCP tool take-environment-snapshot / check-environment-snapshot.
- Autonomy: L2 (agent proposes env config, user reviews) for agent-driven; L3 for automatic reuse.
- Evidence: "A successful Build captures the resulting disk state and becomes active"; "Builds preserve disk state only"; "Builds that hit the cache run 70% faster."
- Confidence: HIGH

### dockerfile-environment-json: Docker-based env config as code
- Category: environment
- Cursor Status: GA (.cursor/environment.json + Dockerfile); Cursor-configured Dockerfiles PRIVATE BETA (Enterprise)
- Source: docs/cloud-agent__setup.txt; blog__cloud-agent-development-environments (2026-05-13)
- What: Commit .cursor/environment.json with {"build":{"dockerfile","context"},"install":...} or {"snapshot":...,"install":...}; install script must be idempotent, runs per Build; start command + terminals (tmux session shared user+agent) for long-running processes; Dockerfile paths relative to .cursor; don't COPY full project; build secrets for private registries; env resolution: repo environment.json > personal saved env > team saved env.
- Prereqs: Debian/Ubuntu-based image for computer use.
- Autonomy: L1/L2 (agent can propose-environment-json for review)
- Evidence: "Manually configure the environment with a Dockerfile... specify the Dockerfile in a .cursor/environment.json"; "The install script must be idempotent"; "Cursor-configured Dockerfiles (private beta)".
- Confidence: HIGH

### agent-led-setup: Agent sets up its own environment (<10 min)
- Category: environment
- Cursor Status: GA
- Source: docs/cloud-agent__setup.txt
- What: Guided setup from dashboard/Agents Window: connect SCM, pick repos, provide env vars/secrets; user watches progress in a shared terminal; env saved after verification + successful Build; config committed to environment.json for team. "Update with Agent" / "New Setup Run" / Restore version history in dashboard.
- Autonomy: L2 (agent does work, user supplies secrets and approves)
- Evidence: "Cursor can set up your dev environment in the cloud in less than 10 minutes"; "watch its progress in a shared terminal session".
- Confidence: HIGH

### multi-repo-environments: One env, many repos
- Category: environment
- Cursor Status: GA (long-running NOT available for multi-repo yet)
- Source: docs/cloud-agent.txt; docs/cloud-agent__setup.txt; blog__cloud-agent-development-environments
- What: Select multiple repos when creating environment; each cloned into agent machine; coordinated changes, cross-repo tests, PRs in the repos it changes; reused across runs and automations for same repo group. Self-hosted multi-repo: --worker-dir repeatable up to 20 paths, first root is primary.
- Limitations: "Long-running is not available for multi-repo environments yet"; dashboard shows self-hosted worker under primary repo only.
- Autonomy: L3
- Evidence: "The agent can inspect the full workspace, make coordinated changes, and open pull requests in the repos it changes"; "Long-running is not available for multi-repo environments yet."
- Confidence: HIGH

### monorepo-secrets: Monorepo .env guidance
- Category: environment
- Cursor Status: GA (pattern guidance)
- Source: docs/cloud-agent__setup.txt
- What: Multiple .env.local files → add all values to Secrets tab with unique prefixed names (NEXTJS_*, CONVEX_*); .env.local can be captured in snapshots (Secrets tab recommended). TOTP 2FA login supported via TOTP secret + oathtool.
- Autonomy: L3
- Evidence: "Add values from all .env.local files to the same Secrets tab"; "The agent can generate the current 6-digit code with oathtool".
- Confidence: HIGH

### secrets-tab: Secrets management & injection
- Category: security
- Cursor Status: GA
- Source: docs/cloud-agent.txt; docs/cloud-agent__security-network.txt
- What: Secrets via cursor.com/dashboard/cloud-agents; workspace/team-scoped + environment-scoped; encrypted at rest (KMS) and transit; injected as env vars when agent starts (running agents don't pick up new secrets); types: Environment Variable (agent-visible), Runtime Secret (redacted), Build Secret (Docker build only).
- Autonomy: L3
- Evidence: "Secrets are injected when an agent starts. Agents already running won't pick up new secrets"; "use the Secrets tab... These are exposed to the cloud agent as environment variables."
- Confidence: HIGH

### runtime-secret-redaction: [REDACTED] runtime secrets
- Category: security
- Cursor Status: GA (formerly "Redacted Secrets")
- Source: docs/cloud-agent__security-network.txt; blog__cloud-agent-environment
- What: Runtime Secret values redacted from tool results, transcript, commits and commit messages (placeholder [REDACTED]) — "never reach the model"; still visible to humans via Terminal; secret scanning in commits noted in blog.
- Autonomy: L3
- Evidence: "redacted from the agent's tool call results, chat transcript, commits, and commit messages"; "prevents the agent from reading secret values even if it tries."
- Confidence: HIGH

### oidc-tokens: Short-lived OIDC JWTs from VM socket
- Category: security
- Cursor Status: GA
- Source: docs/cloud-agent__identity.txt
- What: Agent mints RS256 JWT via Unix socket (CURSOR_AGENT_SOCKET=/run/cursor/api.sock on managed VMs); 5-min tokens, no refresh; claims: sub, cloud_agent_id, team_id, repo_url/repo_urls/repo_count, branch_name, agent_runtime (managed|self_hosted), source; sub_claim projection (team_id/organization_id/environment_id); verifiers via https://api.cursor.com JWKS/discovery; rate 30/min burst 10, 8 socket connections; trust model: any process on the machine can mint — scope to the run.
- Autonomy: L3
- Evidence: "mint short-lived OIDC JWTs from a local socket"; "Tokens are valid for 5 minutes"; "Each claimed agent can mint 30 tokens per minute".
- Confidence: HIGH

### agent-metadata-socket: In-VM KV agent metadata
- Category: handoff
- Cursor Status: PREVIEW ("in preview, subject to change")
- Source: docs/cloud-agent__metadata.txt
- What: GET /v1/meta-data on same socket: agent/id, agent/source, agent/runtime, owner/*, turn/* (turn submitter, model), workspace/repo-urls; 120 req/min, 8 connections shared with OIDC; self-hosted workers do NOT serve metadata yet; not a credential (unsigned).
- Autonomy: L3
- Evidence: "Agent metadata is in preview and subject to change"; "Self-hosted workers do not serve this API yet."
- Confidence: HIGH

### aws-iam-roles: Cursor-managed AWS role assumption
- Category: security
- Cursor Status: GA
- Source: docs/cloud-agent__setup.txt
- What: Secret CURSOR_AWS_ASSUME_IAM_ROLE_ARN + team External ID; Cursor sets AWS_PROFILE=cursor-cloud-agent etc.; STS creds expire 1h, refreshed when "missing, invalid, or within 15 minutes of expiration" on wake.
- Autonomy: L3
- Evidence: "Cursor assumes the role with STS credentials that expire after 1 hour"; "AWS_PROFILE is set to cursor-cloud-agent".
- Confidence: HIGH

### signed-commits: HSM-backed Ed25519 signed commits
- Category: security
- Cursor Status: GA (automatic, no setup)
- Source: docs/cloud-agent__security-network.txt
- What: Every agent commit signed with HSM Ed25519 key; "Verified" badge on GitHub/GitLab; satisfies signed-commit branch protection.
- Autonomy: L3
- Evidence: "Cloud Agents sign every commit with a HSM-backed Ed25519 key"; "No setup is required."
- Confidence: HIGH

### git-scopes-blocklist: Protected Git Scopes + repo blocklist
- Category: security
- Cursor Status: GA
- Source: docs/cloud-agent__security.txt
- What: Admins lock Git org to Cursor org (Protected Git Scopes); repository blocklist keeps sensitive repos out; access inherited, never widened (agent can't reach repos the triggering user couldn't); GitHub/GitLab App rather than personal credentials.
- Autonomy: L3
- Evidence: "Access is inherited, never widened"; "lock a Git organization to your Cursor organization with Protected Git Scopes".
- Confidence: HIGH

## B. Network model

### internet-by-default: Internet access ON by default
- Category: security
- Cursor Status: GA
- Source: docs/cloud-agent__security-network.txt
- What: "The agent has internet access by default"; egress controls optional. Auto-run of all terminal commands + open internet = prompt-injection exfiltration risk (documented with OpenAI reference).
- Autonomy: L3
- Evidence: "The agent has internet access by default. You can configure network egress controls"; "The agent auto-runs all terminal commands, letting it iterate on tests."
- Confidence: HIGH

### egress-modes: 3 network access modes + inheritance + Enterprise lock
- Category: security
- Cursor Status: GA (lock = Enterprise)
- Source: docs/cloud-agent__security-network.txt; docs/cloud-agent__settings.txt
- What: Modes: Allow all / Default + allowlist / Allowlist only (small always-on set: Cursor services + SCM). Settings at user, team, environment level; env can inherit user/team policy or define own; Enterprise "Lock Network Access Policy" org-wide. Team allowlist is shared with desktop Agent sandbox default allowlist (one list for both).
- Autonomy: L2 (policy gates what agent reaches)
- Evidence: "Allow all network access... Default + allowlist... Allowlist only"; "Enterprise team admins can lock the network access setting".
- Confidence: HIGH

### egress-ip-ranges: Published egress IPs + git egress proxy
- Category: security
- Cursor Status: GA
- Source: docs/cloud-agent__security-network.txt
- What: JSON endpoint (cursor.com/docs/ips.json) with cloudAgents CIDRs per cluster (us3p/us4p/us5p) + gitEgressProxy IPs; git egress proxy routes all git traffic through narrow IP set (184.73.225.134, 3.209.66.12, 52.44.113.131) across all git hosts; Origin IPs list separate; "We do not recommend allowlisting by IP address as your primary security mechanism".
- Autonomy: L3
- Evidence: "IP ranges are available via a JSON API endpoint"; "This proxy routes all git traffic through a narrower set of IPs".
- Confidence: HIGH

### private-connectivity: AWS PrivateLink / Cloudflare Tunnel to private SCMs
- Category: security
- Cursor Status: GA (Enterprise; contact sales)
- Source: docs/cloud-agent__private-connectivity.txt
- What: For GHES, GitLab Enterprise, Bitbucket Data Center, Artifactory/Nexus + webhook return path to api2.cursor.sh; PrivateLink both directions (Cursor→your origin; your origin→api2.cursor.sh via published endpoint service vpce-svc-054b15427d4bea2b7); Cloudflare Tunnel outbound-only alternative; requires public TLS cert, DNS, HTTPS:443; no self-signed certs, SSH, custom ports, IPv6-only; GCP PSC not offered.
- Autonomy: L2/L3
- Evidence: "AWS PrivateLink... including webhook traffic back to Cursor"; "Cursor does not support self-signed certificates, unencrypted connections, SSH, custom ports".
- Confidence: HIGH

### tailscale-cloudflare-in-vm: Private network clients inside the VM
- Category: environment
- Cursor Status: GA (documented patterns)
- Source: docs/cloud-agent__setup.txt; docs/cloud-agent__security-network.txt
- What: Tailscale must run userspace-networking mode (tailscaled --tun=userspace-networking + socks5/http proxy env); cannot be exit node. Cloudflare Tunnel works (cloudflared userspace); TCP services via cloudflared access tcp local listener; tokens stored in Cursor Secrets.
- Autonomy: L3
- Evidence: "Tailscale does not work in its default networking mode in Cloud agent VMs. Use userspace networking mode"; "Cloudflare Tunnel works in Cloud Agent VMs because cloudflared runs in userspace."
- Confidence: HIGH

### docker-in-vm: Docker inside cloud VMs
- Category: environment
- Cursor Status: GA (with caveats)
- Source: docs/cloud-agent__setup.txt
- What: Docker supported (used internally for full-stack repos); VM itself is container layer — complex setups need fuse-overlayfs storage driver + iptables-legacy + docker group for ubuntu user (canonical Dockerfile provided); start `sudo service docker start` in start command.
- Autonomy: L3
- Evidence: "Docker has edge cases in Cloud Agents because it runs inside another container layer"; "use fuse-overlayfs, iptables-legacy".
- Confidence: HIGH

## C. Launch surfaces & lifecycle

### launch-surfaces: Start from UI/Slack/mobile/API/webhook-ish surfaces
- Category: lifecycle
- Cursor Status: GA (Android = PWA; native Android ANNOUNCED "planned")
- Source: docs/cloud-agent.txt; docs/cloud-agent__mobile.txt
- What: Surfaces: iOS app (source: iosApp), Web cursor.com/agents, Desktop "Cloud" dropdown, Slack @cursor, GitHub/Bitbucket PR-issue comments @cursor/@cursoragent, Linear @cursor, API. Start-from-scratch without repo (creates draft Origin repo; "Create repo" publishes it).
- Autonomy: L1 for trigger (human issues task) → L3 execution
- Evidence: "You can kick off cloud agents from wherever you work"; "On Android, use cursor.com/agents in Chrome and tap Install App".
- Confidence: HIGH

### followups-while-running: Follow-ups to a running agent
- Category: lifecycle
- Cursor Status: GA
- Source: docs/cloud-agent.txt; docs/cloud-agent__mobile.txt; docs/cloud-agent__settings.txt
- What: Send follow-up messages mid-run (web/mobile/desktop); team follow-ups admin-controlled: Disabled / Service accounts only / All; viewer must have repo access; documented lateral-movement/secret-exposure warning for team follow-ups.
- Autonomy: L2/L3 (human nudges autonomous run)
- Evidence: "send follow-up messages and continue the work, a team admin can enable team follow-ups"; "a follow-up message can instruct the agent to read environment variables".
- Confidence: HIGH

### subscriptions-event-wake: Subscriptions (wait for CI/Slack/Linear/timer events)
- Category: lifecycle
- Cursor Status: GA (documented in current docs)
- Source: docs/cloud-agent__capabilities.txt
- What: Agent subscribes to an event source, ends turn, wakes on matching event as follow-up with full context. Sources: GitHub (PR activity, CI results), Slack (thread replies, channel messages), Linear (issues/comments), Timers (one-off or recurring cron; /loop skill; /subscribe built-in skill). Bursts coalesce; subscription max lifetime 180 days; agents self-unsubscribe.
- Autonomy: L4 within guardrails (agent continues unprompted on external events)
- Evidence: "Subscriptions let a cloud agent wait for those events and keep working when they happen, without you re-prompting it"; "A subscription lasts at most 180 days."
- Confidence: HIGH

### auto-ci-fix: Automatic CI-failure fixing on own PRs
- Category: lifecycle
- Cursor Status: GA (Teams only; non-Teams "coming soon"); GitHub Actions only
- Source: docs/cloud-agent__capabilities.txt
- What: Auto-fixes CI failures in PRs it created; skips if human pushed a commit, user sent follow-up, check failing on base, or 10 CI-failure follow-ups already; toggle per-user dashboard or per-PR @cursor autofix off/on.
- Autonomy: L3 (bounded autonomous loop with caps)
- Evidence: "Cloud Agents automatically try to fix CI failures in PRs they create. This currently supports GitHub Actions only"; "The PR has already had 10 CI-failure follow-ups."
- Confidence: HIGH

### long-running-agents: Long-running agents (multi-day tasks)
- Category: lifecycle
- Cursor Status: RESEARCH PREVIEW → "available... for all Ultra, Teams, and Enterprise users" (blog Feb 2026); docs list team toggle "Long running agents"
- Source: blog__long-running-agents (2026-02-12); docs/cloud-agent__settings.txt
- What: Custom harness: proposes plan and waits for approval before executing; multiple agents checking each other's work; runtimes cited 25–52h, PRs up to 151k lines; runs in cloud regardless of client connection. NOT available for multi-repo environments (toggle disabled).
- Autonomy: L3 with plan-approval gate (L2→L3 hybrid)
- Evidence: "Long-running agents in Cursor propose a plan and wait for approval"; "I can kick-off a 52-hour task that I don't have to babysit"; "Long-running is not available for multi-repo environments yet."
- Confidence: HIGH

### durable-execution-temporal: Temporal-backed agent loop
- Category: lifecycle
- Cursor Status: GA (internal runtime architecture)
- Source: blog__cloud-agent-lessons (2026-06-02)
- What: Migrated from work-stealing to Temporal: survives inference outages, pod hibernation/resumption, runs across days/weeks; >50M actions/day, >7M workflows; moved from "eternal" workflows to shorter per-task ones; agent loop / machine state / conversation state decoupled (append-only streaming storage with client rewind on retry).
- Autonomy: L3
- Evidence: "our current agent loop on Temporal can survive blips in inference reliability, pod hibernation and resumption"; "Temporal handles more than 50 million actions per day".
- Confidence: HIGH

### self-healing-env: Cloud Doctor / autoinstall (self-diagnosing environments)
- Category: environment
- Cursor Status: GA internally (Cloud Doctor automation); autoinstall = RESEARCH concept
- Source: blog__cloud-agent-environment (2026-07-30); blog__cloud-agent-lessons
- What: Agents use Cursor Cloud MCP to inspect own run for setup failures, egress policy, changed secrets; internal "Cloud Doctor" automation periodically checks failures, root-causes, opens fix PRs; goal: agents "report when secrets are missing, network access is blocked" and self-heal.
- Autonomy: L3→L4 trajectory
- Evidence: "Cloud agents use it to inspect their own environment for setup failures, egress policy, changed secrets"; "we call it 'autoinstall'".
- Confidence: HIGH (Cloud MCP), MED (productized autoinstall)

### stuck-timeout-detection: Stuck/timeout handling
- Category: lifecycle
- Cursor Status: PARTIAL / UNKNOWN for managed cloud — no explicit "stuck agent detector" documented for Cursor-managed VMs
- Source: docs/cloud-agent__self-hosted__pool.txt (self-hosted timeouts); blog__cloud-agent-lessons (Temporal retries/timeouts as async tool calls)
- What: Managed side: Temporal activities "capture timeouts and retries"; pool workers: --idle-release-timeout (default 3600s, exit 0 for supervisor recycle), workerReadyTimeoutSeconds reconnect window (default 0), claimed_offline queue events + wakeTimeoutMs, claim expiry re-advertises request. No documented autonomous "stuck detection" feature for managed agents (UNKNOWN).
- Evidence: "split out activities to better capture timeouts and retries"; "If a follow-up arrives, the timer resets. When the timeout fires, the CLI exits with code 0".
- Confidence: MED

## D. Artifacts, takeover, handoff

### artifacts: Screenshots/videos/logs attached to PRs
- Category: artifacts
- Cursor Status: GA (GitHub embed opt-in)
- Source: docs/cloud-agent.txt; docs/cloud-agent__capabilities.txt
- What: Agents produce screenshots, videos, log references to demo changes; opt-in "Allow posting artifacts to GitHub" embeds them into PR descriptions via long unguessable URLs (GitHub image proxy needs public URLs); uploads go to cloud-agent-artifacts.s3.us-east-1.amazonaws.com (must be allowlisted; exact host, not wildcard).
- Autonomy: L3
- Evidence: "Agents produce screenshots, videos, and logs so you can see exactly what changed"; "artifacts in PR descriptions use long, unguessable URLs".
- Confidence: HIGH

### computer-use: Desktop + browser control in VM
- Category: cloud-exec
- Cursor Status: GA (enterprise teams only toggle; self-hosted via --computer-use)
- Source: docs/cloud-agent__capabilities.txt; docs/cloud-agent__settings.txt; blog__cloud-agent-lessons
- What: Each VM has full desktop env; agent uses mouse/keyboard to start dev servers, click through UI, verify changes; harness has dedicated computer-use subagent (own model routing, prompting, screen recording; VNC + Chrome shared with parent agent).
- Autonomy: L3
- Evidence: "Each cloud agent runs in its own isolated VM with a full desktop environment"; "agents can start dev servers, open the app in a browser, click through UI flows".
- Confidence: HIGH

### remote-desktop-takeover: Human takes over agent desktop, releases back
- Category: handoff
- Cursor Status: GA
- Source: docs/cloud-agent__capabilities.txt; docs/cloud-agent.txt
- What: User controls agent's remote desktop to test the modified software in a full env without local checkout; release control back to agent to continue. Self-hosted Linux: --share-desktop view|view_and_control.
- Autonomy: L1 (manual takeover within L3 run)
- Evidence: "Take control of the agent's remote desktop to test the software yourself"; "Release control back to the agent for it to keep working."
- Confidence: HIGH

### port-forward-preview: Port forwarding + internal browser preview + Design Mode
- Category: handoff
- Cursor Status: GA
- Source: docs/cloud-agent__setup.txt; docs/cloud-agent__mobile.txt
- What: Cursor forwards ports from agent env to your machine (Agents Window → Forwarded Ports; Detected + Auto-Forward); "Open in internal browser" preview; Design Mode to point at elements and direct agent from page. Mobile: attach photos/draw (Apple Pencil) for visual direction.
- Autonomy: L2 (human steers live run)
- Evidence: "Cursor forwards ports from the agent's environment to your machine"; "use Design Mode to point at elements and direct the agent from the page."
- Confidence: HIGH

### vercel-publish: Publish running app to live URL
- Category: artifacts
- Cursor Status: GA (requires Vercel account; team plan above Hobby)
- Source: docs/cloud-agent__setup.txt
- What: "Publish" in Agents Window links repo to Vercel project, deploys default branch, replies with URL; later default-branch commits deploy automatically.
- Autonomy: L3
- Evidence: "The agent links the repository to a Vercel project, deploys the default branch, and replies with the deployment URL."
- Confidence: HIGH

### remote-control-handoff: Local↔cloud handoff (Remote Control / Move to Cloud)
- Category: handoff
- Cursor Status: GA (Cursor 3.9.8+; admin enable on Teams/Enterprise via Self-Hosted section)
- Source: docs/cloud-agent__mobile.txt
- What: Remote Control: agent loop moves to Cursor cloud, tool calls keep executing on your computer (local or SSH workspace; no Git remote needed); "Move to Cloud" pushes local IDE session to a cloud agent; conversation state crosses to Cursor; only tool results/context leave your machine; computer must stay awake (Keep this computer awake).
- Autonomy: L2/L3
- Evidence: "The agent loop moves to the cloud while its tools keep running on your machine"; "push your work to a cloud agent first with Move to Cloud".
- Confidence: HIGH

### team-sharing: Share agent runs; view vs follow-up permissions
- Category: handoff
- Cursor Status: GA
- Source: docs/cloud-agent.txt
- What: Agent URL shareable; teammates see conversation, diffs, artifacts (read-only) if same team + own repo access; team follow-ups optional; team admin sees all runs, non-admins only own (Cursor Cloud MCP enforces per-request access checks).
- Autonomy: n/a
- Evidence: "Send an agent's URL to a teammate and they can open the run"; "Team membership alone doesn't grant access."
- Confidence: HIGH

### ios-app: Native iOS control surface
- Category: lifecycle
- Cursor Status: GA (iOS 26+/iPadOS 26+; Android native "planned")
- Source: docs/cloud-agent__mobile.txt
- What: Start/manage/review/merge PRs from phone; Live Activities track up to 8 agents on lock screen/Dynamic Island; push notifications on turn completion; voice dictation; slash commands/skills/automations work same as web; source tag iosApp.
- Autonomy: L2 (human-initiated, remote supervision)
- Evidence: "track up to eight agents at once with Live Activities"; "Agents keep working in the cloud whether or not your device stays connected."
- Confidence: HIGH

### mcp-cloud: MCP support in cloud VMs (HTTP proxied, stdio in-VM)
- Category: environment
- Cursor Status: GA (SSE and mcp-remote NOT supported)
- Source: docs/cloud-agent__capabilities.txt
- What: Team + personal MCP servers; OAuth per-user; HTTP servers proxied through Cursor backend (credentials never in VM); stdio servers run inside the VM (agent sees their env vars) — must be installed via environment setup; configs encrypted at rest, sensitive fields unreadable after save; team marketplace linking.
- Autonomy: L3
- Evidence: "server configurations are never present in the cloud agent's VM environment"; "SSE and mcp-remote are not supported."
- Confidence: HIGH

### cursor-cloud-mcp: Built-in run-diagnostics MCP
- Category: artifacts
- Cursor Status: GA (admin-disableable)
- Source: docs/cloud-agent__capabilities.txt
- What: run-info, environment-info (env version, config, egress policy), get-events (setup_started/completed/failed, pr_created, artifact_created, mcp_auth_error), list-cloud-agents, batch-fetch-details (≤50 runs), list-environment-builds, environment-build-logs, trigger-environment-build, propose-environment-json, take/check-environment-snapshot, request-environment-setup-actions (e.g. blocking secret add).
- Autonomy: L3
- Evidence: "built-in Cursor Cloud MCP for run diagnostics, including transcripts, run events, environment details, and setup logs."
- Confidence: HIGH

### hooks-in-cloud: Hooks run in cloud VMs
- Category: environment
- Cursor Status: GA
- Source: docs/cloud-agent.txt
- What: Command-based hooks from repo .cursor/hooks.json; Enterprise also team + enterprise-managed hooks; tool/file hooks + lifecycle hooks (beforeSubmitPrompt, subagentStart/Stop, preCompact, afterAgentResponse, stop); NOT during early read-only exploratory turns; IDE-only hooks (Tab, workspaceOpen) and user-level ~/.cursor hooks unavailable (no local home dir).
- Autonomy: L3
- Evidence: "Cloud agents run command-based hooks from .cursor/hooks.json in your repository"; "Hooks do not run during early exploratory turns in a read-only environment".
- Confidence: HIGH

### start-from-scratch-origin: Repo-less agents + Origin draft repos
- Category: lifecycle
- Cursor Status: GA (needs paid plan + Origin; admin can disable)
- Source: docs/cloud-agent__setup.txt
- What: "Start from scratch" creates a draft Origin repository in the background; "Create repo" publishes under chosen name (≤100 chars; Private/Internal visibility) at cursor.com/codebase.
- Autonomy: L3
- Evidence: "Cursor creates a draft Origin repository for the agent in the background"; "Cursor publishes the draft repository under that name".
- Confidence: HIGH

### pricing-quota: API pricing, context-size choice, spend limit
- Category: cloud-exec (cost)
- Cursor Status: GA
- Source: docs/cloud-agent.txt
- What: Cloud Agents billed at API pricing of selected model; selectable context window (larger = more cost; mobile runs max context); spend limit required on first use. No published per-agent VM cost or concurrency quota (UNKNOWN).
- Autonomy: n/a
- Evidence: "Cloud Agents are charged at API pricing for the selected model"; "You'll be asked to set a spend limit when you first start using them."
- Confidence: HIGH

## E. Self-hosted machines

### self-hosted-overview: Self-Hosted Machines (tool execution on your hardware)
- Category: self-hosted
- Cursor Status: GA (announced 2026-03-25 blog: "now... generally available")
- Source: docs/cloud-agent__self-hosted.txt; blog__self-hosted-cloud-agents
- What: Cursor keeps agent loop/inference/planning; your worker does file edits, terminal, computer use, local MCP. Split: My Machines (personal) vs Team Pools (org fleet). Reason to adopt: compliance perimeter, custom hardware (GPU/Mac iOS), custom images.
- Prereqs: Cursor CLI; outbound HTTPS; Team Pools need Enterprise + service-account API key; admin toggles Allow/Require Self-Hosted Machines.
- Limits: "up to 200 workers per user and 1000 per team" (larger → contact).
- Autonomy: L3
- Evidence: "Cursor runs the agent loop, inference, and planning. Your worker performs file edits and terminal commands"; "Self-hosted cloud agents generally available" (2026-03-25).
- Confidence: HIGH

### worker-outbound-only: Outbound-only worker networking
- Category: self-hosted
- Cursor Status: GA
- Source: docs/cloud-agent__self-hosted.txt; docs/cloud-agent__self-hosted__my-machines.txt
- What: `agent worker start` opens long-lived outbound HTTPS to Cursor; no inbound ports/public IPs/VPN. Hosts needed: api2.cursor.sh + api2direct.cursor.sh (session), downloads.cursor.com (CLI updates, macOS Computer Use install), cloud-agent-artifacts.s3.us-east-1.amazonaws.com (artifacts). Documented failure modes per blocked host; HTTPS_PROXY supported.
- Evidence: "No inbound ports, public IPs, or VPN tunnels are required"; "The worker can't start or continue an agent session" (if api2 blocked).
- Confidence: HIGH

### my-machines: Personal workers
- Category: self-hosted
- Cursor Status: GA
- Source: docs/cloud-agent__self-hosted__my-machines.txt
- What: Long-lived personal worker tied to user + repo checkout; multiple agents can run on same machine; --worker-dir registers repo roots (routing via git remotes); auth: browser login / personal user API key / user-scoped token (POST /v1/sub-tokens; --auth-token-file hot-reload); Slack/GitHub/Linear targeting via worker=/machine= (must match user + name + repo, else rejected — never runs repo A on repo B checkout); `agent worker debug` preflight.
- Autonomy: L3
- Evidence: "By default, a My Machines worker is long-lived: it stays connected until you stop it"; "a request for repo A should never run on a machine checkout for repo B".
- Confidence: HIGH

### team-pools: Named pools, queue-driven routing, scale-to-zero
- Category: self-hosted
- Cursor Status: GA (Enterprise)
- Source: docs/cloud-agent__self-hosted__pool.txt
- What: Pool = named routing target; requests wait until worker claims; one agent per pool worker at a time; labels route (repo=, pool=, custom --label; repo/pool reserved); repo-backed vs any-repo pools; pools durable after last worker disconnects (scale to zero); pool API: POST/GET/DELETE /v0/private-workers/pools; dashboard selector + Slack/GitHub/Linear pool=<name> triggers; team default pool via `@Cursor pool set <name>`.
- Autonomy: L3
- Evidence: "Requests wait in the pool until an available worker claims them"; "A pool stays registered and selectable after the last worker disconnects, so you can scale to zero".
- Confidence: HIGH

### pool-queue-api: Pending-request queue (list, SSE watch, claim, release)
- Category: self-hosted
- Cursor Status: GA
- Source: docs/cloud-agent__self-hosted__pool.txt; docs/cloud-agent__api__endpoints.txt (corroborating)
- What: GET /v0/private-workers/pending-requests (+streamCursor), SSE /pending-requests/stream (created / claimed / claimed_offline / expired events; cursors expire 5 min; "A service account can hold at most four concurrent streams"); POST /claim, POST /claims/{id}/release; GET /private-workers?status=&scope=; /summary (utilization-driven autoscaling example: scale up at ≥0.9); claim rejects second claim while live.
- Evidence: "watch the request queue, claim a request, and start a worker for it"; "A service account can hold at most four concurrent streams".
- Confidence: HIGH

### worker-controller: Controller (--spawn claim-then-spawn / --warm-idle)
- Category: self-hosted
- Cursor Status: GA (Kubernetes operator + WorkerDeployment DEPRECATED — use anysphere/k8s-workers template)
- Source: docs/cloud-agent__self-hosted__pool.txt; docs/cloud-agent__self-hosted__integrations.txt
- What: `agent worker controller --spawn ./hook.sh --pool gpu [--warm-idle N]`; spawn hook gets env (CURSOR_REQUEST_ID, CURSOR_AGENT_WORKER_ID, CURSOR_POOL, CURSOR_REPO_URLS...); warm mode reconciles GET pools every 60s, one warm controller per pool (no server-side spawn lease — can transiently over-spawn); K8s: Helm template creates one Pod per claimed request or warm Pods, no CRD.
- Evidence: "The hook runs once after a successful claim, or once per missing warm worker"; "The Cursor Kubernetes operator and WorkerDeployment Helm chart are deprecated."
- Confidence: HIGH

### pool-hibernation: Claimed-offline wake + snapshot restore
- Category: self-hosted
- Cursor Status: GA (opt-in pattern via workerReadyTimeoutSeconds)
- Source: docs/cloud-agent__self-hosted__pool.txt
- What: Reconnect window: workerReadyTimeoutSeconds (default 0 = immediate reacquire); on follow-up to offline machine, request advertised as claimed-but-offline (claimedWorkerId + wakeTimeoutMs, SSE claimed_offline); controller snapshots machine at idle, restores + restarts worker with same id before window lapses; else release claim or window expiry re-queues request.
- Evidence: "With hibernation, the machine comes back with its workspace intact"; "the event stream emits a claimed_offline event".
- Confidence: HIGH

### idle-release: Idle release timeout
- Category: self-hosted
- Cursor Status: GA
- Source: docs/cloud-agent__self-hosted__pool.txt
- What: --idle-release-timeout (default 3600s; env CURSOR_WORKER_IDLE_RELEASE_TIMEOUT) = seconds worker stays connected after session end waiting for follow-ups; follow-up resets timer; exit code 0 for supervisor recycle; 0 disables. Management endpoint --management-addr for /healthz /readyz /metrics (gauges: connected, session_active, last_activity; counters: connect attempts/retries, session_ends_total labeled stream_end|stream_error|session_closed|session_error|connection_timeout|session_aborted).
- Evidence: "the CLI exits with code 0 so a supervisor can recycle the machine"; "Default: 3600. Pass 0 to disable idle-based release."
- Confidence: HIGH

### any-repo-pools: Any-repo pools + on-claim clone + minted GitHub tokens
- Category: self-hosted
- Cursor Status: GA (opt-in flags; token minting needs team-admin enablement)
- Source: docs/cloud-agent__self-hosted__pool.txt
- What: Pool without bound repo; requests match pool name only; .cursor/rules/*.mdc (alwaysApply) gives clone instructions; --clone-git-repos clones claimed agent's repos on claim (implies --mint-github-token short-lived GitHub token; HTTPS remotes; branch or detached SHA); failed clone keeps request queued; flags assume one worker per container/OS user.
- Evidence: "A pool worker does not require a git remote"; "--clone-git-repos implies --mint-github-token"; "If clone fails, the request stays in the queue."
- Confidence: HIGH

### selfhosted-secrets-sync: Dashboard secrets synced to pool workers
- Category: self-hosted
- Cursor Status: GA (pool workers only; one credential-enabled worker per OS user)
- Source: docs/cloud-agent__self-hosted__pool.txt
- What: --sync-dashboard-secrets delivers eligible dashboard Cloud Agent secrets as env vars during claimed runs; MCP routing by transport: stdio→worker (private network), HTTP/SSE→Cursor backend.
- Evidence: "Receive eligible dashboard Cloud Agent secrets as environment variables during claimed runs."
- Confidence: HIGH

### selfhosted-identical-parity: Parity claims (artifacts, plugins, models)
- Category: self-hosted
- Cursor Status: GA core; artifacts/remote-desktop/automations on self-hosted were ANNOUNCED as "soon" in Mar 2026 blog — docs now state artifact behavior identical (docs are newer; treat as GA)
- Source: blog__self-hosted-cloud-agents; docs/cloud-agent__self-hosted__pool.txt
- What: Same product on your infra: isolated per-agent worker, multi-model, plugins (skills/MCP/subagents/rules/hooks), team permissions; project skills in .cursor/skills available on workers (personal skill sync NOT); hooks incl. sessionStart/sessionEnd on claim/release (managed cloud skips those).
- Evidence: "Self-hosted cloud agents will soon be able to demo their work by producing videos" (2026-03-26 blog); "Artifact behavior is identical on self-hosted workers and Cursor-hosted agents" (docs).
- Confidence: MED (parity timeline)

### partner-integrations: Partner runtimes & reference templates
- Category: self-hosted
- Cursor Status: GA (reference architectures; you own image/scaling/validation)
- Source: docs/cloud-agent__self-hosted__integrations.txt; docs/cloud-agent__self-hosted.txt
- What: Partner guides: AWS Lambda (MicroVM), Cloudflare (Sandbox/Containers), Namespace, Modal, Daytona, E2B, Vercel Sandbox, Tensorlake, Coder, SuperServe. Templates: anysphere/aws-lambda-workers (one Firecracker-isolated Lambda MicroVM per claim), anysphere/cloudflare-workers, anysphere/k8s-workers (Helm; one Pod per claim or --warm-idle).
- Evidence: "a --spawn hook launches one Firecracker-isolated Lambda MicroVM per claimed request"; "You own the worker image, infrastructure, secrets, scaling policy".
- Confidence: HIGH

## F. Research frontier (historical/announced, not product parity baseline)

### self-driving-codebases: Thousands of agents, self-coordinating
- Category: lifecycle
- Cursor Status: RESEARCH (blog 2026-02-05; partial "available to try for some users")
- Source: blog__self-driving-codebases.txt
- What: Recursive planner/subplanner/worker harness with handoff messages; peaked ~1,000 commits/hour across 10M tool calls over one week, no human intervention; workers get own repo copy (CoW/dedup suggested); disk I/O of parallel compilation was the hotspot; accepts small steady error rate + final green-branch fixup agent.
- Autonomy: L4 (research only)
- Evidence: "peaked at ~1,000 commits per hour across 10M tool calls over a period of one week"; "run continuously for one week, making the vast majority of the commits".
- Confidence: HIGH (as research)

### internal-adoption: Cloud agents author majority of Cursor PRs
- Category: lifecycle (adoption metric)
- Cursor Status: current (2026-06/07 blogs)
- Source: blog__cloud-agent-lessons (">40% of our PRs", 2026-06-02); blog__cloud-agent-environment ("more than half", 2026-07-30)
- What: Dec 2025 ~1 in 10 merged PRs → Jul 2026 >half; enabled by anydev CLI (supervisor restarts long-running builds), skills, Cloud Doctor.
- Evidence: "Today, they write more than half" (of merged PRs); "cloud agents authored roughly one in ten PRs" in December.
- Confidence: HIGH

### app-stability-lessons: OOM stabilization program
- Category: lifecycle (quality backdrop; tangential to cloud agents)
- Cursor Status: current research post (2026-04-21)
- Source: blog__app-stability.txt
- What: OOM-per-session −80% since late-Feb peak; crash watcher via CDP + upstreamed Electron patches; daily automation turns crash stacks into high-confidence fix PRs; Bugbot rules per OOM class; automated metric-regression rollbacks.
- Evidence: "Our OOM-per-session rate... has fallen 80% since its late-February peak"; "an automation which runs daily... making PRs with optimizations".
- Confidence: HIGH

---

## Gap notes (explicitly not found in corpus — mark UNKNOWN)
- Max concurrent managed cloud agents per user/team: no number published ("run as many agents as you want"; spend limit is the documented throttle).
- Managed VM CPU/RAM specs: not published ("default VM profile with limited memory and CPU"; self-serve customization "coming soon").
- Autonomous stuck-agent detection for managed VMs: no named feature (self-hosted has idle/claim/reconnect timers; Temporal retries documented).
- Snapshot/fork as a user-facing API: fork described as internal pipeline; user-facing surface is environment snapshots + Builds (see hibernate-checkpoint-fork).
- Explicit "environment.json" full schema file: referenced ("The full schema is defined here") but schema page not in this corpus subset.
