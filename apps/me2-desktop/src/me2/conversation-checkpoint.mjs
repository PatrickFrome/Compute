import { FLEET } from '../shared/me2-constants.mjs';
import { readJson, writeJsonAtomic } from '../shared/durable-file.mjs';
import { conversationUrl } from './fleet-tabs.mjs';

/** Resume addresses only: never persists task authority, prompts, cookies or leases. */
export class ConversationCheckpoint {
  constructor({ file, ceiling = FLEET.TAB_CEILING, log = () => {} }) {
    this.file = file; this.ceiling = ceiling; this.log = log;
    const data = readJson(file);
    this.urls = new Set(data?.schema === 'me2-conversations.v1' && Array.isArray(data.urls)
      ? data.urls.map(conversationUrl).filter(Boolean).slice(0, ceiling) : []);
  }
  list() { return [...this.urls]; }
  save() {
    try { writeJsonAtomic(this.file, { schema: 'me2-conversations.v1', urls: this.list() }); return { ok: true }; }
    catch (error) { this.log({ event: 'checkpoint_failed', code: String(error?.code ?? 'write_failed') }); return { ok: false }; }
  }
  remember(value) {
    const url = conversationUrl(value);
    if (!url || this.urls.has(url) || this.urls.size >= this.ceiling) return;
    this.urls.add(url); this.save();
  }
  forget(value) { if (this.urls.delete(conversationUrl(value))) this.save(); }
}
