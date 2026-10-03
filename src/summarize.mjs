import { readFile } from 'node:fs/promises';
import { summarizeExperiment } from './experiment.mjs';

const usage = 'Usage: node src/summarize.mjs <raw-experiment.json>';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(`${usage}\nValidates raw schedules and writes recomputed policy summaries to stdout.\n`);
    return;
  }
  if (args.length !== 1 || args[0].startsWith('-')) throw new Error(usage);
  let raw;
  try {
    raw = JSON.parse(await readFile(args[0], 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Raw experiment must contain valid JSON.');
    throw new Error(`Cannot read raw experiment file (${error.code ?? 'unknown error'}).`);
  }
  process.stdout.write(`${JSON.stringify(summarizeExperiment(raw), null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exitCode = 1;
});
