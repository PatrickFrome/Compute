import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserMainEventLoopPressure } from '../src/browser-main-event-loop-pressure.mjs';

test('derives ELU and p95 drift from caller cadence without owning a timer', () => {
  let now = 0;
  let cumulative = { idle: 0, active: 0, utilization: 0 };
  const elu = (...args) => {
    if (args.length === 0) return { ...cumulative };
    const [current, previous] = args;
    const active = current.active - previous.active;
    const idle = current.idle - previous.idle;
    return { active, idle, utilization: active / Math.max(1, active + idle) };
  };
  const sampler = new BrowserMainEventLoopPressure({
    clock: () => now,
    eventLoopUtilization: elu,
    expectedIntervalMs: 250,
    maxDelaySamples: 8,
  });

  cumulative = { idle: 180, active: 20, utilization: 0.1 };
  sampler.sample();
  now = 255;
  cumulative = { idle: 400, active: 50, utilization: 0.111 };
  sampler.sample();
  now = 530;
  cumulative = { idle: 620, active: 80, utilization: 0.114 };
  const row = sampler.sample();

  assert.equal(row.event_loop_utilization, 30 / 250);
  assert.equal(row.event_loop_delay_sample_count, 2);
  assert.equal(row.event_loop_delay_p95_ms, 25);
  assert.equal(row.delay_source, 'EXISTING_PROCESS_SAMPLER_DRIFT');
  assert.equal(row.dedicated_timer, false);
  assert.equal(row.second_scheduler, false);
});

test('delay history stays bounded', () => {
  let now = 0;
  let n = 0;
  const sampler = new BrowserMainEventLoopPressure({
    clock: () => now,
    eventLoopUtilization: (...args) => {
      if (args.length === 0) return { idle: n * 100, active: n * 10, utilization: 0.1 };
      return { idle: 100, active: 10, utilization: 10 / 110 };
    },
    expectedIntervalMs: 100,
    maxDelaySamples: 8,
  });
  sampler.sample();
  for (let i = 0; i < 30; i += 1) {
    n += 1;
    now += 101 + (i % 4);
    sampler.sample();
  }
  assert.equal(sampler.snapshot().event_loop_delay_sample_count, 8);
  assert.equal(sampler.snapshot().bounded_delay_samples, 8);
});
