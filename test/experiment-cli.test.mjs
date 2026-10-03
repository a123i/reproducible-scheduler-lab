import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runExperiment, summarizeExperiment } from '../src/experiment.mjs';
import { generateWorkload } from '../src/workload.mjs';

const batch = fileURLToPath(new URL('../src/batch.mjs', import.meta.url));
const summarize = fileURLToPath(new URL('../src/summarize.mjs', import.meta.url));
const example = (name) => fileURLToPath(new URL(`../examples/experiments/${name}`, import.meta.url));
const emptyWorkload = { schemaVersion: 1, tasks: [] };
const simpleWorkload = { schemaVersion: 1, tasks: [{ id: 'A', release: 3, duration: 2 }] };

function run(cli, args, cwd = tmpdir(), env = process.env) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd, env, encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null);
  return result;
}

function directory(t) {
  const path = mkdtempSync(join(tmpdir(), 'scheduler-experiment-'));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

function write(path, contents) {
  writeFileSync(path, typeof contents === 'string' ? contents : `${JSON.stringify(contents, null, 2)}\n`, 'utf8');
  return path;
}

function manifest(t, contents = emptyWorkload) {
  const folder = directory(t);
  write(join(folder, 'workload with spaces.json'), contents);
  return write(join(folder, 'manifest with spaces.json'), {
    schemaVersion: 1, policies: ['fifo', 'sjf'], workloads: [{ id: 'example', path: 'workload with spaces.json' }],
  });
}

function assertSuccess(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.ok(result.stdout.endsWith('\n'));
}

function assertError(result, secret) {
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '', 'failure must not leave a partial JSON document on stdout');
  assert.match(result.stderr, /^Error: [^\n]+\n$/);
  assert.doesNotMatch(result.stderr, /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
  assert.doesNotMatch(result.stderr, /(?:\r?\n)\s+at\s/);
  if (secret) assert.equal(result.stderr.includes(secret), false, 'diagnostics must not echo untrusted values');
}

test('batch CLI reproduces the checked-in raw fixture byte for byte from another cwd', () => {
  const first = run(batch, [example('baselines.json')]);
  assertSuccess(first);
  assert.equal(first.stdout, readFileSync(example('baselines.raw.json'), 'utf8'));
  const second = run(batch, [example('baselines.json')]);
  assertSuccess(second);
  assert.equal(second.stdout, first.stdout);
  const raw = JSON.parse(first.stdout);
  assert.equal(raw.inputs.length, 6);
  assert.equal(raw.runs.length, 12);
  assert.deepEqual(raw.policies.map(({ name }) => name), ['fifo', 'sjf']);
});

test('summary CLI reproduces the checked-in summary fixture byte for byte', () => {
  const result = run(summarize, [example('baselines.raw.json')]);
  assertSuccess(result);
  assert.equal(result.stdout, readFileSync(example('baselines.summary.json'), 'utf8'));
  assert.equal(run(summarize, [example('baselines.raw.json')]).stdout, result.stdout);
  const summary = JSON.parse(result.stdout);
  assert.deepEqual(summary, summarizeExperiment(JSON.parse(readFileSync(example('baselines.raw.json'), 'utf8'))));
  assert.deepEqual(summary.policies, [
    {
      policy: 'fifo', runCount: 6, completedTasks: 57, totalWaiting: 429, meanWaiting: 429 / 57,
      maxWaiting: 33, totalTurnaround: 623, meanTurnaround: 623 / 57,
      totalMakespan: 349, totalBusyTime: 194, totalIdleTime: 155, pooledUtilization: 194 / 349,
    },
    {
      policy: 'sjf', runCount: 6, completedTasks: 57, totalWaiting: 325, meanWaiting: 325 / 57,
      maxWaiting: 36, totalTurnaround: 519, meanTurnaround: 519 / 57,
      totalMakespan: 349, totalBusyTime: 194, totalIdleTime: 155, pooledUtilization: 194 / 349,
    },
  ]);
});

test('manifest workload paths resolve against the manifest directory even with arbitrary cwd and spaces', (t) => {
  const folder = directory(t);
  const manifests = join(folder, 'nested manifests');
  const inputs = join(folder, 'input files');
  const other = join(folder, 'other cwd');
  for (const path of [manifests, inputs, other]) mkdirSync(path);
  const path = write(join(inputs, 'input with spaces.json'), simpleWorkload);
  // This wrong same-named file detects resolution relative to the current cwd.
  write(join(other, 'input with spaces.json'), { ...simpleWorkload, schemaVersion: 99 });
  const manifestPath = write(join(manifests, 'experiment with spaces.json'), {
    schemaVersion: 1, policies: ['sjf', 'fifo'],
    workloads: [
      { id: 'relative', path: '../input files/input with spaces.json' },
      { id: 'absolute', path },
    ],
  });
  for (const argument of [manifestPath, relative(other, manifestPath)]) {
    const result = run(batch, [argument], other);
    assertSuccess(result);
    assert.deepEqual(JSON.parse(result.stdout), runExperiment({ schemaVersion: 1, policies: ['sjf', 'fifo'], workloads: [
      { id: 'relative', workload: simpleWorkload }, { id: 'absolute', workload: simpleWorkload },
    ] }));
  }
});

test('archived raw results summarize after the original input and manifest files are removed', (t) => {
  const folder = directory(t);
  const inputs = join(folder, 'original inputs');
  mkdirSync(inputs);
  const generated = generateWorkload({ seed: 123, taskCount: 6 });
  write(join(inputs, 'generated.json'), generated);
  const manifestPath = write(join(inputs, 'manifest.json'), {
    schemaVersion: 1, policies: ['fifo', 'sjf'], workloads: [{ id: 'generated', path: 'generated.json' }],
  });
  const result = run(batch, [manifestPath]);
  assertSuccess(result);
  const archived = write(join(folder, 'archived raw with spaces.json'), result.stdout);
  rmSync(inputs, { recursive: true });
  const summary = run(summarize, [archived]);
  assertSuccess(summary);
  assert.deepEqual(JSON.parse(summary.stdout), summarizeExperiment(JSON.parse(result.stdout)));
  assert.deepEqual(JSON.parse(result.stdout).inputs[0].workload.generation, generated.generation);
});

test('both CLIs support help and reject missing, duplicate, extra and unknown arguments', () => {
  for (const cli of [batch, summarize]) {
    const result = run(cli, ['--help']);
    assertSuccess(result);
    assert.match(result.stdout, /Usage:/);
    assert.match(result.stdout, /stdout/);
    for (const args of [[], ['--unknown'], ['--help', '--help'], ['--help', 'extra.json'], ['a.json', 'b.json']]) {
      assertError(run(cli, args));
    }
  }
});

test('batch treats an empty workload as a valid episode but rejects empty workload or policy lists', (t) => {
  const path = manifest(t);
  const result = run(batch, [path]);
  assertSuccess(result);
  const raw = JSON.parse(result.stdout);
  assert.equal(raw.runs.length, 2);
  assert.ok(raw.runs.every(({ schedule, metrics }) => schedule.length === 0 && Object.values(metrics).every((value) => value === 0)));
  const folder = directory(t);
  const inputPath = write(join(folder, 'empty-workload.json'), emptyWorkload);
  for (const contents of [
    { schemaVersion: 1, policies: ['fifo'], workloads: [] },
    { schemaVersion: 1, policies: [], workloads: [{ id: 'empty', path: inputPath }] },
  ]) assertError(run(batch, [write(join(folder, 'empty.json'), contents)]));
});

test('batch rejects malformed manifest and workload files without partial stdout', (t) => {
  const folder = directory(t);
  const workloadPath = write(join(folder, 'input.json'), simpleWorkload);
  const valid = { schemaVersion: 1, policies: ['fifo'], workloads: [{ id: 'example', path: workloadPath }] };
  for (const contents of [
    '{invalid json', null, [], {}, { ...valid, schemaVersion: 2 }, { ...valid, extra: true },
    { ...valid, policies: ['random'] }, { ...valid, policies: ['fifo', 'fifo'] },
    { ...valid, workloads: null }, { ...valid, workloads: [null] },
    { ...valid, workloads: [{ id: 'example', path: '' }] },
    { ...valid, workloads: [{ id: 'example', path: '  ' }] },
    { ...valid, workloads: [{ id: 'example', path: 4 }] },
    { ...valid, workloads: [{ id: 'example', path: workloadPath, extra: true }] },
    { ...valid, workloads: [...valid.workloads, ...valid.workloads] },
    { ...valid, workloads: [{ id: 'example', path: 'missing.json' }] },
  ]) assertError(run(batch, [write(join(folder, 'invalid-manifest.json'), contents)]));
  for (const contents of ['{invalid json', null, [], {}, { ...simpleWorkload, schemaVersion: 2 }, {
    schemaVersion: 1, tasks: [{ id: 'A', release: 0, duration: 0 }],
  }]) assertError(run(batch, [manifest(t, contents)]));
  const generated = generateWorkload({ seed: 5, taskCount: 4 });
  generated.tasks[0].duration += 1;
  assertError(run(batch, [manifest(t, generated)]));
  assertError(run(batch, [join(folder, 'missing-manifest.json')]));
  assertError(run(batch, [folder]));
});

test('summary CLI rejects malformed files, tampered metrics and missing pairs with empty stdout', (t) => {
  const folder = directory(t);
  const raw = runExperiment({ schemaVersion: 1, policies: ['fifo', 'sjf'], workloads: [{ id: 'example', workload: simpleWorkload }] });
  const changedMetrics = structuredClone(raw);
  changedMetrics.runs[0].metrics.totalWaiting = 1;
  const missingPair = structuredClone(raw);
  missingPair.runs.pop();
  const alteredTransition = structuredClone(raw);
  alteredTransition.runs[0].schedule[0].start += 1;
  const large = runExperiment({ schemaVersion: 1, policies: ['fifo'], workloads: [
    { id: 'large', workload: { schemaVersion: 1, tasks: [{ id: 'A', release: 0, duration: Number.MAX_SAFE_INTEGER }] } },
    { id: 'extra', workload: simpleWorkload },
  ] });
  for (const contents of ['{invalid json', null, [], {}, { ...raw, schemaVersion: 2 }, changedMetrics, missingPair, alteredTransition, large]) {
    assertError(run(summarize, [write(join(folder, 'invalid-raw.json'), contents)]));
  }
  assertError(run(summarize, [join(folder, 'missing-raw.json')]));
  assertError(run(summarize, [folder]));
});

test('CLI errors never echo untrusted IDs, paths, policies, fields or malformed JSON text', (t) => {
  const folder = directory(t);
  const secret = 'private-marker-DO-NOT-ECHO';
  const malicious = `${secret}\n\u001b[2J\u001b[H`;
  const input = write(join(folder, 'input.json'), simpleWorkload);
  const valid = { schemaVersion: 1, policies: ['fifo'], workloads: [{ id: 'example', path: input }] };
  for (const contents of [
    { ...valid, policies: [malicious] },
    { ...valid, workloads: [{ id: malicious, path: input }] },
    { ...valid, workloads: [{ id: 'example', path: malicious }] },
    { ...valid, [malicious]: true },
    `{${malicious}`,
  ]) assertError(run(batch, [write(join(folder, 'malicious.json'), contents)]), secret);
  for (const cli of [batch, summarize]) {
    assertError(run(cli, [malicious]), secret);
    assertError(run(cli, [write(join(folder, 'invalid-json.json'), `{${malicious}`)]), secret);
  }
  assertError(run(batch, [manifest(t, { schemaVersion: 1, tasks: [{ id: malicious, release: 0, duration: 0 }] })]), secret);
  const raw = runExperiment({ schemaVersion: 1, policies: ['fifo'], workloads: [{ id: 'example', workload: simpleWorkload }] });
  for (const change of [
    (value) => { value.policies[0].name = malicious; },
    (value) => { value.runs[0].schedule[0].id = malicious; },
    (value) => { value.inputs[0].id = malicious; },
    (value) => { value[malicious] = true; },
  ]) {
    const altered = structuredClone(raw);
    change(altered);
    assertError(run(summarize, [write(join(folder, 'malicious-raw.json'), altered)]), secret);
  }
});

test('raw stdout does not include paths, environment values or ignored workload metadata', (t) => {
  const marker = 'private-content-must-not-leak';
  const input = {
    ...simpleWorkload, privateNotes: marker,
    tasks: simpleWorkload.tasks.map((task) => ({ ...task, privateNotes: marker })),
  };
  const path = manifest(t, input);
  const result = run(batch, [path], tmpdir(), { ...process.env, SCHEDULER_PRIVATE_TEST: marker });
  assertSuccess(result);
  assert.equal(result.stdout.includes(marker), false);
  assert.equal(result.stdout.includes(path), false);
  assert.deepEqual(JSON.parse(result.stdout).inputs[0].workload, simpleWorkload);
});
