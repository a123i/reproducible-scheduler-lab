import { readFile } from 'node:fs/promises';
import { generateWorkload } from './workload.mjs';

const usage = 'Usage: node src/generate.mjs <generator-config.json>';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(`${usage}\nWrites a seeded workload as JSON to stdout; seed is required.\n`);
    return;
  }
  if (args.length !== 1 || args[0].startsWith('-')) throw new Error(usage);
  let options;
  try {
    options = JSON.parse(await readFile(args[0], 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Generator config must contain valid JSON.');
    throw new Error(`Cannot read generator config file (${error.code ?? 'unknown error'}).`);
  }
  process.stdout.write(`${JSON.stringify(generateWorkload(options), null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exitCode = 1;
});
