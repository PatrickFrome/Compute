/**
 * ME2 plane orchestrator — the boot order of the ME system inside the desktop:
 *   1. daemon (adopt → spawn → honest degraded)
 *   2. Mission Control UI (adopt :3000 → spawn standalone)
 *   3. ui-gateway (:8137, XTransformPort contract)
 *   4. update channel check (staged, verified, journaled)
 * Every stage ends in a machine-readable status; the plane NEVER lies with
 * green when a stage degraded — the window shows the truth.
 */
import { DAEMON, CONTRACT } from '../shared/me2-constants.mjs';
import { DaemonHost } from './daemon-host.mjs';
import { UiHost } from './ui-host.mjs';
import { createUiGateway } from './ui-gateway.mjs';
import { EpochFence, KEEPALIVE } from './epoch-fence.mjs';
import { probeJson } from './probes.mjs';

export class Me2Plane {
  constructor({ daemonDir, uiDistDir, electronExecPath, userDataDir, log = () => {}, updater = null } = {}) {
    this.log = log;
    this.daemonHost = new DaemonHost({ daemonDir, log });
    this.uiHost = new UiHost({ uiDistDir, electronExecPath, log });
    this.gateway = createUiGateway({ log });
    this.updater = updater; // StagedUpdater | null (tests may omit)
    this.userDataDir = userDataDir;
    this.fence = new EpochFence(); // R79: daemon boot-epoch keepalive
    this.keepaliveTimer = null;
    this.keepaliveGeneration = 0;
    this.status = {
      daemon: { ok: false, mode: null, handshake: null },
      ui: { ok: false, mode: null },
      gateway: { ok: false, port: null },
      update: { last: null },
    };
  }

  async bringUp() {
    this.log({ plane: 'me2-plane', event: 'bring_up_start' });

    const daemon = await this.daemonHost.bringUp();
    this.status.daemon = {
      ok: daemon.ok,
      mode: daemon.mode,
      handshake: daemon.handshake?.ok === true ? { contract: 'me2-daemon-contract.v1', version: daemon.handshake.version } : { reason: daemon.handshake?.reason ?? daemon.handshake?.health?.error ?? null },
    };

    const ui = await this.uiHost.bringUp();
    this.status.ui = { ok: ui.ok, mode: ui.mode ?? null, reason: ui.reason ?? null };

    try {
      const gw = await this.gateway.listen();
      this.status.gateway = { ok: true, port: gw.port };
    } catch (err) {
      this.status.gateway = { ok: false, port: null, reason: String(err?.code ?? err).slice(0, 80) };
    }

    if (this.updater) {
      try {
        this.status.update.last = await this.updater.checkOnce();
      } catch (err) {
        this.status.update.last = { ok: false, reason: String(err?.message ?? err).slice(0, 120) };
      }
    }

    this.log({ plane: 'me2-plane', event: 'bring_up_done', status: this.status });
    return this.status;
  }

  /** Honest snapshot for the window / preload bridge. */
  snapshot() {
    return {
      daemon: { ...this.status.daemon, ...this.daemonHost.snapshot(), ok: this.status.daemon.ok && this.daemonHost.status !== 'degraded' },
      ui: { ...this.status.ui, ...this.uiHost.snapshot(), ok: this.status.ui.ok && this.uiHost.status !== 'degraded' },
      gateway: this.status.gateway,
      update: this.status.update,
      fence: this.fence.snapshot(),
      ports: { daemon_ws: DAEMON.WS_PORT, daemon_rest: DAEMON.REST_PORT, ui: 3000, gateway: 8137 },
    };
  }

  /**
   * R79 keepalive: periodic daemon health probes with boot-epoch fencing.
   * Called by main.mjs AFTER bringUp (not inside bringUp — keeps tests hermetic).
   * On epoch change → re-adopt handshake + journal; on silence → backoff.
   */
  startKeepalive({ baseMs = KEEPALIVE.BASE_MS, firstDelayMs = null,
    probe = () => probeJson(`http://127.0.0.1:${DAEMON.REST_PORT}${CONTRACT.HEALTH_PATH}`, { timeoutMs: 3000 }),
    schedule = setTimeout, cancel = clearTimeout } = {}) {
    if (this.keepaliveRunning) return;
    this.keepaliveRunning = true;
    this.cancelProbeTimer = cancel;
    this.fence.baseMs = baseMs;
    const generation = ++this.keepaliveGeneration;
    const current = () => this.keepaliveRunning && generation === this.keepaliveGeneration;
    const tick = async () => {
      this.keepaliveTimer = null;
      let delay = baseMs;
      try {
        const health = await probe();
        if (!current()) return;
        const verdict = this.fence.observe({ ok: health.ok, boot: health.json?.boot ?? null });
        delay = verdict.nextProbeMs;
        this.log({ plane: 'keepalive', ...verdict });
        if (!health.ok) {
          this.status.daemon = { ...this.status.daemon, ok: false, handshake: { reason: 'daemon_unreachable' } };
        } else if (verdict.first || verdict.epochStale || !this.status.daemon.ok) {
          const re = await this.daemonHost.adopt();
          if (!current()) return;
          const ok = re?.handshake?.ok === true;
          this.status.daemon = { ...this.status.daemon, ok, handshake: ok
            ? { contract: CONTRACT.SCHEMA, version: re.handshake.version }
            : { reason: re?.handshake?.reason ?? 'readopt_failed' } };
        }
      } catch (error) {
        if (!current()) return;
        delay = this.fence.observe({ ok: false }).nextProbeMs;
        this.status.daemon = { ...this.status.daemon, ok: false, handshake: { reason: 'keepalive_failed' } };
        this.log({ plane: 'keepalive', event: 'failed', error: String(error?.message ?? error).slice(0, 160) });
      } finally {
        // A late health/adopt response cannot resurrect a stopped generation.
        if (current()) this.keepaliveTimer = schedule(tick, delay);
      }
    };
    this.keepaliveTimer = schedule(tick, firstDelayMs ?? baseMs);
  }

  stopKeepalive() {
    this.keepaliveRunning = false;
    this.keepaliveGeneration += 1;
    if (this.keepaliveTimer != null) this.cancelProbeTimer?.(this.keepaliveTimer);
    this.keepaliveTimer = null;
    this.log({ plane: 'keepalive', event: 'stopped' });
  }

  async shutdown() {
    this.stopKeepalive();
    await this.gateway.close();
    const children = await Promise.all([this.daemonHost.stop(), this.uiHost.stop()]);
    this.log({ plane: 'me2-plane', event: 'shutdown', children });
    return { ok: children.every(result => result.ok), children };
  }
}
