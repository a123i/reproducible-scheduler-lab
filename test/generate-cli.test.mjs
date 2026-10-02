import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { generateWorkload } from '../src/workload.mjs';
import { runSchedule } from '../src/run.mjs';

const generator = fileURLToPath(new URL('../src/generate.mjs', import.meta.url));
const scheduler = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const example = (path) => fileURLToPath(new URL(`../examples/${path}`, import.meta.url));

function run(args, cli = generator) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: tmpdir(), encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null);
  return result;
}

function fixture(t, contents) {
  const directory = mkdtempSync(join(tmpdir(), 'scheduler-generator-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'config with spaces.json');
  writeFileSync(path, typeof contents === 'string' ? contents : JSON.stringify(contents));
  return path;
}

function assertError(result) {
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^Error: [^\n]+\n$/);
  assert.doesNotMatch(result.stderr, /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
}

test('generator CLI emits exact fixture bytes on repeated runs from another directory', () => {
  const config = example('generator/high-load.json');
  const result = run([config]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, readFileSync(example('generated/high-load.json'), 'utf8'));
  assert.equal(run([config]).stdout, result.stdout);
});

test('generator CLI supports space-containing paths and empty workloads', (t) => {
  const config = { seed: 0, taskCount: 0 };
  const result = run([fixture(t, config)]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), generateWorkload(config));
});

test('generator help describes the required seed and stdout output', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /seed is required/);
  assert.match(result.stdout, /stdout/);
});

test('generator rejects malformed arguments, files, JSON and unsafe parameters', (t) => {
  const config = example('generator/high-load.json');
  for (const args of [[], ['--unknown'], [config, config], ['--help', config], ['/missing-generator-config.json']]) {
    assertError(run(args));
  }
  for (const contents of ['{invalid', [], null, {}, { seed: -1 }, { seed: 1, taskCount: 10001 }]) {
    assertError(run([fixture(t, contents)]));
  }
});

test('generator errors do not echo untrusted field names, seed values or file paths', (t) => {
  const malicious = 'unsafe\n\u001b[2J';
  assertError(run([fixture(t, { seed: malicious })]));
  assertError(run([fixture(t, { seed: 1, [malicious]: 2 })]));
  assertError(run([fixture(t, { seed: 1, duration: { min: 1, max: 2, [malicious]: 1 } })]));
  assertError(run([malicious]));
});

test('every generated fixture runs offline through FIFO and SJF scheduling CLIs', () => {
  for (const name of ['low-load', 'high-load', 'bursty', 'idle-gaps']) {
    const path = example(`generated/${name}.json`);
    const workload = JSON.parse(readFileSync(path, 'utf8'));
    const generated = run([example(`generator/${name}.json`)]);
    assert.equal(generated.status, 0);
    assert.equal(generated.stdout, readFileSync(path, 'utf8'));
    for (const policy of ['fifo', 'sjf']) {
      const result = run([path, '--policy', policy], scheduler);
      assert.equal(result.status, 0);
      assert.equal(result.stderr, '');
      assert.deepEqual(JSON.parse(result.stdout), runSchedule(workload, policy));
    }
  }
});
