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
      daemon: { ...this.status.daemon, ...this.daemonHost.snapshot() },
      ui: { ...this.status.ui, ...this.uiHost.snapshot() },
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
  startKeepalive({ baseMs = KEEPALIVE.BASE_MS, firstDelayMs = null } = {}) {
    if (this.keepaliveTimer) return;
    const tick = async () => {
      const health = await probeJson(`http://127.0.0.1:${DAEMON.REST_PORT}${CONTRACT.HEALTH_PATH}`, { timeoutMs: 3000 });
      const verdict = this.fence.observe({ ok: health.ok, boot: health.json?.boot ?? null });
      this.log({ plane: 'keepalive', ...verdict });
      if (verdict.epochStale) {
        const re = await this.daemonHost.adopt();
        this.status.daemon = re?.handshake?.ok === true
          ? { ...this.status.daemon, handshake: { contract: CONTRACT.SCHEMA, version: re.handshake.version } }
          : { ...this.status.daemon, handshake: { reason: re?.handshake?.reason ?? 'readopt_failed' } };
      }
      this.keepaliveTimer = setTimeout(tick, verdict.nextProbeMs);
    };
    this.keepaliveTimer = setTimeout(tick, firstDelayMs ?? baseMs);
  }

  stopKeepalive() {
    if (this.keepaliveTimer) {
      clearTimeout(this.keepaliveTimer);
      this.keepaliveTimer = null;
      this.log({ plane: 'keepalive', event: 'stopped' });
    }
  }

  async shutdown() {
    this.stopKeepalive();
    await this.gateway.close();
    this.daemonHost.child?.kill?.();
    this.uiHost.child?.kill?.();
    this.log({ plane: 'me2-plane', event: 'shutdown' });
  }
}
