export const PROCESS_OBSERVER_RUNTIME_VERSION = '1.0.0';

const clone = (value) => value == null ? value : structuredClone(value);

function validateSource(source) {
  if (!source || typeof source !== 'object' || typeof source.read !== 'function') throw new Error('process_observer_source_invalid');
  const id = String(source.id || '').trim();
  if (!id || id.length > 160 || /[\r\n]/.test(id)) throw new Error('process_observer_source_id_invalid');
  return { ...source, id };
}

export class ProcessObserverRuntime {
  #intelligence;
  #sources;
  #clock;
  #intervalMs;
  #timer = null;
  #inflight = null;
  #lastPollAt = null;
  #sourceStatus = new Map();

  constructor({ intelligence, sources = [], clock = () => Date.now(), intervalMs = 5000 } = {}) {
    if (!intelligence || typeof intelligence.ingestProcessObservation !== 'function') throw new Error('process_observer_intelligence_required');
    if (!Array.isArray(sources)) throw new Error('process_observer_sources_invalid');
    this.#intelligence = intelligence;
    this.#sources = sources.map(validateSource);
    this.#clock = clock;
    this.#intervalMs = Math.max(1000, Number(intervalMs) || 5000);
  }

  snapshot() {
    return Object.freeze({
      schema: 'metaengine.browser.process-observer.snapshot.v1',
      version: PROCESS_OBSERVER_RUNTIME_VERSION,
      running: Boolean(this.#timer),
      last_poll_at: this.#lastPollAt,
      sources: [...this.#sourceStatus.entries()].map(([id, row]) => ({ id, ...clone(row) })),
      authority_effect: false,
    });
  }

  async pollOnce() {
    if (this.#inflight) return this.#inflight;
    const run = this.#pollInternal();
    this.#inflight = run.finally(() => { this.#inflight = null; });
    return this.#inflight;
  }

  async #pollInternal() {
    const startedAt = new Date(this.#clock()).toISOString();
    for (const source of this.#sources) {
      try {
        const result = await source.read();
        const rows = Array.isArray(result?.observations) ? result.observations : [];
        let ingested = 0;
        for (const observation of rows) {
          await this.#intelligence.ingestProcessObservation(observation);
          ingested += 1;
        }
        this.#sourceStatus.set(source.id, {
          ok: true,
          cursor: result?.cursor == null ? null : String(result.cursor).slice(0, 500),
          observation_count: ingested,
          observed_at: new Date(this.#clock()).toISOString(),
          last_error: null,
        });
      } catch (error) {
        const prior = this.#sourceStatus.get(source.id) || {};
        this.#sourceStatus.set(source.id, {
          ...prior,
          ok: false,
          observed_at: new Date(this.#clock()).toISOString(),
          last_error: String(error?.message || error).slice(0, 240),
        });
      }
    }
    this.#lastPollAt = startedAt;
    return this.snapshot();
  }

  start() {
    if (this.#timer) return this.snapshot();
    const tick = () => this.pollOnce().catch(() => {});
    tick();
    this.#timer = setInterval(tick, this.#intervalMs);
    this.#timer.unref?.();
    return this.snapshot();
  }

  stop() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    return this.snapshot();
  }
}
