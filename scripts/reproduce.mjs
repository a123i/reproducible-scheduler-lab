import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const usage = 'Usage: node scripts/reproduce.mjs [--help]';
const generatedNames = ['low-load', 'high-load', 'bursty', 'idle-gaps'];
const batches = ['baselines', 'policies'];

function run(script, args, label) {
  const result = spawnSync(process.execPath, [join(root, script), ...args], {
    cwd: root, encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.signal || result.status !== 0 || result.stderr !== '') {
    throw new Error(`${label}: command failed or wrote to stderr.`);
  }
  return result.stdout;
}

function sameBytes(actual, expected, label) {
  if (!Buffer.from(actual, 'utf8').equals(readFileSync(expected))) {
    throw new Error(`${label}: archived bytes do not match.`);
  }
}

function sameValue(actual, expected, label) {
  try {
    assert.deepStrictEqual(actual, expected);
  } catch {
    throw new Error(`${label}: schedule or metrics do not match.`);
  }
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(`${usage}\nRebuilds all fixed archives and checks CLI results without installing packages.\n`);
    return;
  }
  if (args.length !== 0) throw new Error(usage);

  // Only generated raw files are written, in a new temporary directory. The
  // repository is read-only to this verifier; no Git metadata is required.
  const temporary = mkdtempSync(join(tmpdir(), 'scheduler-reproduce-'));
  try {
    for (const name of generatedNames) {
      const output = run('src/generate.mjs', [`examples/generator/${name}.json`], `generator ${name}`);
      sameBytes(output, join(root, `examples/generated/${name}.json`), `generator ${name}`);
    }
    let runs = 0;
    for (const name of batches) {
      const manifestPath = join(root, `examples/experiments/${name}.json`);
      const first = run('src/batch.mjs', [manifestPath], `batch ${name}`);
      const second = run('src/batch.mjs', [manifestPath], `repeat batch ${name}`);
      if (first !== second) throw new Error(`batch ${name}: repeated bytes do not match.`);
      sameBytes(first, join(root, `examples/experiments/${name}.raw.json`), `raw ${name}`);
      const rawPath = join(temporary, `${name}.raw.json`);
      writeFileSync(rawPath, first, 'utf8');
      const summary = run('src/summarize.mjs', [rawPath], `summary ${name}`);
      sameBytes(summary, join(root, `examples/experiments/${name}.summary.json`), `summary ${name}`);
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const raw = JSON.parse(first);
      for (const entry of manifest.workloads) {
        for (const policy of manifest.policies) {
          const output = JSON.parse(run('src/cli.mjs', [
            resolve(dirname(manifestPath), entry.path), '--policy', policy,
          ], `CLI ${name}/${entry.id}/${policy}`));
          const archived = raw.runs.find((item) => item.inputId === entry.id && item.policy === policy);
          sameValue(output, {
            schemaVersion: 1, policy, schedule: archived.schedule, metrics: archived.metrics,
          }, `CLI ${name}/${entry.id}/${policy}`);
          runs += 1;
        }
      }
    }
    const tiny = JSON.parse(run('src/cli.mjs', ['examples/tiny.json'], 'tiny demo'));
    sameValue(tiny.metrics, {
      completedTasks: 3, makespan: 9, totalWaiting: 2, meanWaiting: 2 / 3, maxWaiting: 2,
      totalTurnaround: 8, meanTurnaround: 8 / 3, busyTime: 6, idleTime: 3, utilization: 6 / 9,
    }, 'tiny demo');
    process.stdout.write(`Reproduced ${generatedNames.length} generated fixtures, ${batches.length} repeated batches, ${batches.length} audited summaries, ${runs} matched CLI runs, and the tiny demo.\n`);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  // Do not echo arbitrary file contents, task IDs, absolute paths, or stacks.
  const message = error.code ? `Cannot access a required file (${error.code}).`
    : error instanceof SyntaxError ? 'A required JSON result is invalid.' : error.message;
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
}
