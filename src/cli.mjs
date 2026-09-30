import { readFile } from 'node:fs/promises';
import { SchedulingEnv } from './env.mjs';

const usage = 'Usage: node src/cli.mjs <workload.json> [--policy fifo]';

function parseArguments(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  if (!args.length || args[0].startsWith('-')) throw new Error(usage);
  const path = args[0];
  let policy = 'fifo';
  if (args.length > 1) {
    if (args.length !== 3 || args[1] !== '--policy' || args[2] !== 'fifo') {
      throw new Error(`Only --policy fifo is supported. ${usage}`);
    }
    policy = args[2];
  }
  return { path, policy };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage}\nRuns a deterministic single-worker FIFO schedule.\n`);
    return;
  }
  let workload;
  try {
    workload = JSON.parse(await readFile(options.path, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Workload must contain valid JSON.');
    throw new Error(`Cannot read workload file (${error.code ?? 'unknown error'}).`);
  }

  const env = new SchedulingEnv(workload);
  let observation = env.reset();
  let metrics = {
    completedTasks: 0, makespan: 0, totalWaiting: 0, meanWaiting: 0,
    totalTurnaround: 0, meanTurnaround: 0, busyTime: 0, idleTime: 0, utilization: 0,
  };
  while (!observation.terminated) {
    const result = env.step(observation.ready[0].id);
    observation = result.observation;
    metrics = result.info.metrics;
  }
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    policy: options.policy,
    schedule: observation.completed,
    metrics,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exitCode = 1;
});
