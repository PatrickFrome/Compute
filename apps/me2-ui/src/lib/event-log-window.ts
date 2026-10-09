type SequencedEvent = { seq: number };

// Retain the visible window itself: a sequence cutoff alone loses history when
// the live transport evicts old entries from its bounded buffer.
export function captureEventLogWindow<T extends SequencedEvent>(events: readonly T[]): readonly T[] {
  return Object.freeze([...events]);
}

export function eventLogWindow<T extends SequencedEvent>(events: readonly T[], paused: readonly T[] | null) {
  const newestPausedSequence = paused?.reduce((max, event) => Math.max(max, event.seq), -Infinity) ?? -Infinity;
  return {
    events: paused ?? events,
    paused: paused !== null,
    newerBufferedCount: paused === null ? 0 : events.filter((event) => event.seq > newestPausedSequence).length,
  };
}
