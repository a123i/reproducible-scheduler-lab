import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SchedulingEnv } from '../src/env.mjs';
import { getPolicy, policyNames } from '../src/policies.mjs';
import { runSchedule } from '../src/run.mjs';
import { generateWorkload } from '../src/workload.mjs';
import { runExperiment, summarizeExperiment } from '../src/experiment.mjs';

const read = (path) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const workload = (tasks = []) => ({ schemaVersion: 1, tasks });
const boundaries = () => read('examples/regression-boundaries.json');
const names = ['fifo', 'sjf', 'waiting-weighted'];

// Test oracle deliberately imports no production arithmetic, ordering or policy
// helpers. It schedules with BigInt and a sorted remaining list, not env state.
const integer = (value) => {
  const result = Number(value);
  assert.ok(Number.isSafeInteger(result), 'reference result must be a safe integer');
  assert.equal(BigInt(result), value);
  return result;
};
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function idOrder(a, b) {
  // Fixed-width code-point encodings make ordinary lexicographic comparison valid.
  const key = (id) => [...id].map((point) => point.codePointAt(0).toString(16).padStart(6, '0')).join('');
  return compare(key(a), key(b));
}
const releaseOrder = (a, b) => compare(a.release, b.release) || idOrder(a.id, b.id);

function reference(input, policy) {
  assert.ok(names.includes(policy), 'reference must explicitly support the policy');
  const remaining = input.tasks.map(({ id, release, duration }) => ({
    id, release: BigInt(release), duration: BigInt(duration),
  }));
  const completed = [];
  const snapshots = [];
  let time = 0n;
  function snapshot() {
    remaining.sort(releaseOrder);
    if (remaining.length && time < remaining[0].release) time = remaining[0].release;
    const waiting = completed.reduce((sum, step) => sum + step.start - step.release, 0n);
    const turnaround = completed.reduce((sum, step) => sum + step.finish - step.release, 0n);
    const busy = completed.reduce((sum, step) => sum + step.duration, 0n);
    const maximum = completed.reduce((max, step) => step.start - step.release > max ? step.start - step.release : max, 0n);
    const transition = (step) => ({
      id: step.id, start: integer(step.start), finish: integer(step.finish),
      waiting: integer(step.start - step.release), turnaround: integer(step.finish - step.release),
    });
    const task = ({ id, release, duration }) => ({ id, release: integer(release), duration: integer(duration) });
    const observation = {
      time: integer(time),
      ready: remaining.filter((entry) => entry.release <= time).map(task),
      pending: remaining.filter((entry) => entry.release > time).map(task),
      completed: completed.map(transition), terminated: remaining.length === 0,
    };
    const count = completed.length;
    const metrics = {
      completedTasks: count, makespan: integer(time), totalWaiting: integer(waiting),
      meanWaiting: count ? integer(waiting) / count : 0, maxWaiting: integer(maximum),
      totalTurnaround: integer(turnaround), meanTurnaround: count ? integer(turnaround) / count : 0,
      busyTime: integer(busy), idleTime: integer(time - busy), utilization: time ? integer(busy) / integer(time) : 0,
    };
    return { observation, metrics };
  }
  const initial = snapshot();
  while (remaining.length) {
    const priority = (task) => policy === 'fifo' ? 0n
      : policy === 'sjf' ? task.duration : task.duration + task.release;
    // For weight 1 the common -time term cancels; this differs from production's
    // direct waiting-score calculation and checks that algebraic equivalence.
    const ready = remaining.filter((task) => task.release <= time).sort((a, b) => (
      compare(priority(a), priority(b)) || releaseOrder(a, b)
    ));
    const task = ready[0];
    completed.push({ ...task, start: time, finish: time + task.duration });
    time += task.duration;
    remaining.splice(remaining.indexOf(task), 1);
    const state = snapshot();
    const transition = state.observation.completed.at(-1);
    snapshots.push({
      observation: state.observation, reward: transition.waiting ? -transition.waiting : 0,
      terminated: state.observation.terminated,
      info: { transition, metrics: state.metrics },
    });
  }
  const final = snapshots.at(-1);
  return {
    initial, snapshots,
    result: {
      schemaVersion: 1, policy, schedule: final ? final.observation.completed : [],
      metrics: final ? final.info.metrics : initial.metrics,
    },
  };
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

// Independently integrate the queue length: +1 at release, -1 at dispatch.
// Equal-time events have zero-width intervals, so their ordering is immaterial.
function queueArea(input, schedule) {
  const events = [
    ...input.tasks.map(({ release }) => [BigInt(release), 1n]),
    ...schedule.map(({ start }) => [BigInt(start), -1n]),
  ].sort(([a], [b]) => compare(a, b));
  let previous = 0n;
  let queued = 0n;
  let area = 0n;
  for (const [time, delta] of events) {
    area += (time - previous) * queued;
    queued += delta;
    previous = time;
  }
  assert.equal(queued, 0n);
  return area;
}

function assertEpisode(input, policy, label, injectInvalid = false) {
  const expected = reference(input, policy);
  const env = new SchedulingEnv(input);
  let observation = env.reset();
  assert.deepEqual(observation, expected.initial.observation, label);
  assert.deepEqual(env.getMetrics(), expected.initial.metrics, label);
  let reward = 0n;
  for (const step of expected.snapshots) {
    const before = structuredClone(observation);
    if (injectInvalid) {
      const actions = [undefined, null, 0, false, {}, [], 0n, Symbol('invalid'), '__unknown__'];
      if (observation.pending.length) actions.push(observation.pending[0].id);
      if (observation.completed.length) actions.push(observation.completed.at(-1).id);
      actions.push(new String(observation.ready[0].id));
      const metrics = env.getMetrics();
      for (const action of actions) {
        assert.throws(() => env.step(action), /unfinished ready/, label);
        assert.deepEqual(env.getMetrics(), metrics, label);
      }
    }
    const permuted = freeze({ ...structuredClone(observation), ready: [...observation.ready].reverse() });
    const selected = getPolicy(policy)(permuted);
    assert.ok(observation.ready.some(({ id }) => id === selected), label);
    assert.equal(selected, step.info.transition.id, label);
    const actual = env.step(selected);
    assert.deepEqual(actual, step, label);
    assert.deepEqual(env.getMetrics(), step.info.metrics, label);
    assert.deepEqual(observation, before, 'prior observation is a snapshot');
    assert.ok(actual.observation.time >= observation.time, label);
    reward += BigInt(actual.reward);
    assert.equal(reward, -BigInt(actual.info.metrics.totalWaiting), label);
    observation = actual.observation;
  }
  assert.equal(getPolicy(policy)(freeze(observation)), null, label);
  for (const action of [undefined, null, '__unknown__', input.tasks[0]?.id]) {
    assert.throws(() => env.step(action), /terminated/, label);
    assert.deepEqual(env.getMetrics(), expected.result.metrics, label);
  }
  assert.equal(new Set(observation.completed.map(({ id }) => id)).size, input.tasks.length, label);
  const busy = input.tasks.reduce((sum, task) => sum + BigInt(task.duration), 0n);
  const metrics = env.getMetrics();
  assert.equal(BigInt(metrics.busyTime), busy, label);
  assert.equal(BigInt(metrics.totalWaiting), queueArea(input, observation.completed), label);
  assert.equal(BigInt(metrics.totalTurnaround), busy + BigInt(metrics.totalWaiting), label);
  assert.equal(BigInt(metrics.makespan), busy + BigInt(metrics.idleTime), label);
  assert.deepEqual(runSchedule(input, policy), expected.result, label);
  return expected;
}

// Each row is hand-calculated: id, start, finish, waiting, turnaround,
// post-step environment time (including idle), busy, total wait, total turnaround, max wait.
const handRows = {
  fifo: [
    ['block', 2, 7, 0, 5, 7, 5, 0, 5, 0],
    ['old', 7, 11, 4, 8, 11, 9, 4, 13, 4],
    ['short', 11, 12, 5, 6, 14, 10, 9, 19, 5],
    ['\ue000', 14, 15, 0, 1, 15, 11, 9, 20, 5],
    ['\u{10000}', 15, 16, 1, 2, 16, 12, 10, 22, 5],
    ['end', 16, 18, 0, 2, 18, 14, 10, 24, 5],
  ],
  sjf: [
    ['block', 2, 7, 0, 5, 7, 5, 0, 5, 0],
    ['short', 7, 8, 1, 2, 8, 6, 1, 7, 1],
    ['old', 8, 12, 5, 9, 14, 10, 6, 16, 5],
    ['\ue000', 14, 15, 0, 1, 15, 11, 6, 17, 5],
    ['\u{10000}', 15, 16, 1, 2, 16, 12, 7, 19, 5],
    ['end', 16, 18, 0, 2, 18, 14, 7, 21, 5],
  ],
};

test('the regression oracle explicitly covers the complete built-in registry', () => {
  assert.deepEqual(policyNames, names);
});

for (const policy of names) {
  test(`${policy}: hand-calculated prefixes cover idle, exact releases, score and Unicode ties`, () => {
    const expected = assertEpisode(boundaries(), policy, policy, true);
    const rows = handRows[policy === 'waiting-weighted' ? 'fifo' : policy];
    for (const [index, row] of rows.entries()) {
      const [id, start, finish, waiting, turnaround, makespan, busyTime, totalWaiting, totalTurnaround, maxWaiting] = row;
      const completedTasks = index + 1;
      const step = expected.snapshots[index];
      assert.deepEqual(step.info.transition, { id, start, finish, waiting, turnaround });
      assert.equal(step.reward, waiting ? -waiting : 0);
      assert.deepEqual(step.info.metrics, {
        completedTasks, makespan, totalWaiting, meanWaiting: totalWaiting / completedTasks,
        maxWaiting, totalTurnaround, meanTurnaround: totalTurnaround / completedTasks,
        busyTime, idleTime: makespan - busyTime, utilization: busyTime / makespan,
      });
    }
  });
}

function* smallWorkloads(tasks = []) {
  yield workload(tasks);
  if (tasks.length === 4) return;
  const id = ['A', 'AA', '\ue000', '\u{10000}'][tasks.length];
  for (let release = 0; release <= 2; release += 1) {
    for (let duration = 1; duration <= 3; duration += 1) {
      yield* smallWorkloads([...tasks, { id, release, duration }]);
    }
  }
}

test('7,381 exhaustive small workloads match the independent reference under all three policies', () => {
  let count = 0;
  for (const input of smallWorkloads()) {
    for (const policy of names) {
      const label = `${policy}: ${JSON.stringify(input.tasks)}`;
      const expected = reference(input, policy).result;
      assert.deepEqual(runSchedule(input, policy), expected, label);
      assert.deepEqual(runSchedule(workload([...input.tasks].reverse()), policy), expected, label);
    }
    count += 1;
  }
  assert.equal(count, 7381);
});

const seeds = [...Array.from({ length: 126 }, (_, seed) => seed), 0x8000_0000, 0xffff_ffff];
function seeded(index) {
  return generateWorkload({
    seed: seeds[index], taskCount: index % 25, initialRelease: index % 9,
    duration: { min: 1, max: 1 + index % 11 },
    arrivalGap: { min: 0, max: index % 8 }, burstSize: 1 + index % 5, burstGap: index % 17,
  });
}

test('128 fixed seeds cross-check every prefix, legal/illegal action and reward for all policies', () => {
  for (let index = 0; index < seeds.length; index += 1) {
    for (const policy of names) {
      assertEpisode(seeded(index), policy, `seed=${seeds[index]}, policy=${policy}`, true);
    }
  }
});

function corrupt(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (item && typeof item === 'object') corrupt(item);
    else value[key] = typeof item === 'number' ? -999 : '__tampered__';
  }
  if (Array.isArray(value)) value.push({ id: '__injected__', release: 0, duration: 999 });
}

for (const policy of names) {
  test(`${policy}: reset at every prefix isolates stale inputs, observations, transitions and metrics`, () => {
    const expected = reference(boundaries(), policy);
    for (let cutoff = 0; cutoff <= expected.snapshots.length; cutoff += 1) {
      const input = boundaries();
      const env = new SchedulingEnv(input);
      const stale = [input, env.reset(), env.getMetrics()];
      for (const step of expected.snapshots.slice(0, cutoff)) stale.push(env.step(step.info.transition.id));
      const saved = structuredClone(stale);
      assert.deepEqual(env.reset(), expected.initial.observation);
      assert.deepEqual(stale, saved, 'reset must not mutate old snapshots');
      stale.forEach(corrupt);
      assert.deepEqual(env.getMetrics(), expected.initial.metrics);
      // Change policies after reset too: no state from the interrupted run may survive.
      for (const nextPolicy of names) {
        const next = reference(boundaries(), nextPolicy);
        assert.deepEqual(env.reset(), next.initial.observation);
        for (const step of next.snapshots) {
          const actual = env.step(step.info.transition.id);
          assert.deepEqual(actual, step);
          corrupt(actual);
          const snapshot = env.getMetrics();
          assert.deepEqual(snapshot, step.info.metrics);
          corrupt(snapshot);
        }
        assert.deepEqual(env.getMetrics(), next.result.metrics);
      }
    }
  });
}

test('safe-integer endpoints, large scores and empty episodes match BigInt reference prefixes', () => {
  const max = Number.MAX_SAFE_INTEGER;
  const inputs = [
    workload(),
    workload([{ id: 'one', release: 0, duration: max }]),
    workload([{ id: 'last', release: max - 1, duration: 1 }]),
    workload([
      { id: '\u{10000}', release: max - 12, duration: 2 },
      { id: '\ue000', release: max - 12, duration: 2 },
      { id: 'later', release: max - 8, duration: 3 },
    ]),
    workload([
      { id: 'long', release: 0, duration: Math.floor(max / 3) - 4 },
      { id: 'middle', release: 1, duration: 2 },
      { id: 'short', release: 2, duration: 1 },
    ]),
  ];
  for (const [index, input] of inputs.entries()) {
    for (const policy of names) assertEpisode(input, policy, `edge=${index}, policy=${policy}`, true);
  }
});

test('exact BigInt aggregate and horizon boundaries accept the last safe input and reject the next', () => {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  for (let count = 2; count <= 8; count += 1) {
    const busy = max / BigInt(count);
    const input = workload(Array.from({ length: count }, (_, index) => ({
      id: `task-${index}`, release: 0, duration: index ? 1 : integer(busy - BigInt(count - 1)),
    })));
    for (const policy of names) assertEpisode(input, policy, `aggregate count=${count}`);
    const overflow = structuredClone(input);
    overflow.tasks[0].duration += 1;
    assert.throws(() => new SchedulingEnv(overflow), /aggregate/);
    const delayed = workload(input.tasks.map((task) => ({ ...task, release: integer(max - busy) })));
    for (const policy of names) assertEpisode(delayed, policy, `horizon count=${count}`);
    const late = workload(delayed.tasks.map((task) => ({ ...task, release: task.release + 1 })));
    assert.throws(() => new SchedulingEnv(late), /horizon/);
  }
});

test('release translation and integer time scaling preserve policy choices and metric identities', () => {
  for (let index = 0; index < 25; index += 1) {
    const input = seeded(index);
    for (const policy of names) {
      const original = runSchedule(input, policy);
      for (const [scale, shift] of [[1, 19], [3, 0], [3, 19]]) {
        const changed = workload(input.tasks.map((task) => ({
          ...task, release: task.release * scale + shift, duration: task.duration * scale,
        })));
        const actual = runSchedule(changed, policy);
        assert.deepEqual(actual, reference(changed, policy).result);
        assert.deepEqual(actual.schedule, original.schedule.map((step) => ({
          id: step.id, start: step.start * scale + shift, finish: step.finish * scale + shift,
          waiting: step.waiting * scale, turnaround: step.turnaround * scale,
        })));
        const count = input.tasks.length;
        const makespan = original.metrics.makespan * scale + (count ? shift : 0);
        const busy = original.metrics.busyTime * scale;
        assert.deepEqual(actual.metrics, {
          completedTasks: count, makespan, totalWaiting: original.metrics.totalWaiting * scale,
          meanWaiting: count ? original.metrics.totalWaiting * scale / count : 0,
          maxWaiting: original.metrics.maxWaiting * scale,
          totalTurnaround: original.metrics.totalTurnaround * scale,
          meanTurnaround: count ? original.metrics.totalTurnaround * scale / count : 0,
          busyTime: busy, idleTime: makespan - busy, utilization: makespan ? busy / makespan : 0,
        });
      }
    }
  }
});

function referenceSummary(raw, policy) {
  const metrics = raw.inputs.map(({ workload: input }) => reference(input, policy).result.metrics);
  const sum = (key) => integer(metrics.reduce((total, entry) => total + BigInt(entry[key]), 0n));
  const count = sum('completedTasks');
  const waiting = sum('totalWaiting');
  const turnaround = sum('totalTurnaround');
  const makespan = sum('makespan');
  const busy = sum('busyTime');
  return {
    policy, runCount: metrics.length, completedTasks: count,
    totalWaiting: waiting, meanWaiting: count ? waiting / count : 0,
    maxWaiting: Math.max(0, ...metrics.map((entry) => entry.maxWaiting)),
    totalTurnaround: turnaround, meanTurnaround: count ? turnaround / count : 0,
    totalMakespan: makespan, totalBusyTime: busy, totalIdleTime: sum('idleTime'),
    pooledUtilization: makespan ? busy / makespan : 0,
  };
}

test('both committed raw batches and summaries match independent scheduling and pooled arithmetic', () => {
  for (const name of ['baselines', 'policies']) {
    const raw = read(`examples/experiments/${name}.raw.json`);
    const archived = read(`examples/experiments/${name}.summary.json`);
    for (const run of raw.runs) {
      const input = raw.inputs.find(({ id }) => id === run.inputId).workload;
      const expected = reference(input, run.policy).result;
      assert.deepEqual(run.schedule, expected.schedule);
      assert.deepEqual(run.metrics, expected.metrics);
      assert.equal(BigInt(run.metrics.totalWaiting), queueArea(input, run.schedule));
    }
    const expected = raw.policies.map(({ name: policy }) => referenceSummary(raw, policy));
    assert.deepEqual(archived.policies, expected);
    assert.deepEqual(summarizeExperiment(raw), archived);
  }
});

test('mixed empty/idle/seeded batches cross-check all raw metrics and weighted summaries', () => {
  const raw = runExperiment({
    schemaVersion: 1, policies: names,
    workloads: [
      { id: 'boundaries', workload: boundaries() },
      ...Array.from({ length: 25 }, (_, index) => ({ id: `seed-${index}`, workload: seeded(index) })),
    ],
  });
  for (const run of raw.runs) {
    const input = raw.inputs.find(({ id }) => id === run.inputId).workload;
    const expected = reference(input, run.policy).result;
    assert.deepEqual(run.schedule, expected.schedule);
    assert.deepEqual(run.metrics, expected.metrics);
  }
  assert.deepEqual(summarizeExperiment(freeze(raw)).policies, names.map((policy) => referenceSummary(raw, policy)));
});
