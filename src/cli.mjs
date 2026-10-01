import { readFile } from 'node:fs/promises';
import { getPolicy } from './policies.mjs';
import { runSchedule } from './run.mjs';

const usage = 'Usage: node src/cli.mjs <workload.json> [--policy fifo|sjf]';

function parseArguments(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  if (!args.length || args[0].startsWith('-')) throw new Error(usage);
  const path = args[0];
  let policy = 'fifo';
  if (args.length > 1) {
    if (args.length !== 3 || args[1] !== '--policy') {
      throw new Error(`Expected --policy fifo or --policy sjf. ${usage}`);
    }
    policy = args[2];
    getPolicy(policy);
  }
  return { path, policy };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage}\nRuns a deterministic single-worker FIFO or SJF schedule.\n`);
    return;
  }
  let workload;
  try {
    workload = JSON.parse(await readFile(options.path, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Workload must contain valid JSON.');
    throw new Error(`Cannot read workload file (${error.code ?? 'unknown error'}).`);
  }

  process.stdout.write(`${JSON.stringify(runSchedule(workload, options.policy), null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exitCode = 1;
});
