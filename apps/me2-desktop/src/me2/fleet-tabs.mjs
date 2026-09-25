/** Web conversations have provider URLs; daemon session IDs are never URLs.
 * Only native WebContents readback establishes a binding. This registry grants
 * no dispatch/lease authority and deliberately does not submit prompts.
 */
import { randomUUID } from 'node:crypto';
import { FLEET } from '../shared/me2-constants.mjs';

export function conversationUrl(value) {
  try {
    const u = new URL(value);
    if (u.origin !== FLEET.ORIGIN || u.username || u.password ||
        !/^\/c\/[A-Za-z0-9_-]+\/?$/.test(u.pathname)) return null;
    return `${u.origin}${u.pathname.replace(/\/$/, '')}`;
  } catch { return null; }
}

export function agentTabUrl(session) {
  return conversationUrl(session?.conversation_url);
}

export function matchTabForSession(session, tabs) {
  const url = agentTabUrl(session);
  if (!url) return null;
  const matches = tabs.filter(t => conversationUrl(t.url) === url);
  return matches.length === 1 ? matches[0] : null;
}

export class FleetTabs {
  constructor({ viewFactory, activate = () => {}, remove = () => {}, log = () => {}, ceiling = FLEET.TAB_CEILING } = {}) {
    this.viewFactory = viewFactory;
    this.activate = activate;
    this.remove = remove;
    this.log = log;
    this.ceiling = ceiling;
    this.tabs = new Map();
    this.pending = new Map();
  }

  openAgent(session) {
    const url = agentTabUrl(session);
    if (!url) return Promise.resolve({ ok: false, reason: 'web_conversation_url_required' });
    // Singleflight is keyed by exact provider conversation, not daemon identity.
    if (this.pending.has(url)) return this.pending.get(url);
    const job = this.open(url).finally(() => this.pending.delete(url));
    this.pending.set(url, job);
    return job;
  }

  createConversation() { return this.open(FLEET.ORIGIN + '/'); }

  async open(url) {
    for (const entry of this.tabs.values()) {
      if (url !== FLEET.ORIGIN + '/' && entry.view && !entry.crashed && !entry.view.webContents.isDestroyed() &&
          conversationUrl(entry.view.webContents.getURL()) === url) {
        this.activate(entry.tab_id);
        return { ok: true, reused: true, ...this.readback(entry) };
      }
    }
    if (this.tabs.size >= this.ceiling) return { ok: false, reason: 'tab_ceiling_reached', ceiling: this.ceiling };
    const tab_id = randomUUID();
    const entry = { tab_id, view: null, generation: 0, crashed: false };
    this.tabs.set(tab_id, entry); // Reserve capacity before any asynchronous load.
    try {
      entry.view = this.viewFactory({ id: tab_id, role: 'FLEET' });
      const wc = entry.view.webContents;
      wc.on('did-start-navigation', (_e, _url, inPlace, mainFrame) => {
        if (mainFrame && !inPlace) { entry.generation += 1; entry.crashed = false; }
      });
      wc.on('render-process-gone', () => { entry.generation += 1; entry.crashed = true; });
      wc.once('destroyed', () => { this.tabs.delete(tab_id); this.remove(tab_id); });
      await wc.loadURL(url);
      if (!this.tabs.has(tab_id) || wc.isDestroyed()) throw new Error('tab_destroyed_during_load');
      const proof = this.readback(entry);
      if (url !== FLEET.ORIGIN + '/' && proof.conversation_url !== url) {
        this.activate(tab_id); // Keep login/error surface inspectable; no resend.
        return { ok: false, reason: 'conversation_not_proven', ...proof };
      }
      this.activate(tab_id);
      this.log({ plane: 'fleet-tabs', event: 'opened', tab_id, state: proof.state });
      return { ok: true, reused: false, ...proof };
    } catch (error) {
      this.closeAgent(tab_id);
      return { ok: false, reason: 'tab_open_failed', detail: String(error?.message ?? error).slice(0, 160) };
    }
  }

  readback(entry) {
    const wc = entry.view?.webContents;
    const alive = wc && !wc.isDestroyed() && !entry.crashed;
    const url = alive ? conversationUrl(wc.getURL()) : null;
    return { tab_id: entry.tab_id, web_contents_id: alive ? wc.id : null,
      generation: entry.generation, conversation_url: url,
      state: !alive ? 'INVALIDATED' : url ? 'CONVERSATION_OBSERVED' : 'UNBOUND',
      // A URL is identity readback, not proof of a submitted/finished task.
      execution_authority: false };
  }

  closeAgent(tab_id) {
    const entry = this.tabs.get(tab_id);
    if (!entry) return { ok: false, reason: 'tab_not_found' };
    this.tabs.delete(tab_id);
    this.remove(tab_id);
    const wc = entry.view?.webContents;
    if (wc && !wc.isDestroyed()) wc.close();
    return { ok: true };
  }
  list() { return [...this.tabs.values()].map(entry => this.readback(entry)); }
}
