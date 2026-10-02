import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateWorkload, replayWorkload, validateGeneratorOptions, generatorVersion, maxTaskCount } from '../src/workload.mjs';
import { validateWorkload } from '../src/env.mjs';
import { runSchedule } from '../src/run.mjs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('generator locks the v1 draw order and records every default', () => {
  assert.deepEqual(generateWorkload({ seed: 1, taskCount: 3 }), {
    schemaVersion: 1,
    generation: {
      generator: 'lcg32-workload-v1',
      seed: 1,
      parameters: {
        taskCount: 3, initialRelease: 0,
        duration: { min: 1, max: 8 }, arrivalGap: { min: 0, max: 4 },
        burstSize: 1, burstGap: 0,
      },
    },
    tasks: [
      { id: 'task-000001', release: 0, duration: 2 },
      { id: 'task-000002', release: 1, duration: 5 },
      { id: 'task-000003', release: 4, duration: 1 },
    ],
  });
  assert.equal(generateWorkload({ seed: 0 }).tasks.length, 20);
});

test('identical seeds and parameters replay byte-for-byte, distinct seeds change samples', () => {
  const first = generateWorkload({ seed: 42 });
  const second = generateWorkload({ seed: 42 });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(JSON.stringify(replayWorkload(first.generation)), JSON.stringify(first));
  assert.notDeepEqual(first.tasks, generateWorkload({ seed: 43 }).tasks);
});

test('simultaneous bursts, ordinary gaps and initial release have explicit arithmetic', () => {
  const workload = generateWorkload({
    seed: 0, taskCount: 7, initialRelease: 5,
    duration: { min: 2, max: 2 }, arrivalGap: { min: 1, max: 1 },
    burstSize: 3, burstGap: 10,
  });
  assert.deepEqual(workload.tasks.map(({ release }) => release), [5, 6, 7, 18, 19, 20, 31]);
  assert.ok(workload.tasks.every(({ duration }) => duration === 2));
  const simultaneous = generateWorkload({
    seed: 0, taskCount: 7, arrivalGap: { min: 0, max: 0 }, burstSize: 3, burstGap: 10,
  });
  assert.deepEqual(simultaneous.tasks.map(({ release }) => release), [0, 0, 0, 10, 10, 10, 20]);
});

test('empty and one-task inputs handle seed endpoints and unused arrival settings', () => {
  const empty = generateWorkload({ seed: 0xffff_ffff, taskCount: 0, initialRelease: Number.MAX_SAFE_INTEGER });
  assert.deepEqual(empty.tasks, []);
  assert.deepEqual(replayWorkload(empty.generation), empty);
  const one = generateWorkload({ seed: 0, taskCount: 1, burstGap: Number.MAX_SAFE_INTEGER });
  assert.equal(one.tasks.length, 1);
  assert.equal(one.tasks[0].release, 0);
});

test('generator inputs, metadata and tasks have no shared mutable state', () => {
  const options = Object.freeze({
    seed: 23, taskCount: 4,
    duration: Object.freeze({ min: 1, max: 3 }),
    arrivalGap: Object.freeze({ min: 0, max: 2 }),
  });
  const generated = generateWorkload(options);
  const expected = generateWorkload(options);
  generated.generation.parameters.duration.min = 999;
  generated.tasks[0].release = 999;
  assert.deepEqual(generateWorkload(options), expected);
  const normalized = validateGeneratorOptions(options);
  normalized.parameters.arrivalGap.min = 999;
  assert.equal(options.arrivalGap.min, 0);
  assert.notStrictEqual(generated.tasks[0], expected.tasks[0]);
});

test('invalid generator parameters are rejected without coercion or silent typo defaults', async (t) => {
  const cases = [
    ['not an object', null], ['array', []], ['missing seed', {}],
    ['string seed', { seed: '1' }], ['seed overflow', { seed: 2 ** 32 }],
    ['count negative', { seed: 1, taskCount: -1 }], ['count fractional', { seed: 1, taskCount: 1.5 }],
    ['count limit', { seed: 1, taskCount: maxTaskCount + 1 }], ['count null', { seed: 1, taskCount: null }],
    ['initial release', { seed: 1, initialRelease: -1 }],
    ['zero duration', { seed: 1, duration: { min: 0, max: 2 } }],
    ['reversed duration', { seed: 1, duration: { min: 3, max: 2 } }],
    ['duration overflow', { seed: 1, duration: { min: 1, max: 2 ** 32 } }],
    ['duration null', { seed: 1, duration: null }],
    ['range typo', { seed: 1, duration: { min: 1, max: 2, minimum: 1 } }],
    ['partial range', { seed: 1, arrivalGap: { min: 1 } }],
    ['negative gap', { seed: 1, arrivalGap: { min: -1, max: 1 } }],
    ['zero burst size', { seed: 1, burstSize: 0 }], ['negative burst gap', { seed: 1, burstGap: -1 }],
    ['unknown option', { seed: 1, taskcount: 2 }],
  ];
  for (const [label, options] of cases) {
    await t.test(label, () => assert.throws(() => generateWorkload(options), TypeError));
  }
});

test('safe-integer guards cover worst-case horizon and aggregate before generation', () => {
  assert.throws(() => generateWorkload({ seed: 0, taskCount: 1, initialRelease: Number.MAX_SAFE_INTEGER }), /safe workload/);
  assert.throws(() => generateWorkload({ seed: 0, taskCount: 3, burstGap: Number.MAX_SAFE_INTEGER }), /safe workload/);
  assert.throws(() => generateWorkload({ seed: 0, taskCount: maxTaskCount, duration: { min: 1, max: 0xffff_ffff } }), /aggregate/);
  const edge = generateWorkload({
    seed: 1, taskCount: 2, initialRelease: Number.MAX_SAFE_INTEGER - 2,
    arrivalGap: { min: 0, max: 0 }, duration: { min: 1, max: 1 },
  });
  assert.doesNotThrow(() => validateWorkload(edge));
  assert.equal(runSchedule(edge).metrics.makespan, Number.MAX_SAFE_INTEGER);
});

test('task-count limit generates unique stable IDs and a valid workload', () => {
  const workload = generateWorkload({ seed: 1, taskCount: maxTaskCount });
  assert.equal(workload.tasks.length, maxTaskCount);
  assert.equal(new Set(workload.tasks.map(({ id }) => id)).size, maxTaskCount);
  assert.equal(workload.tasks.at(-1).id, 'task-010000');
  assert.doesNotThrow(() => validateWorkload(workload));
});

test('replay rejects unsupported versions and incomplete provenance', () => {
  const { generation } = generateWorkload({ seed: 1 });
  assert.equal(generation.generator, generatorVersion);
  assert.throws(() => replayWorkload(null), /metadata/);
  assert.throws(() => replayWorkload({ ...generation, generator: 'future-v2' }), /version/);
  assert.throws(() => replayWorkload({ ...generation, parameters: {} }), /every recorded/);
  assert.throws(() => replayWorkload({ ...generation, parameters: { ...generation.parameters, taskCount: null } }), /every recorded/);
  assert.throws(() => replayWorkload({ ...generation, seed: undefined }), /Seed/);
});

test('100 seeded mixed configurations validate, replay and satisfy both policy invariants', () => {
  for (let seed = 0; seed < 100; seed += 1) {
    const options = {
      seed, taskCount: seed % 25, initialRelease: seed % 7,
      duration: { min: 1, max: 3 + seed % 8 }, arrivalGap: { min: 0, max: seed % 6 },
      burstSize: 1 + seed % 4, burstGap: seed % 15,
    };
    const workload = generateWorkload(options);
    assert.deepEqual(validateWorkload(workload).tasks, workload.tasks);
    assert.deepEqual(replayWorkload(workload.generation), workload);
    const byId = new Map(workload.tasks.map((task) => [task.id, task]));
    for (const policy of ['fifo', 'sjf']) {
      const result = runSchedule(workload, policy);
      assert.deepEqual(result, runSchedule(workload, policy));
      assert.equal(new Set(result.schedule.map(({ id }) => id)).size, options.taskCount);
      let previousFinish = 0;
      for (const transition of result.schedule) {
        const task = byId.get(transition.id);
        assert.ok(transition.start >= previousFinish && transition.start >= task.release);
        assert.equal(transition.finish - transition.start, task.duration);
        assert.equal(transition.waiting, transition.start - task.release);
        assert.equal(transition.turnaround, transition.waiting + task.duration);
        previousFinish = transition.finish;
      }
      const busy = workload.tasks.reduce((sum, task) => sum + task.duration, 0);
      assert.equal(result.metrics.busyTime, busy);
      assert.equal(result.metrics.makespan, previousFinish);
      assert.equal(result.metrics.totalWaiting, result.schedule.reduce((sum, step) => sum + step.waiting, 0));
      assert.equal(result.metrics.totalTurnaround, result.metrics.totalWaiting + busy);
      assert.equal(result.metrics.idleTime + busy, result.metrics.makespan);
    }
  }
});

test('checked-in fixtures regenerate byte-for-byte from configs and recorded metadata', () => {
  for (const name of ['low-load', 'high-load', 'bursty', 'idle-gaps']) {
    const config = JSON.parse(read(`examples/generator/${name}.json`));
    const bytes = read(`examples/generated/${name}.json`);
    const workload = JSON.parse(bytes);
    assert.equal(`${JSON.stringify(generateWorkload(config), null, 2)}\n`, bytes);
    assert.equal(`${JSON.stringify(replayWorkload(workload.generation), null, 2)}\n`, bytes);
    assert.doesNotThrow(() => validateWorkload(workload));
  }
});

test('fixed scenarios distinguish load, simultaneous bursts and real idle intervals', () => {
  const fixtures = Object.fromEntries(['low-load', 'high-load', 'bursty', 'idle-gaps'].map((name) => (
    [name, JSON.parse(read(`examples/generated/${name}.json`))]
  )));
  const metrics = Object.fromEntries(Object.entries(fixtures).map(([name, workload]) => [name, runSchedule(workload).metrics]));
  assert.equal(metrics['low-load'].totalWaiting, 0);
  assert.equal(metrics['low-load'].idleTime, 78);
  assert.equal(metrics['high-load'].totalWaiting, 214);
  assert.equal(metrics['high-load'].idleTime, 0);
  assert.deepEqual(fixtures.bursty.tasks.map(({ release }) => release), [0, 0, 0, 0, 8, 8, 8, 8, 16, 16, 16, 16]);
  assert.equal(metrics['idle-gaps'].idleTime, 77);
  assert.equal(metrics['idle-gaps'].makespan, 121);
  assert.ok(metrics['high-load'].utilization > metrics['low-load'].utilization);
  const fifo = metrics['high-load'];
  const sjf = runSchedule(fixtures['high-load'], 'sjf').metrics;
  assert.ok(sjf.totalWaiting < fifo.totalWaiting);
  assert.ok(sjf.maxWaiting > fifo.maxWaiting);
  const expected = {
    'low-load': [[122, 0, 0, 78], [122, 0, 0, 78]],
    'high-load': [[44, 214, 33, 0], [44, 167, 36, 0]],
    bursty: [[44, 157, 25, 0], [44, 119, 30, 0]],
    'idle-gaps': [[121, 25, 6, 77], [121, 21, 6, 77]],
  };
  for (const [name, workload] of Object.entries(fixtures)) {
    for (const [index, policy] of ['fifo', 'sjf'].entries()) {
      const { makespan, totalWaiting, maxWaiting, idleTime, busyTime } = runSchedule(workload, policy).metrics;
      assert.deepEqual([makespan, totalWaiting, maxWaiting, idleTime], expected[name][index]);
      assert.equal(busyTime, 44);
    }
  }
});
