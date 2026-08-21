# W1 Step 03 — persistent VM substrate and proof research

Date: 2026-08-21
Milestone: `W1_PERSISTENT_LINUX_WORKER_SAFETY`
Classification: RESEARCH / DESIGN DECISION. No provider is claimed live by this document.

## Decision

For W1 authority, adopt a provider-neutral **persistent Linux VM or bare-metal host** running the existing outbound-only `metaengine-worker.service` under systemd and cgroup v2. Do not attach the W1 authority host to this public repository as a GitHub self-hosted Actions runner. Do not treat Vercel Sandbox, GitHub-hosted runners, or Cloudflare Containers as persistent-host proof.

The acceptance witness is deliberately stronger than “a process stayed alive for N minutes”:

1. the same installation witness must remain bound to one `/etc/machine-id` hash;
2. accepted heartbeat receipts must span a minimum DB-observed time window;
3. at least three witness-bearing receipts must exist;
4. the witness state must survive a **real reboot**, evidenced by at least two distinct `/proc/sys/kernel/random/boot_id` hashes while the machine/witness identity remains stable;
5. H1–H13 Linux safety observation and independent verification remain separate mandatory gates.

Until the reboot condition is met the system may report `PERSISTENT_SAME_HOST_WINDOW_CANDIDATE`, but `persistent_worker_proof` remains false.

## Why not GitHub self-hosted Actions as the W1 control path

Official GitHub documentation says self-hosted runners are user-managed systems and need not be clean per job. More importantly, GitHub explicitly recommends self-hosted runners only with private repositories because a fork of a public repository can potentially execute dangerous code on the runner through a pull request.

Sources:
- https://docs.github.com/en/actions/concepts/runners/self-hosted-runners
- https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners
- https://docs.github.com/en/actions/reference/security/secure-use

Decision: **REJECT for W1 authority control** in the current public-repository topology. A future private control repository or tightly restricted organization runner group may be evaluated separately, but is unnecessary for first W1 proof.

## Why GitHub-hosted runners remain auxiliary evidence only

GitHub-hosted Linux runners are hosted VMs supplied by GitHub. They are appropriate for repeatable H1–H13 canaries and CI, but they do not provide the persistent machine lifecycle that W1 is intended to admit.

Source:
- https://docs.github.com/en/actions/concepts/runners/github-hosted-runners

Decision: **KEEP as LIVE_EPHEMERAL CI evidence**, always with `persistent_worker_proof=false`.

## Why Cloudflare Containers are not W1 host proof

Cloudflare documents that Container disk is ephemeral: after a sleeping instance starts again it receives a fresh disk from the image. The default Container lifecycle also sleeps after inactivity unless changed. This is excellent for elastic/burst execution but not equivalent to a persistent host identity whose local state survives a machine reboot. Cloudflare Containers therefore remain useful later as auxiliary compute, not as the first persistent host authority.

Source:
- https://developers.cloudflare.com/containers/faq/

Decision: **REJECT as W1 authority substrate; KEEP as future burst executor** after W1/T1 safety and identity gates.

## Linux safety architecture retained

The first host should keep the minimal dependency-light baseline already implemented:

- dedicated non-root worker user;
- systemd service sandboxing and `NoNewPrivileges`;
- cgroup v2 CPU/memory/PID accounting and `cgroup.kill` lifecycle fencing;
- rlimits;
- seccomp filter boundary;
- `pidfd` process lifecycle primitives;
- `openat2` `RESOLVE_BENEATH` / `RESOLVE_NO_MAGICLINKS` workspace discipline;
- default-deny network with explicit gateway/DNS egress allowlist;
- systemd `StateDirectory` for the installation-scoped persistence witness;
- outbound HTTPS heartbeat only; no inbound SSH/runner protocol is required by the worker application itself.

## Amplifier: Landlock

Current Linux kernel documentation describes Landlock as an unprivileged, stackable LSM that lets a process further restrict its own ambient filesystem and network rights. Current ABI documentation includes TCP restrictions and newer UDP and UNIX-socket controls.

Source:
- https://www.kernel.org/doc/html/latest/userspace-api/landlock.html

Decision: **EXPERIMENT after first real W1 host proof**. It is attractive defense-in-depth because it adds restrictions without requiring privilege, but making it a hard W1 requirement now would unnecessarily narrow compatible host kernels.

## Provisioning boundary

No VM/VPS/cloud-compute management connector is currently available in this execution environment. Therefore this step intentionally makes W1 provider-neutral: once any suitable Ubuntu/Debian-class persistent VM is available, the same bootstrap and witness contract can be used. No provider credential, public inbound SSH endpoint, or GitHub runner registration is part of the W1 semantic contract.

## Recommended acceptance sequence

1. Provision one persistent Linux VM/bare-metal host with systemd and cgroup v2.
2. Install the W1 bundle with the root-only installer; the service itself runs non-root.
3. Run full H1–H13 probe and negative canaries.
4. Start outbound heartbeats and accumulate witness-bearing accepted receipts.
5. Reboot the host once.
6. Confirm the same witness and machine-id hash reappear with a new boot-id hash and the DB-observed minimum window is satisfied.
7. Produce a dedicated Linux safety verification receipt distinct from the observation producer.
8. Only then submit W1 `EVIDENCE_READY` for independent Analyst/Supervisor audit.

## Nonclaims

- No real VM was provisioned by this research step.
- No persistent W1 host is currently proven.
- A same-host time window without reboot is not accepted as persistent-worker proof.
- Cloudflare Containers and GitHub-hosted runners are not promoted to W1 authority.
- T1 remains blocked until W1 is independently verified.
