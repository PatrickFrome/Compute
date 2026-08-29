const DEFAULT_LIMIT = 120;

function clone(value) {
  return value == null ? value : structuredClone(value);
}

export function sanitizeDiagnosticUrl(input) {
  try {
    const url = new URL(String(input || ''));
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    const text = url.toString();
    return text.length > 320 ? `${text.slice(0, 317)}...` : text;
  } catch {
    return null;
  }
}

export class DiagnosticBuffer {
  #limit;
  #clock;
  #sequence = 0;
  #events = [];

  constructor({ limit = DEFAULT_LIMIT, clock = () => Date.now() } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 20 || limit > 500) throw new Error('diagnostic_limit_invalid');
    if (typeof clock !== 'function') throw new Error('diagnostic_clock_invalid');
    this.#limit = limit;
    this.#clock = clock;
  }

  record(level, code, detail = {}) {
    const normalizedLevel = String(level || '').toUpperCase();
    if (!['INFO', 'WARN', 'ERROR'].includes(normalizedLevel)) throw new Error('diagnostic_level_invalid');
    const normalizedCode = String(code || '').trim().toUpperCase();
    if (!/^[A-Z0-9_:-]{2,96}$/.test(normalizedCode)) throw new Error('diagnostic_code_invalid');
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)) throw new Error('diagnostic_detail_invalid');
    const event = Object.freeze({
      sequence: ++this.#sequence,
      at: new Date(this.#clock()).toISOString(),
      level: normalizedLevel,
      code: normalizedCode,
      detail: clone(detail),
      authority_effect: false,
    });
    this.#events.push(event);
    if (this.#events.length > this.#limit) this.#events.splice(0, this.#events.length - this.#limit);
    return clone(event);
  }

  clear() {
    this.#events = [];
    return true;
  }

  snapshot() {
    return Object.freeze({
      schema: 'metaengine.browser-test.diagnostics.v1',
      limit: this.#limit,
      event_count: this.#events.length,
      last_sequence: this.#sequence,
      events: this.#events.map((event) => clone(event)),
      authority_effect: false,
    });
  }
}
