import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  mergeExactTaskEvidenceEvents,
  resolveExactTaskStreamResponse,
  taskStreamResponseStillCurrent,
} from '../../me2-ui/src/lib/r95e-evidence-contracts.mjs';

const read = (url) => readFile(new URL(url, import.meta.url), 'utf8');
const store = await read('../../me2-ui/src/components/me2/store.tsx');
const observe = await read('../../me2-ui/src/components/me2/pages/observability.tsx');

test('R95E.1 delayed task-event responses are admitted only for the exact current generation and task', () => {
  const request = { seq: 7, taskId: 'task-b' };
  assert.equal(taskStreamResponseStillCurrent(request, {
    seq: 7,
    taskId: 'task-b',
    streamTaskId: 'task-b',
  }), true);

  assert.equal(taskStreamResponseStillCurrent(request, {
    seq: 8,
    taskId: 'task-b',
    streamTaskId: 'task-b',
  }), false);
  assert.equal(taskStreamResponseStillCurrent(request, {
    seq: 7,
    taskId: 'task-a',
    streamTaskId: 'task-a',
  }), false);
  assert.equal(taskStreamResponseStillCurrent(request, {
    seq: 7,
    taskId: 'task-b',
    streamTaskId: 'task-a',
  }), false);
});

test('R95E.1 exact evidence merge rejects stale stream identity and deduplicates exact event sequence', () => {
  const globalEvents = [
    { seq: 12, task_id: 'task-b', type: 'GLOBAL_B', data: 'global-b' },
    { seq: 11, task_id: 'task-a', type: 'GLOBAL_A', data: 'global-a' },
  ];
  const fetched = [
    { seq: 12, task_id: 'task-b', type: 'FETCHED_B', data: 'fetched-b' },
    { seq: 10, task_id: 'task-b', type: 'OLDER_B', data: 'older-b' },
    { seq: 9, task_id: 'task-a', type: 'WRONG_TASK', data: 'wrong' },
  ];

  const exact = mergeExactTaskEvidenceEvents({
    taskId: 'task-b',
    events: globalEvents,
    streamTaskId: 'task-b',
    stream: fetched,
    limit: 40,
  });
  assert.deepEqual(exact.map((row) => row.seq), [12, 10]);
  assert.equal(exact[0].type, 'GLOBAL_B');

  const stale = mergeExactTaskEvidenceEvents({
    taskId: 'task-b',
    events: globalEvents,
    streamTaskId: 'task-a',
    stream: fetched,
    limit: 40,
  });
  assert.deepEqual(stale.map((row) => row.seq), [12]);
  assert.equal(stale[0].type, 'GLOBAL_B');
});

test('R95E.1 event join stays bounded even when exact fetched history is larger than the global window', () => {
  const stream = Array.from({ length: 250 }, (_, index) => ({
    seq: index + 1,
    task_id: 'task-z',
    type: 'EVENT',
    data: String(index),
  }));
  const exact = mergeExactTaskEvidenceEvents({
    taskId: 'task-z',
    events: [],
    streamTaskId: 'task-z',
    stream,
    limit: 40,
  });
  assert.equal(exact.length, 40);
  assert.equal(exact[0].seq, 250);
  assert.equal(exact.at(-1).seq, 211);
});

test('R95E.2 store advances generation on every open and routes history through the executable race reducer', () => {
  assert.match(store, /let taskStreamRequestSeq = 0/);
  assert.match(store, /const requestSeq = \+\+taskStreamRequestSeq/);
  assert.match(store, /streamTaskId: id/);
  assert.match(store, /taskStreamResponseStillCurrent\(/);
  assert.match(store, /resolveExactTaskStreamResponse\(\{/);
  assert.match(store, /request: \{ seq: requestSeq, taskId: id \}/);
  assert.match(store, /seq: taskStreamRequestSeq/);
  assert.match(store, /taskId: state\.inspectedTaskId/);
  assert.match(store, /streamTaskId: state\.streamTaskId/);
  assert.match(store, /responseEvents: d\?\.events \?\? null/);
  assert.match(store, /closeTask: \(\) => \{[\s\S]{0,180}set\(\{ detail: null \}\)/);
  assert.doesNotMatch(store, /closeTask: \(\) => \{[\s\S]{0,180}streamTaskId: null/);
});

test('R95E.1 live exact events survive the bounded fetch merge while wrong-task events fail closed', () => {
  assert.match(store, /st\.streamTaskId === st\.inspectedTaskId/);
  assert.match(store, /e\.task_id === st\.inspectedTaskId/);
  assert.match(store, /resolveExactTaskStreamResponse\(\{/);
});

test('R95E.1 OBSERVE consumes only the shared exact-task join contract', () => {
  assert.match(observe, /mergeExactTaskEvidenceEvents\(\{/);
  assert.match(observe, /taskId: inspectedTaskId/);
  assert.match(observe, /streamTaskId/);
  assert.match(observe, /limit: 40/);
  assert.match(observe, /fetched task history is admitted only when streamTaskId matches the selected task/);
});

test('R95E.2 exact history fetch is bounded and surfaces degraded readback honestly', () => {
  assert.match(store, /streamState: "UNBOUND" \| "LOADING" \| "EXACT" \| "DEGRADED"/);
  assert.match(store, /streamState: "LOADING"/);
  assert.match(store, /AbortSignal\.timeout\(8_000\)/);
  assert.match(store, /resolveExactTaskStreamResponse\(\{/);
  assert.match(store, /responseEvents: d\?\.events \?\? null/);
  assert.match(store, /limit: 200/);
  assert.match(observe, /data-history-state=\{streamState\}/);
  assert.match(observe, /history \$\{streamState\.toLowerCase\(\)\}/);
});

test('R95E.2 closing Task Sheet preserves exact inspected history for OBSERVE', () => {
  const closeStart = store.indexOf('closeTask: () => {');
  const closeEnd = store.indexOf('setChatId:', closeStart);
  const block = store.slice(closeStart, closeEnd);
  assert.match(block, /set\(\{ detail: null \}\)/);
  assert.doesNotMatch(block, /taskStreamRequestSeq \+= 1/);
  assert.doesNotMatch(block, /stream:\s*\[\]/);
  assert.doesNotMatch(block, /streamTaskId:\s*null/);
  assert.doesNotMatch(block, /inspectedTaskId:\s*null/);
});


test('R96 release reducer rejects a delayed A response after B becomes current and preserves live B over fetched B', () => {
  const delayedA = resolveExactTaskStreamResponse({
    request: { seq: 41, taskId: 'task-a' },
    current: {
      seq: 42,
      taskId: 'task-b',
      streamTaskId: 'task-b',
      stream: [{ seq: 22, task_id: 'task-b', type: 'LIVE_B', data: 'live' }],
    },
    responseEvents: [{ seq: 21, task_id: 'task-a', type: 'FETCH_A', data: 'stale' }],
    limit: 200,
  });
  assert.equal(delayedA.applied, false);
  assert.equal(delayedA.patch, null);

  const exactB = resolveExactTaskStreamResponse({
    request: { seq: 42, taskId: 'task-b' },
    current: {
      seq: 42,
      taskId: 'task-b',
      streamTaskId: 'task-b',
      stream: [
        { seq: 22, task_id: 'task-b', type: 'LIVE_B', data: 'live wins' },
        { seq: 24, task_id: 'task-a', type: 'WRONG_LIVE', data: 'reject' },
      ],
    },
    responseEvents: [
      { seq: 22, task_id: 'task-b', type: 'FETCH_B_DUP', data: 'older duplicate' },
      { seq: 20, task_id: 'task-b', type: 'FETCH_B_OLD', data: 'history' },
      { seq: 19, task_id: 'task-a', type: 'WRONG_FETCH', data: 'reject' },
      { seq: Number.NaN, task_id: 'task-b', type: 'BAD_SEQ', data: 'reject' },
    ],
    limit: 200,
  });
  assert.equal(exactB.applied, true);
  assert.equal(exactB.patch.streamState, 'EXACT');
  assert.deepEqual(exactB.patch.stream.map((row) => row.seq), [20, 22]);
  assert.equal(exactB.patch.stream[1].type, 'LIVE_B');
});

test('R96 release reducer surfaces bounded history failure as DEGRADED only for the exact current task', () => {
  const current = {
    seq: 9,
    taskId: 'task-z',
    streamTaskId: 'task-z',
    stream: [{ seq: 3, task_id: 'task-z', type: 'LIVE', data: 'keep' }],
  };
  const degraded = resolveExactTaskStreamResponse({
    request: { seq: 9, taskId: 'task-z' },
    current,
    responseEvents: null,
  });
  assert.equal(degraded.applied, true);
  assert.deepEqual(degraded.patch, { streamState: 'DEGRADED' });

  const staleFailure = resolveExactTaskStreamResponse({
    request: { seq: 8, taskId: 'task-z' },
    current,
    responseEvents: null,
  });
  assert.equal(staleFailure.applied, false);
  assert.equal(staleFailure.patch, null);
});
