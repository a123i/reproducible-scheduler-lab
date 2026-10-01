import test from 'node:test';
import assert from 'node:assert/strict';
import { SchedulingEnv, validateWorkload } from '../src/env.mjs';

const tiny = () => ({
  schemaVersion: 1,
  tasks: [
    { id: 'A', release: 0, duration: 3 },
    { id: 'B', release: 1, duration: 2 },
    { id: 'C', release: 8, duration: 1 },
  ],
});

const transitions = [
  { id: 'A', start: 0, finish: 3, waiting: 0, turnaround: 3 },
  { id: 'B', start: 3, finish: 5, waiting: 2, turnaround: 4 },
  { id: 'C', start: 8, finish: 9, waiting: 0, turnaround: 1 },
];

const finalMetrics = {
  completedTasks: 3,
  makespan: 9,
  totalWaiting: 2,
  meanWaiting: 2 / 3,
  maxWaiting: 2,
  totalTurnaround: 8,
  meanTurnaround: 8 / 3,
  busyTime: 6,
  idleTime: 3,
  utilization: 2 / 3,
};

test('validation accepts valid and empty workloads without changing them', () => {
  for (const input of [tiny(), { schemaVersion: 1, tasks: [] }]) {
    const before = structuredClone(input);
    assert.doesNotThrow(() => validateWorkload(input));
    assert.deepEqual(input, before);
  }
});

test('validation rejects malformed workloads and tasks', async (t) => {
  const task = { id: 'A', release: 0, duration: 1 };
  const cases = [
    ['null workload', null],
    ['array workload', []],
    ['missing schema version', { tasks: [] }],
    ['unsupported schema version', { schemaVersion: 2, tasks: [] }],
    ['string schema version', { schemaVersion: '1', tasks: [] }],
    ['missing tasks', { schemaVersion: 1 }],
    ['nonarray tasks', { schemaVersion: 1, tasks: {} }],
    ['null task', { schemaVersion: 1, tasks: [null] }],
    ['array task', { schemaVersion: 1, tasks: [[]] }],
    ['empty id', { schemaVersion: 1, tasks: [{ ...task, id: '' }] }],
    ['leading id whitespace', { schemaVersion: 1, tasks: [{ ...task, id: ' A' }] }],
    ['trailing id whitespace', { schemaVersion: 1, tasks: [{ ...task, id: 'A\n' }] }],
    ['nonstring id', { schemaVersion: 1, tasks: [{ ...task, id: 1 }] }],
    ['isolated high surrogate id', { schemaVersion: 1, tasks: [{ ...task, id: '\uD800' }] }],
    ['isolated low surrogate id', { schemaVersion: 1, tasks: [{ ...task, id: '\uDC00' }] }],
    ['duplicate id', { schemaVersion: 1, tasks: [task, { ...task }] }],
    ['negative release', { schemaVersion: 1, tasks: [{ ...task, release: -1 }] }],
    ['fractional release', { schemaVersion: 1, tasks: [{ ...task, release: 0.5 }] }],
    ['string release', { schemaVersion: 1, tasks: [{ ...task, release: '0' }] }],
    ['infinite release', { schemaVersion: 1, tasks: [{ ...task, release: Infinity }] }],
    ['unsafe release', { schemaVersion: 1, tasks: [{ ...task, release: Number.MAX_SAFE_INTEGER + 1 }] }],
    ['zero duration', { schemaVersion: 1, tasks: [{ ...task, duration: 0 }] }],
    ['negative duration', { schemaVersion: 1, tasks: [{ ...task, duration: -1 }] }],
    ['fractional duration', { schemaVersion: 1, tasks: [{ ...task, duration: 1.5 }] }],
    ['string duration', { schemaVersion: 1, tasks: [{ ...task, duration: '1' }] }],
    ['NaN duration', { schemaVersion: 1, tasks: [{ ...task, duration: NaN }] }],
    ['unsafe duration', { schemaVersion: 1, tasks: [{ ...task, duration: Number.MAX_SAFE_INTEGER + 1 }] }],
  ];
  for (const [label, input] of cases) {
    await t.test(label, () => {
      assert.throws(() => validateWorkload(input));
      assert.throws(() => new SchedulingEnv(input));
    });
  }
});

test('sparse task arrays are rejected rather than silently skipping empty slots', () => {
  const input = { schemaVersion: 1, tasks: new Array(1) };
  assert.throws(() => validateWorkload(input), TypeError);
  assert.throws(() => new SchedulingEnv(input), TypeError);
});

test('validation enforces the conservative safe-integer time horizon', () => {
  const max = Number.MAX_SAFE_INTEGER;
  assert.doesNotThrow(() => validateWorkload({
    schemaVersion: 1,
    tasks: [{ id: 'edge', release: max - 1, duration: 1 }],
  }));
  assert.throws(() => validateWorkload({
    schemaVersion: 1,
    tasks: [{ id: 'overflow', release: max, duration: 1 }],
  }));
  assert.throws(() => validateWorkload({
    schemaVersion: 1,
    tasks: [
      { id: 'late', release: max - 2, duration: 1 },
      { id: 'early', release: 0, duration: 2 },
    ],
  }));
  assert.throws(() => validateWorkload({
    schemaVersion: 1,
    tasks: [
      { id: 'A', release: 0, duration: max },
      { id: 'B', release: 0, duration: 1 },
    ],
  }));
});

test('aggregate metrics remain within safe integers even when the horizon is valid', () => {
  const max = Number.MAX_SAFE_INTEGER;
  assert.doesNotThrow(() => validateWorkload({
    schemaVersion: 1,
    tasks: [{ id: 'single', release: 0, duration: max }],
  }));
  assert.throws(() => validateWorkload({
    schemaVersion: 1,
    tasks: [
      { id: 'long', release: 0, duration: max - 2 },
      { id: 'short-A', release: 0, duration: 1 },
      { id: 'short-B', release: 0, duration: 1 },
    ],
  }), { name: 'RangeError', message: /aggregate/i });
});

test('reset partitions ready and pending tasks at the initial time', () => {
  const env = new SchedulingEnv(tiny());
  assert.deepEqual(env.reset(), {
    time: 0,
    ready: [{ id: 'A', release: 0, duration: 3 }],
    pending: [
      { id: 'B', release: 1, duration: 2 },
      { id: 'C', release: 8, duration: 1 },
    ],
    completed: [],
    terminated: false,
  });
});

test('task ordering uses release time then Unicode code points', () => {
  const env = new SchedulingEnv({
    schemaVersion: 1,
    tasks: [
      { id: '\u{10000}', release: 0, duration: 1 },
      { id: 'a', release: 0, duration: 1 },
      { id: 'Z', release: 0, duration: 1 },
      { id: '\uE000', release: 0, duration: 1 },
      { id: 'later-A', release: 4, duration: 1 },
      { id: 'earlier-z', release: 3, duration: 1 },
      { id: 'A', release: 0, duration: 1 },
    ],
  });
  const observation = env.reset();
  assert.deepEqual(observation.ready.map(({ id }) => id), ['A', 'Z', 'a', '\uE000', '\u{10000}']);
  assert.deepEqual(observation.pending.map(({ id }) => id), ['earlier-z', 'later-A']);
});

test('FIFO execution produces exact transitions, rewards, and final metrics', () => {
  const env = new SchedulingEnv(tiny());
  env.reset();
  const results = ['A', 'B', 'C'].map((id) => env.step(id));
  assert.deepEqual(results.map(({ info }) => info.transition), transitions);
  assert.deepEqual(results.map(({ reward }) => reward), [0, -2, 0]);
  assert.equal(Object.is(results[0].reward, -0), false);
  assert.equal(Object.is(results[2].reward, -0), false);
  assert.deepEqual(results.map(({ terminated }) => terminated), [false, false, true]);
  assert.equal(results[1].observation.time, 8);
  assert.deepEqual(results[1].observation.ready, [{ id: 'C', release: 8, duration: 1 }]);
  assert.deepEqual(results[2].info.metrics, finalMetrics);
  assert.deepEqual(results[2].observation, {
    time: 9, ready: [], pending: [], completed: transitions, terminated: true,
  });
});

test('the worker advances across initial idle time and respects the safe boundary', () => {
  const max = Number.MAX_SAFE_INTEGER;
  const env = new SchedulingEnv({
    schemaVersion: 1,
    tasks: [{ id: 'edge', release: max - 1, duration: 1 }],
  });
  assert.equal(env.reset().time, max - 1);
  const result = env.step('edge');
  assert.deepEqual(result.info.transition, {
    id: 'edge', start: max - 1, finish: max, waiting: 0, turnaround: 1,
  });
  assert.equal(result.info.metrics.makespan, max);
  assert.equal(result.info.metrics.idleTime, max - 1);
  assert.equal(result.info.metrics.busyTime, 1);
  assert.equal(result.info.metrics.utilization, 1 / max);
});

test('a policy may choose any ready task and execution remains nonpreemptive', () => {
  const env = new SchedulingEnv({
    schemaVersion: 1,
    tasks: [
      { id: 'long', release: 0, duration: 4 },
      { id: 'short', release: 0, duration: 1 },
      { id: 'arriving', release: 2, duration: 1 },
    ],
  });
  env.reset();
  assert.deepEqual(env.step('short').info.transition, {
    id: 'short', start: 0, finish: 1, waiting: 0, turnaround: 1,
  });
  const second = env.step('long');
  assert.deepEqual(second.info.transition, {
    id: 'long', start: 1, finish: 5, waiting: 1, turnaround: 5,
  });
  assert.deepEqual(second.observation.ready, [{ id: 'arriving', release: 2, duration: 1 }]);
  const last = env.step('arriving');
  assert.deepEqual(last.info.transition, {
    id: 'arriving', start: 5, finish: 6, waiting: 3, turnaround: 4,
  });
  assert.deepEqual(last.info.metrics, {
    completedTasks: 3, makespan: 6, totalWaiting: 4, meanWaiting: 4 / 3, maxWaiting: 3,
    totalTurnaround: 10, meanTurnaround: 10 / 3, busyTime: 6, idleTime: 0, utilization: 1,
  });
});

test('invalid actions throw without consuming time or tasks', () => {
  const env = new SchedulingEnv(tiny());
  env.reset();
  for (const action of ['B', 'unknown', undefined, null, 0, { id: 'A' }]) {
    assert.throws(() => env.step(action));
  }
  const first = env.step('A');
  assert.deepEqual(first.info.transition, transitions[0]);
  assert.equal(first.info.metrics.completedTasks, 1);
  assert.equal(first.info.metrics.busyTime, 3);
  assert.throws(() => env.step('A'));
  assert.deepEqual(env.step('B').info.transition, transitions[1]);
  assert.deepEqual(env.step('C').info.metrics, finalMetrics);
  assert.throws(() => env.step('C'));
});

test('empty workloads terminate immediately and reject all actions', () => {
  const env = new SchedulingEnv({ schemaVersion: 1, tasks: [] });
  const expected = { time: 0, ready: [], pending: [], completed: [], terminated: true };
  assert.deepEqual(env.reset(), expected);
  assert.throws(() => env.step('anything'));
  assert.deepEqual(env.reset(), expected);
});

test('constructor inputs and returned observations cannot mutate the environment', () => {
  const input = tiny();
  const env = new SchedulingEnv(input);
  const initial = env.reset();
  input.tasks[0].duration = 900;
  input.tasks.length = 0;
  initial.time = 1000;
  initial.ready[0].duration = 800;
  initial.ready.push({ id: 'injected', release: 0, duration: 1 });
  initial.pending[0].release = 700;
  initial.pending.length = 0;
  initial.completed.push({ id: 'injected' });
  assert.deepEqual(env.step('A').info.transition, transitions[0]);
  assert.deepEqual(env.reset(), new SchedulingEnv(tiny()).reset());
});

test('step results and metrics are snapshots independent from later state', () => {
  const env = new SchedulingEnv(tiny());
  env.reset();
  const first = env.step('A');
  const saved = structuredClone(first);
  const second = env.step('B');
  assert.deepEqual(first, saved);
  second.info.transition.finish = 500;
  second.info.metrics.totalWaiting = 500;
  second.observation.completed[0].waiting = 500;
  second.observation.ready[0].duration = 500;
  const final = env.step('C');
  assert.deepEqual(final.observation.completed, transitions);
  assert.deepEqual(final.info.metrics, finalMetrics);
});

test('reset can repeat a partially or fully completed episode deterministically', () => {
  const env = new SchedulingEnv(tiny());
  const original = env.reset();
  env.step('A');
  assert.deepEqual(env.reset(), original);
  const run = () => ['A', 'B', 'C'].map((id) => env.step(id));
  const firstRun = run();
  assert.deepEqual(env.reset(), original);
  assert.deepEqual(run(), firstRun);
});

test('getMetrics returns isolated completed-task fairness metrics before and during an episode', () => {
  const env = new SchedulingEnv({ schemaVersion: 1, tasks: [
    { id: 'A', release: 2, duration: 3 },
    { id: 'B', release: 2, duration: 1 },
    { id: 'C', release: 2, duration: 1 },
  ] });
  const initial = env.getMetrics();
  assert.deepEqual(initial, {
    completedTasks: 0, makespan: 2, totalWaiting: 0, meanWaiting: 0, maxWaiting: 0,
    totalTurnaround: 0, meanTurnaround: 0, busyTime: 0, idleTime: 2, utilization: 0,
  });
  assert.equal(env.step('A').info.metrics.maxWaiting, 0);
  assert.equal(env.step('B').info.metrics.maxWaiting, 3);
  const snapshot = env.getMetrics();
  snapshot.maxWaiting = 999;
  assert.equal(env.step('C').info.metrics.maxWaiting, 4);
  assert.equal(initial.maxWaiting, 0);
  assert.equal(initial.completedTasks, 0);
  env.reset();
  assert.deepEqual(env.getMetrics(), initial);
});

test('maxWaiting remains the largest completed wait rather than the latest wait', () => {
  const env = new SchedulingEnv(tiny());
  env.step('A');
  assert.equal(env.step('B').info.metrics.maxWaiting, 2);
  assert.equal(env.step('C').info.metrics.maxWaiting, 2);
});
