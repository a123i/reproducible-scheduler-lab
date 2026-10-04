import test from 'node:test';
import assert from 'node:assert/strict';
import { fifo, sjf, waitingWeighted, getPolicy, getPolicyDescriptor, policyNames } from '../src/policies.mjs';
import { SchedulingEnv } from '../src/env.mjs';

function observation(ready, pending = []) {
  return { time: 10, ready, pending, completed: [], terminated: false };
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

test('policy lookup exposes exactly the supported policies without prototype names', () => {
  assert.deepEqual(policyNames, ['fifo', 'sjf', 'waiting-weighted']);
  assert.equal(getPolicy('waiting-weighted'), waitingWeighted);
  assert.ok(Object.isFrozen(policyNames));
  assert.equal(getPolicy('fifo'), fifo);
  assert.equal(getPolicy('sjf'), sjf);
  for (const name of ['random', 'SJF', 'constructor', '__proto__', '', null, undefined, {}]) {
    assert.throws(() => getPolicy(name), /Supported policies: fifo, sjf/);
  }
});

test('FIFO chooses earliest release; SJF prioritizes duration over release', () => {
  const input = freeze(observation([
    { id: 'later-short', release: 4, duration: 1 },
    { id: 'older-long', release: 1, duration: 5 },
    { id: 'middle', release: 2, duration: 2 },
  ]));
  const before = structuredClone(input);
  assert.equal(fifo(input), 'older-long');
  assert.equal(sjf(input), 'later-short');
  assert.deepEqual(input, before);
});

test('equal SJF durations use release before ID', () => {
  assert.equal(sjf(observation([
    { id: 'A', release: 2, duration: 1 },
    { id: 'Z', release: 1, duration: 1 },
  ])), 'Z');
});

test('all policies break remaining ties by Unicode code points, including prefixes', () => {
  const expected = ['A', 'AA', 'Z', 'a', '\uE000', '\u{10000}'];
  for (const select of policyNames.map(getPolicy)) {
    for (let index = 0; index < expected.length; index += 1) {
      const ready = expected.slice(index).reverse().map((id) => ({ id, release: 0, duration: 1 }));
      assert.equal(select(freeze(observation(ready))), expected[index]);
    }
  }
});

test('selection ignores pending tasks and never changes ready-array order', () => {
  const input = freeze(observation([
    { id: 'Z', release: 0, duration: 5 },
    { id: 'A', release: 0, duration: 4 },
  ], [{ id: 'pending', release: 11, duration: 1 }]));
  for (const select of policyNames.map(getPolicy)) {
    assert.equal(select(input), 'A');
    assert.deepEqual(input.ready.map(({ id }) => id), ['Z', 'A']);
  }
});

test('terminated observations have no action; inconsistent nonterminal empties fail', () => {
  const terminal = new SchedulingEnv({ schemaVersion: 1, tasks: [] }).reset();
  for (const select of policyNames.map(getPolicy)) {
    assert.equal(select(terminal), null);
    assert.throws(() => select(observation([])), /ready task/);
  }
});

test('SJF considers releases at completion and cannot preempt running work', () => {
  const env = new SchedulingEnv({ schemaVersion: 1, tasks: [
    { id: 'first', release: 0, duration: 4 },
    { id: 'during', release: 1, duration: 2 },
    { id: 'at-finish', release: 4, duration: 1 },
  ] });
  const first = env.step(sjf(env.reset()));
  assert.deepEqual(first.info.transition, { id: 'first', start: 0, finish: 4, waiting: 0, turnaround: 4 });
  assert.equal(sjf(first.observation), 'at-finish');
  const second = env.step(sjf(first.observation));
  assert.equal(sjf(second.observation), 'during');
});

test('policy descriptors bind selectors to versioned fixed parameters and remain isolated', () => {
  assert.deepEqual(policyNames.map(getPolicyDescriptor), [
    { name: 'fifo', version: 'fifo-v1', parameters: {} },
    { name: 'sjf', version: 'sjf-v1', parameters: {} },
    { name: 'waiting-weighted', version: 'waiting-weighted-v1', parameters: { waitingWeight: 1 } },
  ]);
  const descriptor = getPolicyDescriptor('waiting-weighted');
  descriptor.parameters.waitingWeight = 999;
  descriptor.version = 'changed';
  assert.deepEqual(getPolicyDescriptor('waiting-weighted'), {
    name: 'waiting-weighted', version: 'waiting-weighted-v1', parameters: { waitingWeight: 1 },
  });
  assert.throws(() => getPolicyDescriptor('constructor'), /Unknown policy/);
});

test('waiting-weighted can prefer older long work while retaining SJF order for equal releases', () => {
  const input = freeze(observation([
    { id: 'new-short', release: 9, duration: 1 }, // score 0
    { id: 'old-long', release: 2, duration: 6 }, // score -2
    { id: 'older-longer', release: 1, duration: 10 }, // score 1
  ]));
  assert.equal(waitingWeighted(input), 'old-long');
  assert.equal(fifo(input), 'older-longer');
  assert.equal(sjf(input), 'new-short');
  const together = freeze(observation(input.ready.map((task) => ({ ...task, release: 0 }))));
  assert.equal(waitingWeighted(together), sjf(together));
});

test('equal waiting-weighted scores prefer release before Unicode ID, regardless of duration', () => {
  assert.equal(waitingWeighted(freeze(observation([
    { id: 'A-short', release: 4, duration: 1 }, // score -5
    { id: 'Z-long', release: 1, duration: 4 }, // score -5
  ]))), 'Z-long');
});

test('waiting-weighted remains exact for negative scores and near the safe integer boundary', () => {
  const maximum = Number.MAX_SAFE_INTEGER;
  const late = new SchedulingEnv({ schemaVersion: 1, tasks: [
    { id: 'A-longer', release: maximum - 5, duration: 3 },
    { id: 'Z-shorter', release: maximum - 5, duration: 2 },
  ] });
  assert.equal(waitingWeighted(freeze(late.reset())), 'Z-shorter');
  const large = Math.floor(maximum / 6);
  const blocked = new SchedulingEnv({ schemaVersion: 1, tasks: [
    { id: 'block', release: 0, duration: large },
    { id: 'Z-old', release: 1, duration: 2 },
    { id: 'A-new', release: large, duration: 1 },
  ] });
  const input = freeze(blocked.step('block').observation);
  assert.equal(waitingWeighted(input), 'Z-old');
});

test('waiting-weighted does not inspect pending/completed and has no hidden cross-call state', () => {
  const ready = freeze([
    { id: 'old', release: 0, duration: 6 },
    { id: 'new', release: 5, duration: 2 },
  ]);
  const input = { time: 5, ready, terminated: false };
  Object.defineProperties(input, {
    pending: { get() { throw new Error('pending must not be read'); } },
    completed: { get() { throw new Error('completed must not be read'); } },
  });
  assert.equal(waitingWeighted(input), 'old');
  waitingWeighted(observation([{ id: 'unrelated', release: 0, duration: 1 }]));
  assert.equal(waitingWeighted(input), 'old');
  assert.equal(waitingWeighted({ ...input, time: 100 }), 'old');
});

test('waiting-weighted selects legal actions matching an independent small-integer reference', async () => {
  const { generateWorkload } = await import('../src/workload.mjs');
  const compareIds = (left, right) => {
    const l = Array.from(left, (point) => point.codePointAt(0));
    const r = Array.from(right, (point) => point.codePointAt(0));
    for (let i = 0; i < Math.min(l.length, r.length); i += 1) if (l[i] !== r[i]) return l[i] - r[i];
    return l.length - r.length;
  };
  for (let seed = 0; seed < 100; seed += 1) {
    const input = generateWorkload({
      seed, taskCount: 15, duration: { min: 1, max: 9 }, arrivalGap: { min: 0, max: 4 },
      burstSize: 3, burstGap: 8,
    });
    const env = new SchedulingEnv(input);
    let observed = env.reset();
    while (!observed.terminated) {
      const original = structuredClone(observed);
      const expected = [...observed.ready].sort((left, right) => (
        (left.duration + left.release) - (right.duration + right.release)
        || left.release - right.release || compareIds(left.id, right.id)
      ))[0].id;
      observed.ready.reverse();
      const action = waitingWeighted(freeze(observed));
      assert.equal(action, expected);
      assert.ok(original.ready.some(({ id }) => id === action));
      observed = env.step(action).observation;
    }
    assert.equal(waitingWeighted(freeze(observed)), null);
    assert.equal(observed.completed.length, input.tasks.length);
  }
});
