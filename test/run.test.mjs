import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runSchedule } from '../src/run.mjs';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../examples/${name}.json`, import.meta.url), 'utf8'));

function metrics(completedTasks, makespan, totalWaiting, maxWaiting, busyTime, totalTurnaround) {
  return {
    completedTasks, makespan, totalWaiting, meanWaiting: totalWaiting / completedTasks,
    maxWaiting, totalTurnaround, meanTurnaround: totalTurnaround / completedTasks,
    busyTime, idleTime: makespan - busyTime, utilization: busyTime / makespan,
  };
}

test('both policies match the hand-calculated simultaneous-arrival fixture', () => {
  const input = fixture('policy-comparison');
  assert.deepEqual(runSchedule(input, 'fifo'), {
    schemaVersion: 1, policy: 'fifo',
    schedule: [
      { id: 'A', start: 0, finish: 5, waiting: 0, turnaround: 5 },
      { id: 'B', start: 5, finish: 6, waiting: 5, turnaround: 6 },
      { id: 'C', start: 6, finish: 8, waiting: 6, turnaround: 8 },
    ],
    metrics: metrics(3, 8, 11, 6, 8, 19),
  });
  assert.deepEqual(runSchedule(input, 'sjf'), {
    schemaVersion: 1, policy: 'sjf',
    schedule: [
      { id: 'B', start: 0, finish: 1, waiting: 0, turnaround: 1 },
      { id: 'C', start: 1, finish: 3, waiting: 1, turnaround: 3 },
      { id: 'A', start: 3, finish: 8, waiting: 3, turnaround: 8 },
    ],
    metrics: metrics(3, 8, 4, 3, 8, 12),
  });
});

test('the staggered fixture demonstrates lower mean but worse maximum SJF waiting', () => {
  const input = fixture('fairness-tradeoff');
  const fifo = runSchedule(input, 'fifo');
  const sjf = runSchedule(input, 'sjf');
  assert.deepEqual(fifo.schedule, [
    { id: 'A', start: 0, finish: 3, waiting: 0, turnaround: 3 },
    { id: 'long', start: 3, finish: 6, waiting: 2, turnaround: 5 },
    { id: 'short-1', start: 6, finish: 7, waiting: 5, turnaround: 6 },
    { id: 'short-2', start: 7, finish: 8, waiting: 5, turnaround: 6 },
    { id: 'short-3', start: 8, finish: 9, waiting: 5, turnaround: 6 },
    { id: 'short-4', start: 9, finish: 10, waiting: 5, turnaround: 6 },
  ]);
  assert.deepEqual(sjf.schedule, [
    { id: 'A', start: 0, finish: 3, waiting: 0, turnaround: 3 },
    { id: 'short-1', start: 3, finish: 4, waiting: 2, turnaround: 3 },
    { id: 'short-2', start: 4, finish: 5, waiting: 2, turnaround: 3 },
    { id: 'short-3', start: 5, finish: 6, waiting: 2, turnaround: 3 },
    { id: 'short-4', start: 6, finish: 7, waiting: 2, turnaround: 3 },
    { id: 'long', start: 7, finish: 10, waiting: 6, turnaround: 9 },
  ]);
  assert.deepEqual(fifo.metrics, metrics(6, 10, 22, 5, 10, 32));
  assert.deepEqual(sjf.metrics, metrics(6, 10, 14, 6, 10, 24));
  assert.ok(sjf.metrics.meanWaiting < fifo.metrics.meanWaiting);
  assert.ok(sjf.metrics.maxWaiting > fifo.metrics.maxWaiting);
});

test('runner defaults to FIFO and preserves inputs and reproducibility across permutations', () => {
  const input = fixture('fairness-tradeoff');
  const before = structuredClone(input);
  assert.deepEqual(runSchedule(input), runSchedule(input, 'fifo'));
  for (const policy of ['fifo', 'sjf']) {
    const result = runSchedule(input, policy);
    assert.deepEqual(runSchedule(input, policy), result);
    assert.deepEqual(runSchedule({ ...input, tasks: [...input.tasks].reverse() }, policy), result);
    result.schedule[0].waiting = 123;
    result.metrics.maxWaiting = 123;
    assert.notDeepEqual(runSchedule(input, policy), result);
  }
  assert.deepEqual(input, before);
});

test('both policies handle empty workloads with zero-valued metrics', () => {
  for (const policy of ['fifo', 'sjf']) {
    assert.deepEqual(runSchedule({ schemaVersion: 1, tasks: [] }, policy), {
      schemaVersion: 1, policy, schedule: [], metrics: {
        completedTasks: 0, makespan: 0, totalWaiting: 0, meanWaiting: 0,
        maxWaiting: 0, totalTurnaround: 0, meanTurnaround: 0, busyTime: 0, idleTime: 0, utilization: 0,
      },
    });
  }
});

test('tiny workload preserves idle advancement and gives identical schedules under both policies', () => {
  for (const policy of ['fifo', 'sjf']) {
    const result = runSchedule(fixture('tiny'), policy);
    assert.deepEqual(result.metrics, metrics(3, 9, 2, 2, 6, 8));
    assert.deepEqual(result.schedule.map(({ id }) => id), ['A', 'B', 'C']);
  }
});

test('runner rejects unknown policies even for empty input and validates workloads', () => {
  assert.throws(() => runSchedule({ schemaVersion: 1, tasks: [] }, 'constructor'), /Unknown policy/);
  for (const policy of ['fifo', 'sjf']) {
    assert.throws(() => runSchedule({ schemaVersion: 1, tasks: [{ id: 'A', release: 0, duration: 0 }] }, policy));
  }
});
