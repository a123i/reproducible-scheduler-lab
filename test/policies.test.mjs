import test from 'node:test';
import assert from 'node:assert/strict';
import { fifo, sjf, getPolicy, policyNames } from '../src/policies.mjs';
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
  assert.deepEqual(policyNames, ['fifo', 'sjf']);
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

test('both policies break remaining ties by Unicode code points, including prefixes', () => {
  const expected = ['A', 'AA', 'Z', 'a', '\uE000', '\u{10000}'];
  for (const select of [fifo, sjf]) {
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
  for (const select of [fifo, sjf]) {
    assert.equal(select(input), 'A');
    assert.deepEqual(input.ready.map(({ id }) => id), ['Z', 'A']);
  }
});

test('terminated observations have no action; inconsistent nonterminal empties fail', () => {
  const terminal = new SchedulingEnv({ schemaVersion: 1, tasks: [] }).reset();
  for (const select of [fifo, sjf]) {
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
