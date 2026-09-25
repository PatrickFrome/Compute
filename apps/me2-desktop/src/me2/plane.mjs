/**
 * ME2 plane orchestrator — the boot order of the ME system inside the desktop:
 *   1. daemon (adopt → spawn → honest degraded)
 *   2. Mission Control UI (adopt :3000 → spawn standalone)
 *   3. ui-gateway (:8137, XTransformPort contract)
 *   4. update channel check (staged, verified, journaled)
 * Every stage ends in a machine-readable status; the plane NEVER lies with
 * green when a stage degraded — the window shows the truth.
 */
import { DAEMON } from '../shared/me2-constants.mjs';
import { DaemonHost } from './daemon-host.mjs';
import { UiHost } from './ui-host.mjs';
import { createUiGateway } from './ui-gateway.mjs';

export class Me2Plane {
  constructor({ daemonDir, uiDistDir, electronExecPath, userDataDir, log = () => {}, updater = null } = {}) {
    this.log = log;
    this.daemonHost = new DaemonHost({ daemonDir, log });
    this.uiHost = new UiHost({ uiDistDir, electronExecPath, log });
    this.gateway = createUiGateway({ log });
    this.updater = updater; // StagedUpdater | null (tests may omit)
    this.userDataDir = userDataDir;
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
      ports: { daemon_ws: DAEMON.WS_PORT, daemon_rest: DAEMON.REST_PORT, ui: 3000, gateway: 8137 },
    };
  }

  async shutdown() {
    await this.gateway.close();
    this.daemonHost.child?.kill?.();
    this.uiHost.child?.kill?.();
    this.log({ plane: 'me2-plane', event: 'shutdown' });
  }
}
