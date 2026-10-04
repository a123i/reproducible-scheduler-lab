import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { SchedulingEnv } from '../src/env.mjs';
import { experimentVersion, runExperiment, summarizeExperiment } from '../src/experiment.mjs';
import { generateWorkload } from '../src/workload.mjs';

const workload = (tasks = []) => ({ schemaVersion: 1, tasks });
const comparison = () => workload([
  { id: 'C', release: 0, duration: 2 },
  { id: 'A', release: 0, duration: 5 },
  { id: 'B', release: 0, duration: 1 },
]);
const specification = () => ({
  schemaVersion: 1,
  policies: ['fifo', 'sjf'],
  workloads: [
    { id: 'comparison', workload: comparison() },
    { id: 'idle', workload: workload([{ id: 'only', release: 90, duration: 10 }]) },
    { id: 'empty', workload: workload() },
  ],
});

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

// Test-side canonical encoding is independent of the production hash helper.
function canonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const digest = (value) => createHash('sha256').update(canonicalJSON(value)).digest('hex');
function reverseKeys(value) {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).reverse().map(([key, entry]) => [key, reverseKeys(entry)]));
  }
  return value;
}

test('experiment records a deterministic complete matrix in workload/policy order', () => {
  const input = freeze(specification());
  const raw = runExperiment(input);
  assert.equal(experimentVersion, 'scheduler-experiment-v1');
  assert.equal(raw.schemaVersion, 1);
  assert.equal(raw.experimentVersion, experimentVersion);
  assert.deepEqual(raw.policies, [
    { name: 'fifo', version: 'fifo-v1', parameters: {} },
    { name: 'sjf', version: 'sjf-v1', parameters: {} },
  ]);
  assert.deepEqual(raw.runs.map(({ inputId, policy }) => [inputId, policy]), [
    ['comparison', 'fifo'], ['comparison', 'sjf'], ['idle', 'fifo'],
    ['idle', 'sjf'], ['empty', 'fifo'], ['empty', 'sjf'],
  ]);
  assert.deepEqual(raw.runs[0].schedule, [
    { id: 'A', start: 0, finish: 5, waiting: 0, turnaround: 5 },
    { id: 'B', start: 5, finish: 6, waiting: 5, turnaround: 6 },
    { id: 'C', start: 6, finish: 8, waiting: 6, turnaround: 8 },
  ]);
  assert.deepEqual(raw.runs[1].schedule, [
    { id: 'B', start: 0, finish: 1, waiting: 0, turnaround: 1 },
    { id: 'C', start: 1, finish: 3, waiting: 1, turnaround: 3 },
    { id: 'A', start: 3, finish: 8, waiting: 3, turnaround: 8 },
  ]);
  assert.equal(JSON.stringify(runExperiment(input)), JSON.stringify(raw));
  const reversed = specification();
  reversed.policies.reverse();
  reversed.workloads.reverse();
  assert.deepEqual(runExperiment(reversed).runs.map(({ inputId, policy }) => [inputId, policy]), [
    ['empty', 'sjf'], ['empty', 'fifo'], ['idle', 'sjf'],
    ['idle', 'fifo'], ['comparison', 'sjf'], ['comparison', 'fifo'],
  ]);
});

test('normalization ignores object key order and task order with Unicode code-point ties', () => {
  const spec = specification();
  spec.workloads[0].workload = workload([
    { id: '\u{10000}', release: 0, duration: 1 },
    { id: 'late', release: 2, duration: 1 },
    { id: '\ue000', release: -0, duration: 1 },
    { id: 'AA', release: 0, duration: 1 },
    { id: 'A', release: 0, duration: 1 },
  ]);
  const raw = runExperiment(spec);
  const reordered = reverseKeys(spec);
  reordered.workloads[0].workload.tasks.reverse();
  assert.deepEqual(runExperiment(reordered), raw);
  assert.deepEqual(raw.inputs[0].workload.tasks.map(({ id }) => id), ['A', 'AA', '\ue000', '\u{10000}', 'late']);
  assert.ok(raw.inputs[0].workload.tasks.every(({ release }) => !Object.is(release, -0)));
  for (const input of raw.inputs) assert.equal(input.sha256, digest(input.workload));
  assert.deepEqual(summarizeExperiment(reverseKeys(raw)), summarizeExperiment(raw));
});

test('provenance hashes actual source bytes and records only the fixed simulation configuration', () => {
  const { provenance } = runExperiment(specification());
  assert.deepEqual(provenance.configuration, {
    workerCount: 1, preemptive: false, timeUnit: 'integer-tick',
    idle: 'advance-to-next-release', idTieBreak: 'unicode-code-point',
  });
  assert.equal(provenance.engine, 'single-worker-nonpreemptive-v1');
  assert.deepEqual(Object.keys(provenance).sort(), ['configuration', 'engine', 'sourceFilesSha256']);
  const files = ['batch', 'env', 'experiment', 'order', 'policies', 'random', 'run', 'summarize', 'workload'];
  assert.deepEqual(Object.keys(provenance.sourceFilesSha256).sort(), files.map((name) => `src/${name}.mjs`));
  for (const [path, recorded] of Object.entries(provenance.sourceFilesSha256)) {
    const bytes = readFileSync(new URL(`../${path}`, import.meta.url));
    assert.equal(recorded, createHash('sha256').update(bytes).digest('hex'), path);
  }
});

test('experiment inputs, generated metadata, runs and later outputs are independent snapshots', () => {
  const generated = generateWorkload({ seed: 42, taskCount: 6 });
  const spec = specification();
  spec.workloads.push({ id: 'generated', workload: generated }, { id: 'same-object', workload: generated });
  const before = structuredClone(spec);
  const raw = runExperiment(freeze(spec));
  assert.deepEqual(spec, before);
  const saved = structuredClone(raw);
  raw.inputs[3].workload.tasks[0].duration = 999;
  raw.inputs[3].workload.generation.parameters.duration.min = 999;
  raw.runs[0].schedule[0].waiting = 999;
  raw.runs[0].metrics.totalWaiting = 999;
  raw.policies[0].parameters.extra = 999;
  raw.provenance.configuration.workerCount = 999;
  raw.metricDefinitions.totalWaiting = 'changed';
  assert.deepEqual(raw.inputs[4], saved.inputs[4]);
  assert.deepEqual(raw.runs[1], saved.runs[1]);
  assert.deepEqual(runExperiment(spec), saved);
  assert.deepEqual(spec, before);
});

test('generated workloads retain complete replay metadata and reject mismatches', () => {
  const generated = generateWorkload({ seed: 17, taskCount: 8, burstSize: 3, burstGap: 4 });
  const spec = { schemaVersion: 1, policies: ['fifo'], workloads: [{ id: 'generated', workload: generated }] };
  assert.deepEqual(runExperiment(spec).inputs[0].workload, generated);
  for (const change of [
    (input) => { input.tasks[0].duration += 1; },
    (input) => { input.generation.seed = 18; },
    (input) => { input.generation.generator = 'unknown-generator'; },
    (input) => { delete input.generation.parameters.burstGap; },
    (input) => { input.generation.parameters.taskCount += 1; },
  ]) {
    const altered = structuredClone(spec);
    change(altered.workloads[0].workload);
    assert.throws(() => runExperiment(altered));
  }
});

test('empty workloads are valid episodes with zero summaries, unlike an empty manifest', () => {
  const raw = runExperiment({ schemaVersion: 1, policies: ['fifo', 'sjf'], workloads: [{ id: 'empty', workload: workload() }] });
  for (const run of raw.runs) {
    assert.deepEqual(run.schedule, []);
    assert.ok(Object.values(run.metrics).every((value) => value === 0));
  }
  for (const summary of summarizeExperiment(raw).policies) {
    assert.equal(summary.runCount, 1);
    assert.ok(Object.entries(summary).filter(([key]) => !['policy', 'runCount'].includes(key)).every(([, value]) => value === 0));
  }
  assert.throws(() => runExperiment({ schemaVersion: 1, policies: ['fifo'], workloads: [] }), /nonempty/);
});

test('experiment specifications reject malformed versions, policies, entries, IDs and workloads', () => {
  const invalid = [null, [], {}, { ...specification(), extra: true }, { ...specification(), schemaVersion: 2 }];
  for (const policies of [[], 'fifo', ['fifo', 'fifo'], ['constructor'], ['random'], [null], Array(1)]) {
    invalid.push({ ...specification(), policies });
  }
  for (const workloads of [null, {}, [], Array(1), [{ id: 'only' }], [{ id: 'only', workload: workload(), extra: true }]]) {
    invalid.push({ ...specification(), workloads });
  }
  for (const id of ['', ' leading', 'trailing ', '../private', 'a/b', '_first', 'é', 'a'.repeat(65), null, 4]) {
    invalid.push({ ...specification(), workloads: [{ id, workload: workload() }] });
  }
  invalid.push({ ...specification(), workloads: [{ id: 'same', workload: workload() }, { id: 'same', workload: workload() }] });
  invalid.push({ ...specification(), workloads: [{ id: 'bad', workload: workload([{ id: 'A', release: 0, duration: 0 }]) }] });
  for (const spec of invalid) assert.throws(() => runExperiment(spec));
  assert.doesNotThrow(() => runExperiment({ schemaVersion: 1, policies: ['fifo'], workloads: [{ id: 'a'.repeat(64), workload: workload() }] }));
});

test('summary recomputes hand-calculated task-weighted and time-weighted pooled metrics', () => {
  const raw = runExperiment(specification());
  const summary = summarizeExperiment(raw);
  assert.equal(summary.rawSha256, digest(raw));
  assert.equal(summary.inputCount, 3);
  assert.equal(summary.runCount, 6);
  assert.deepEqual(summary.policies, [
    {
      policy: 'fifo', runCount: 3, completedTasks: 4, totalWaiting: 11, meanWaiting: 11 / 4,
      maxWaiting: 6, totalTurnaround: 29, meanTurnaround: 29 / 4,
      totalMakespan: 108, totalBusyTime: 18, totalIdleTime: 90, pooledUtilization: 18 / 108,
    },
    {
      policy: 'sjf', runCount: 3, completedTasks: 4, totalWaiting: 4, meanWaiting: 1,
      maxWaiting: 3, totalTurnaround: 22, meanTurnaround: 22 / 4,
      totalMakespan: 108, totalBusyTime: 18, totalIdleTime: 90, pooledUtilization: 18 / 108,
    },
  ]);
  for (const aggregate of summary.policies) {
    const runs = raw.runs.filter(({ policy }) => policy === aggregate.policy);
    assert.notEqual(aggregate.meanWaiting, runs.reduce((sum, run) => sum + run.metrics.meanWaiting, 0) / runs.length);
    assert.notEqual(aggregate.meanTurnaround, runs.reduce((sum, run) => sum + run.metrics.meanTurnaround, 0) / runs.length);
    assert.notEqual(aggregate.pooledUtilization, runs.reduce((sum, run) => sum + run.metrics.utilization, 0) / runs.length);
  }
});

test('summary validates frozen raw without rerunning the scheduling environment', (t) => {
  const raw = freeze(runExperiment(specification()));
  const before = structuredClone(raw);
  t.mock.method(SchedulingEnv.prototype, 'step', () => { throw new Error('Summary must not run the environment.'); });
  const first = summarizeExperiment(raw);
  const expected = structuredClone(first);
  first.policies[0].totalWaiting = 999;
  first.metricDefinitions.totalWaiting = 'changed';
  assert.deepEqual(summarizeExperiment(raw), expected);
  assert.deepEqual(raw, before);
});

test('summary accepts historical source hashes and run permutations without local-source equality', () => {
  const raw = runExperiment(specification());
  const expected = summarizeExperiment(raw);
  for (const path of Object.keys(raw.provenance.sourceFilesSha256)) raw.provenance.sourceFilesSha256[path] = '0'.repeat(64);
  raw.runs.reverse();
  const summary = summarizeExperiment(raw);
  assert.deepEqual(summary.policies, expected.policies);
  assert.notEqual(summary.rawSha256, expected.rawSha256);
  assert.equal(summary.rawSha256, digest(raw));
});

test('summary rejects every altered reported metric instead of trusting run totals', () => {
  const original = runExperiment(specification());
  for (const field of Object.keys(original.runs[0].metrics)) {
    const raw = structuredClone(original);
    raw.runs[0].metrics[field] += 1;
    assert.throws(() => summarizeExperiment(raw), /metrics/i, field);
  }
  const extra = structuredClone(original);
  extra.runs[0].metrics.extra = 0;
  assert.throws(() => summarizeExperiment(extra), /metrics/i);
});

test('summary reconstructs transitions and refuses changed, omitted, repeated or policy-inconsistent tasks', () => {
  const original = runExperiment(specification());
  const mutations = [
    (run) => { run.schedule[0].id = 'unknown'; },
    (run) => { run.schedule[1].id = run.schedule[0].id; },
    (run) => { run.schedule.pop(); },
    (run) => { run.schedule.push({ ...run.schedule[0] }); },
    (run) => { run.schedule.reverse(); },
    (run) => { run.schedule[0].extra = 1; },
    (run) => { delete run.schedule[0].waiting; },
    (run) => { run.schedule = null; },
    ...['start', 'finish', 'waiting', 'turnaround'].map((field) => (run) => { run.schedule[0][field] += 1; }),
    (run) => { run.schedule = structuredClone(original.runs[1].schedule); run.metrics = structuredClone(original.runs[1].metrics); },
  ];
  for (const change of mutations) {
    const raw = structuredClone(original);
    change(raw.runs[0]);
    assert.throws(() => summarizeExperiment(raw));
  }
  const idle = structuredClone(original);
  const transition = idle.runs[2].schedule[0];
  Object.assign(transition, { start: 91, finish: 101, waiting: 1, turnaround: 11 });
  Object.assign(idle.runs[2].metrics, {
    makespan: 101, totalWaiting: 1, meanWaiting: 1, maxWaiting: 1,
    totalTurnaround: 11, meanTurnaround: 11, idleTime: 91, utilization: 10 / 101,
  });
  assert.throws(() => summarizeExperiment(idle), /Transition/);
});

test('summary enforces complete unique input/policy pairs', () => {
  for (const change of [
    (raw) => { raw.runs.pop(); },
    (raw) => { raw.runs.push(structuredClone(raw.runs[0])); },
    (raw) => { raw.runs[1] = structuredClone(raw.runs[0]); },
    (raw) => { raw.runs[0].inputId = 'missing'; },
    (raw) => { raw.runs[0].policy = 'random'; },
    (raw) => { raw.runs = []; },
    (raw) => { raw.runs = null; },
  ]) {
    const raw = runExperiment(specification());
    change(raw);
    assert.throws(() => summarizeExperiment(raw), /pair|runs/i);
  }
});

test('summary rejects unknown protocol versions, malformed provenance and invalid archived inputs', () => {
  const changes = [
    (raw) => { raw.schemaVersion = 2; },
    (raw) => { raw.experimentVersion = 'scheduler-experiment-v2'; },
    (raw) => { raw.provenance.engine = 'new-engine'; },
    (raw) => { raw.provenance.configuration.workerCount = 2; },
    (raw) => { raw.provenance.sourceFilesSha256['src/env.mjs'] = 'not-a-hash'; },
    (raw) => { delete raw.provenance.sourceFilesSha256['src/env.mjs']; },
    (raw) => { raw.provenance.sourceFilesSha256['unknown-file'] = '0'.repeat(64); },
    (raw) => { raw.metricDefinitions.meanWaiting = 'mean of means'; },
    (raw) => { raw.policies[0].name = 'random'; },
    (raw) => { raw.policies[0].version = 'fifo-v2'; },
    (raw) => { raw.policies[0].parameters.lookahead = true; },
    (raw) => { raw.policies[1] = structuredClone(raw.policies[0]); },
    (raw) => { raw.policies = []; },
    (raw) => { raw.inputs = []; },
    (raw) => { raw.inputs[1].id = raw.inputs[0].id; },
    (raw) => { raw.inputs[0].sha256 = '0'.repeat(64); },
    (raw) => { raw.inputs[0].workload.tasks.reverse(); },
    (raw) => { raw.inputs[0].workload.tasks[0].duration += 1; },
    (raw) => { raw.inputs[0].workload.tasks[0].duration += 1; raw.inputs[0].sha256 = digest(raw.inputs[0].workload); },
    (raw) => { raw.extra = true; },
    (raw) => { delete raw.runs[0].metrics; },
  ];
  for (const change of changes) {
    const raw = runExperiment(specification());
    change(raw);
    assert.throws(() => summarizeExperiment(raw));
  }
  for (const raw of [null, [], {}]) assert.throws(() => summarizeExperiment(raw));
});

test('summary rejects changed generated metadata even when its input hash is recomputed', () => {
  const raw = runExperiment({ schemaVersion: 1, policies: ['fifo'], workloads: [
    { id: 'generated', workload: generateWorkload({ seed: 9, taskCount: 5 }) },
  ] });
  raw.inputs[0].workload.generation.seed = 10;
  raw.inputs[0].sha256 = digest(raw.inputs[0].workload);
  assert.throws(() => summarizeExperiment(raw), /Generated input tasks/);
});

test('summary preserves exact cross-run sums up to the safe integer boundary', () => {
  const maximum = Number.MAX_SAFE_INTEGER;
  const raw = runExperiment({ schemaVersion: 1, policies: ['fifo', 'sjf'], workloads: [
    { id: 'large', workload: workload([{ id: 'A', release: 0, duration: maximum - 2 }]) },
    { id: 'one', workload: workload([{ id: 'A', release: 0, duration: 1 }]) },
    { id: 'two', workload: workload([{ id: 'A', release: 0, duration: 1 }]) },
  ] });
  for (const summary of summarizeExperiment(raw).policies) {
    assert.equal(summary.totalMakespan, maximum);
    assert.equal(summary.totalBusyTime, maximum);
    assert.equal(summary.totalTurnaround, maximum);
    assert.equal(summary.meanTurnaround, maximum / 3);
    assert.equal(summary.totalWaiting, 0);
    assert.equal(summary.totalIdleTime, 0);
    assert.equal(summary.pooledUtilization, 1);
  }
  const idle = runExperiment({ schemaVersion: 1, policies: ['fifo'], workloads: [
    { id: 'last-tick', workload: workload([{ id: 'A', release: maximum - 1, duration: 1 }]) },
  ] });
  const summary = summarizeExperiment(idle).policies[0];
  assert.equal(summary.totalMakespan, maximum);
  assert.equal(summary.totalIdleTime, maximum - 1);
  assert.equal(summary.totalTurnaround, 1);
  assert.equal(summary.pooledUtilization, 1 / maximum);
});

test('safe individual runs cannot silently overflow cross-run summary aggregates', () => {
  for (const task of [
    { id: 'A', release: 0, duration: Number.MAX_SAFE_INTEGER },
    { id: 'A', release: Number.MAX_SAFE_INTEGER - 1, duration: 1 },
  ]) {
    const raw = runExperiment({ schemaVersion: 1, policies: ['fifo'], workloads: [
      { id: 'large', workload: workload([task]) },
      { id: 'extra', workload: workload([{ id: 'A', release: 0, duration: 1 }]) },
    ] });
    assert.equal(raw.runs.length, 2);
    assert.throws(() => summarizeExperiment(raw), { name: 'RangeError', message: /safe integer/ });
  }
});

test('weighted experiments record the fixed weight and reject altered versions or parameters', () => {
  const spec = specification();
  spec.policies.push('waiting-weighted');
  const raw = runExperiment(spec);
  assert.deepEqual(raw.policies[2], {
    name: 'waiting-weighted', version: 'waiting-weighted-v1', parameters: { waitingWeight: 1 },
  });
  assert.equal(summarizeExperiment(raw).runCount, 9);
  for (const change of [
    (value) => { value.policies[2].version = 'waiting-weighted-v2'; },
    (value) => { value.policies[2].parameters.waitingWeight = 0; },
    (value) => { value.policies[2].parameters.waitingWeight = 2; },
    (value) => { value.policies[2].parameters.waitingWeight = '1'; },
    (value) => { delete value.policies[2].parameters.waitingWeight; },
    (value) => { value.policies[2].parameters.extra = 1; },
  ]) {
    const altered = structuredClone(raw);
    change(altered);
    assert.throws(() => summarizeExperiment(altered), /Policy versions and parameters/);
  }
  raw.policies[2].parameters.waitingWeight = 999;
  assert.equal(runExperiment(spec).policies[2].parameters.waitingWeight, 1);
});

test('summary rejects relabeled SJF schedules that violate the weighted policy', () => {
  const input = JSON.parse(readFileSync(new URL('../examples/fairness-tradeoff.json', import.meta.url), 'utf8'));
  const raw = runExperiment({ schemaVersion: 1, policies: ['sjf', 'waiting-weighted'], workloads: [{ id: 'fairness', workload: input }] });
  assert.doesNotThrow(() => summarizeExperiment(raw));
  raw.runs[1].schedule = structuredClone(raw.runs[0].schedule);
  raw.runs[1].metrics = structuredClone(raw.runs[0].metrics);
  assert.throws(() => summarizeExperiment(raw), /recorded policy/);
});
