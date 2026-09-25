/**
 * ME2 fleet-tabs — bridge between the daemon fleet (12 persistent chat sessions)
 * and desktop FLEET tabs on chat.z.ai. Pure mapping logic is testable; the
 * electron WebContentsView wiring is injected (view factory), so the module
 * never imports electron itself.
 */
import { FLEET } from '../shared/me2-constants.mjs';

export function agentTabUrl(session) {
  if (!session?.id) return null;
  return `${FLEET.ORIGIN}/c/${encodeURIComponent(session.id)}`;
}

export function matchTabForSession(session, tabs) {
  if (!session?.id) return null;
  const suffix = `/c/${session.id}`;
  const byUrl = tabs.filter((t) => typeof t.url === 'string' && t.url.includes(suffix));
  if (byUrl.length === 1) return byUrl[0];
  const zai = byUrl.filter((t) => t.url.startsWith(FLEET.ORIGIN));
  if (zai.length === 1) return zai[0];
  const byTitle = session.title ? tabs.filter((t) => typeof t.title === 'string' && t.title.includes(session.title)) : [];
  if (byTitle.length === 1) return byTitle[0];
  return null;
}

export class FleetTabs {
  constructor({ viewFactory, log = () => {} } = {}) {
    this.viewFactory = viewFactory; // ({url, role}) => WebContentsView-like
    this.log = log;
    this.tabs = new Map(); // sessionId -> view
  }

  /** Open (or focus) the z.ai tab for one fleet session. Honest result. */
  openAgent(session) {
    const url = agentTabUrl(session);
    if (!url) return { ok: false, reason: 'session_invalid' };
    if (this.tabs.size >= FLEET.TAB_CEILING && !this.tabs.has(session.id)) {
      return { ok: false, reason: 'tab_ceiling_reached', ceiling: FLEET.TAB_CEILING };
    }
    let view = this.tabs.get(session.id);
    if (!view) {
      view = this.viewFactory({ url, role: 'FLEET' });
      this.tabs.set(session.id, view);
      this.log({ plane: 'fleet-tabs', event: 'opened', session: session.id });
    }
    return { ok: true, url, reused: Boolean(view) };
  }

  closeAgent(sessionId) {
    const view = this.tabs.get(sessionId);
    if (!view) return { ok: false, reason: 'tab_not_found' };
    this.tabs.delete(sessionId);
    try {
      view.webContents?.close?.();
    } catch {
      /* view already gone */
    }
    return { ok: true };
  }

  list() {
    return [...this.tabs.keys()];
  }
}
