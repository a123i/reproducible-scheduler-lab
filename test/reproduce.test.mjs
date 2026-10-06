import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const success = 'Reproduced 4 generated fixtures, 2 repeated batches, 2 audited summaries, 33 matched CLI runs, and the tiny demo.\n';

function run(directory, args = []) {
  return spawnSync(process.execPath, [join(directory, 'scripts/reproduce.mjs'), ...args], {
    cwd: tmpdir(), encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024,
  });
}

function copy(t) {
  const directory = mkdtempSync(join(tmpdir(), 'scheduler delivery with spaces-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const path of ['src', 'scripts', 'examples', 'package.json']) {
    cpSync(join(root, path), join(directory, path), { recursive: true });
  }
  return directory;
}

function snapshot(directory) {
  return Object.fromEntries(readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return [path, createHash('sha256').update(readFileSync(path)).digest('hex')];
    }));
}

function fails(result, message) {
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, message);
}

test('reproduction succeeds in a source-only directory with spaces, without Git or installed dependencies', (t) => {
  const directory = copy(t);
  assert.equal(existsSync(join(directory, '.git')), false);
  assert.equal(existsSync(join(directory, 'node_modules')), false);
  const before = snapshot(directory);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = run(directory);
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.equal(result.stdout, success);
  }
  assert.deepEqual(snapshot(directory), before, 'reproduction must not change source files or create output there');
});

test('reproduction help and invalid arguments do not run experiments', () => {
  const help = run(root, ['--help']);
  assert.equal(help.status, 0);
  assert.equal(help.stderr, '');
  assert.match(help.stdout, /Usage:/);
  for (const args of [['--unknown'], ['extra'], ['--help', 'extra']]) {
    fails(run(root, args), /^Error: Usage:/);
  }
});

test('reproduction rejects a generated fixture with changed bytes', (t) => {
  const directory = copy(t);
  const path = join(directory, 'examples/generated/low-load.json');
  writeFileSync(path, `${readFileSync(path, 'utf8')}\n`);
  fails(run(directory), /generator low-load: archived bytes do not match/);
});

test('reproduction rejects a changed raw archive', (t) => {
  const directory = copy(t);
  writeFileSync(join(directory, 'examples/experiments/baselines.raw.json'), '{}\n');
  fails(run(directory), /raw baselines: archived bytes do not match/);
});

test('reproduction rejects a changed summary archive', (t) => {
  const directory = copy(t);
  writeFileSync(join(directory, 'examples/experiments/policies.summary.json'), '{}\n');
  fails(run(directory), /summary policies: archived bytes do not match/);
});

test('reproduction fails on a missing input instead of printing a partial success', (t) => {
  const directory = copy(t);
  rmSync(join(directory, 'examples/generator/low-load.json'));
  fails(run(directory), /generator low-load: command failed/);
});

test('reproduction detects CLI drift separately from the batch implementation', (t) => {
  const directory = copy(t);
  writeFileSync(join(directory, 'src/cli.mjs'), 'process.stdout.write("{}\\n");\n');
  fails(run(directory), /CLI baselines\/policy-comparison\/fifo: schedule or metrics do not match/);
});
