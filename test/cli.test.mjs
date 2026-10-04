import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const cliPath = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const examplePath = fileURLToPath(new URL('../examples/tiny.json', import.meta.url));

function run(args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null);
  return result;
}

function fixture(t, contents, name = 'workload with spaces.json') {
  const directory = mkdtempSync(join(testDirectory, '.cli-fixture-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, name);
  writeFileSync(path, typeof contents === 'string' ? contents : JSON.stringify(contents), 'utf8');
  return path;
}

function assertFriendlyError(result) {
  assert.equal(result.status, 1);
  assert.equal(result.stdout.trim(), '');
  assert.ok(result.stderr.trim().length > 0, 'an error should explain the failure');
  assert.ok(result.stderr.trim().split(/\r?\n/).length <= 2, 'errors should remain concise');
  assert.doesNotMatch(result.stderr, /(?:\r?\n)\s+at\s/);
}

test('CLI runs the checked-in tiny workload with exact FIFO output', () => {
  const result = run([examplePath]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), {
    schemaVersion: 1,
    policy: 'fifo',
    schedule: [
      { id: 'A', start: 0, finish: 3, waiting: 0, turnaround: 3 },
      { id: 'B', start: 3, finish: 5, waiting: 2, turnaround: 4 },
      { id: 'C', start: 8, finish: 9, waiting: 0, turnaround: 1 },
    ],
    metrics: {
      completedTasks: 3, makespan: 9, totalWaiting: 2, meanWaiting: 2 / 3, maxWaiting: 2,
      totalTurnaround: 8, meanTurnaround: 8 / 3, busyTime: 6, idleTime: 3, utilization: 2 / 3,
    },
  });
});

test('explicit FIFO and repeated runs produce identical output', () => {
  const automatic = run([examplePath]);
  const explicit = run([examplePath, '--policy', 'fifo']);
  const repeated = run([examplePath]);
  assert.equal(explicit.status, 0);
  assert.equal(repeated.status, 0);
  assert.equal(explicit.stderr, '');
  assert.equal(explicit.stdout, automatic.stdout);
  assert.equal(repeated.stdout, automatic.stdout);
});

test('CLI handles file paths containing spaces and sorts FIFO ties by id', (t) => {
  const path = fixture(t, {
    schemaVersion: 1,
    tasks: [
      { id: 'a', release: 0, duration: 1 },
      { id: 'Z', release: 0, duration: 2 },
      { id: 'late', release: 8, duration: 1 },
      { id: 'A', release: 0, duration: 3 },
    ],
  });
  const result = run([path]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout).schedule.map(({ id }) => id), ['A', 'Z', 'a', 'late']);
});

test('CLI reports all-zero metrics for an empty workload', (t) => {
  const path = fixture(t, { schemaVersion: 1, tasks: [] });
  const result = run([path]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), {
    schemaVersion: 1,
    policy: 'fifo',
    schedule: [],
    metrics: {
      completedTasks: 0, makespan: 0, totalWaiting: 0, meanWaiting: 0, maxWaiting: 0,
      totalTurnaround: 0, meanTurnaround: 0, busyTime: 0, idleTime: 0, utilization: 0,
    },
  });
});

test('--help succeeds and explains invocation', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /workload|usage/i);
  assert.match(result.stdout, /--policy/);
});

test('argument errors return a concise diagnostic and exit 1', async (t) => {
  const cases = [
    ['missing workload', []],
    ['unknown option', [examplePath, '--unknown']],
    ['unknown policy', [examplePath, '--policy', 'random']],
    ['duplicate policy', [examplePath, '--policy', 'fifo', '--policy', 'fifo']],
    ['missing policy value', [examplePath, '--policy']],
    ['extra path', [examplePath, examplePath]],
  ];
  for (const [label, args] of cases) {
    await t.test(label, () => assertFriendlyError(run(args)));
  }
});

test('missing files return a concise diagnostic without a stack', () => {
  assertFriendlyError(run([join(testDirectory, 'this-workload-does-not-exist.json')]));
});

test('malformed JSON returns a concise diagnostic without a stack', (t) => {
  assertFriendlyError(run([fixture(t, '{invalid json')]));
});

test('invalid workloads return a concise diagnostic without a stack', (t) => {
  const path = fixture(t, {
    schemaVersion: 1,
    tasks: [{ id: 'A', release: 0, duration: 0 }],
  });
  assertFriendlyError(run([path]));
});

test('invalid task diagnostics cannot emit ID-supplied terminal control sequences', (t) => {
  const task = { id: 'trusted\n\u001b[2J\u001b[Hspoofed-success', release: 0, duration: 1 };
  for (const tasks of [
    [{ ...task, release: -1 }],
    [{ ...task, duration: 0 }],
    [task, { ...task }],
  ]) {
    const path = fixture(t, { schemaVersion: 1, tasks });
    const result = run([path]);
    assertFriendlyError(result);
    assert.doesNotMatch(result.stderr, /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
    assert.equal(result.stderr.trim().split(/\r?\n/).length, 1);
  }
});

test('SJF CLI selects the shortest ready task and reports the hand-calculated metrics', () => {
  const path = fileURLToPath(new URL('../examples/policy-comparison.json', import.meta.url));
  const result = run([path, '--policy', 'sjf']);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  const output = JSON.parse(result.stdout);
  assert.equal(output.policy, 'sjf');
  assert.deepEqual(output.schedule.map(({ id }) => id), ['B', 'C', 'A']);
  assert.equal(output.metrics.totalWaiting, 4);
  assert.equal(output.metrics.maxWaiting, 3);
  assert.equal(run([path, '--policy', 'sjf']).stdout, result.stdout);
});

test('SJF CLI handles empty input and tiny idle intervals', (t) => {
  const empty = run([fixture(t, { schemaVersion: 1, tasks: [] }), '--policy', 'sjf']);
  assert.equal(empty.status, 0);
  const result = JSON.parse(empty.stdout);
  assert.equal(result.policy, 'sjf');
  assert.deepEqual(result.schedule, []);
  assert.ok(Object.values(result.metrics).every((value) => value === 0));
  const tiny = run([examplePath, '--policy', 'sjf']);
  assert.equal(tiny.status, 0);
  assert.equal(JSON.parse(tiny.stdout).metrics.idleTime, 3);
});

test('unknown policy names cannot emit terminal control sequences', () => {
  const result = run([examplePath, '--policy', 'evil\n\u001b[2J']);
  assertFriendlyError(result);
  assert.doesNotMatch(result.stderr, /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
});

test('waiting-weighted CLI is reproducible and exposes the new policy in help', () => {
  const path = fileURLToPath(new URL('../examples/fairness-tradeoff.json', import.meta.url));
  const result = run([path, '--policy', 'waiting-weighted']);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  const output = JSON.parse(result.stdout);
  assert.equal(output.policy, 'waiting-weighted');
  assert.deepEqual(output.schedule.map(({ id }) => id), ['A', 'short-1', 'short-2', 'long', 'short-3', 'short-4']);
  assert.equal(output.metrics.totalWaiting, 18);
  assert.equal(output.metrics.maxWaiting, 5);
  assert.equal(run([path, '--policy', 'waiting-weighted']).stdout, result.stdout);
  assert.match(run(['--help']).stdout, /fifo\|sjf\|waiting-weighted/);
});

test('waiting-weighted CLI handles empty input and does not accept unrecorded weight overrides', (t) => {
  const empty = run([fixture(t, { schemaVersion: 1, tasks: [] }), '--policy', 'waiting-weighted']);
  assert.equal(empty.status, 0);
  assert.deepEqual(JSON.parse(empty.stdout).schedule, []);
  assertFriendlyError(run([examplePath, '--policy', 'waiting-weighted', '--waiting-weight', '2']));
});
