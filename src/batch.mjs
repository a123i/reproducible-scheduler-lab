import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { runExperiment } from './experiment.mjs';

const usage = 'Usage: node src/batch.mjs <experiment-manifest.json>';

async function json(path, label) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${label} must contain valid JSON.`);
    throw new Error(`Cannot read ${label} file (${error.code ?? 'unknown error'}).`);
  }
}

function fields(value, expected, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== expected.length
    || expected.some((key) => !Object.hasOwn(value, key))) {
    throw new TypeError(`${label} must contain exactly the documented fields.`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(`${usage}\nWrites self-contained raw JSON for every input/policy pair to stdout.\n`);
    return;
  }
  if (args.length !== 1 || args[0].startsWith('-')) throw new Error(usage);
  const manifest = await json(args[0], 'Manifest');
  fields(manifest, ['schemaVersion', 'policies', 'workloads'], 'Manifest');
  if (!Array.isArray(manifest.workloads)) throw new TypeError('Manifest workloads must be an array.');
  const workloads = [];
  for (const entry of manifest.workloads) {
    fields(entry, ['id', 'path'], 'Manifest workload');
    if (typeof entry.path !== 'string' || !entry.path.trim()) {
      throw new TypeError('Manifest workload path must be a nonempty string.');
    }
    workloads.push({ id: entry.id, workload: await json(resolve(dirname(args[0]), entry.path), 'Workload') });
  }
  const raw = runExperiment({ schemaVersion: manifest.schemaVersion, policies: manifest.policies, workloads });
  process.stdout.write(`${JSON.stringify(raw, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exitCode = 1;
});
