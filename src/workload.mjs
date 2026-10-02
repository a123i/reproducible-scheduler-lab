import { validateWorkload } from './env.mjs';
import { createRandom, validateSeed } from './random.mjs';

export const generatorVersion = 'lcg32-workload-v1';
export const maxTaskCount = 10_000;
const UINT32_MAX = 0xffff_ffff;
const supportedOptions = new Set([
  'seed', 'taskCount', 'initialRelease', 'duration', 'arrivalGap', 'burstSize', 'burstGap',
]);

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
}

function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError(`${label} must be an integer between ${min} and ${max}.`);
  }
  return value === 0 ? 0 : value;
}

function range(value, minimum, label) {
  object(value, label);
  if (Object.keys(value).some((key) => key !== 'min' && key !== 'max')) {
    throw new TypeError(`${label} contains an unknown option.`);
  }
  const min = integer(value.min, minimum, UINT32_MAX, `${label}.min`);
  const max = integer(value.max, min, UINT32_MAX, `${label}.max`);
  return { min, max };
}

/** Normalize every default and reject parameter domains that may overflow. */
export function validateGeneratorOptions(options) {
  object(options, 'Generator options');
  if (Object.keys(options).some((key) => !supportedOptions.has(key))) {
    throw new TypeError('Generator options contain an unknown option.');
  }
  const seed = validateSeed(options.seed);
  const parameters = {
    taskCount: integer(options.taskCount === undefined ? 20 : options.taskCount, 0, maxTaskCount, 'taskCount'),
    initialRelease: integer(options.initialRelease === undefined ? 0 : options.initialRelease, 0, Number.MAX_SAFE_INTEGER, 'initialRelease'),
    duration: range(options.duration === undefined ? { min: 1, max: 8 } : options.duration, 1, 'duration'),
    arrivalGap: range(options.arrivalGap === undefined ? { min: 0, max: 4 } : options.arrivalGap, 0, 'arrivalGap'),
    burstSize: integer(options.burstSize === undefined ? 1 : options.burstSize, 1, maxTaskCount, 'burstSize'),
    burstGap: integer(options.burstGap === undefined ? 0 : options.burstGap, 0, Number.MAX_SAFE_INTEGER, 'burstGap'),
  };

  // At the maximum gaps and durations, H and sum(H - release) are largest.
  // A gap before task i contributes to the bound of each of its i predecessors.
  const count = BigInt(parameters.taskCount);
  if (count > 0n) {
    let lastRelease = BigInt(parameters.initialRelease);
    let aggregateBound = count * count * BigInt(parameters.duration.max);
    for (let index = 1; index < parameters.taskCount; index += 1) {
      const gap = BigInt(parameters.arrivalGap.max)
        + (index % parameters.burstSize === 0 ? BigInt(parameters.burstGap) : 0n);
      lastRelease += gap;
      aggregateBound += BigInt(index) * gap;
    }
    const horizon = lastRelease + count * BigInt(parameters.duration.max);
    if (horizon > BigInt(Number.MAX_SAFE_INTEGER)
      || aggregateBound > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError('Generator parameters exceed the safe workload time or aggregate bounds.');
    }
  }
  return { seed, parameters };
}

/** Generate a schema-v1 workload with complete, replayable provenance. */
export function generateWorkload(options) {
  const { seed, parameters } = validateGeneratorOptions(options);
  const random = createRandom(seed);
  const tasks = [];
  let release = parameters.initialRelease;
  for (let index = 0; index < parameters.taskCount; index += 1) {
    if (index > 0) {
      release += random.integer(parameters.arrivalGap.min, parameters.arrivalGap.max);
      if (index % parameters.burstSize === 0) release += parameters.burstGap;
    }
    tasks.push({
      id: `task-${String(index + 1).padStart(6, '0')}`,
      release,
      duration: random.integer(parameters.duration.min, parameters.duration.max),
    });
  }
  const workload = validateWorkload({ schemaVersion: 1, tasks });
  return {
    schemaVersion: workload.schemaVersion,
    generation: { generator: generatorVersion, seed, parameters },
    tasks: workload.tasks,
  };
}

/** Reject unknown generator versions instead of silently changing replay rules. */
export function replayWorkload(generation) {
  object(generation, 'Generation metadata');
  if (generation.generator !== generatorVersion) {
    throw new TypeError('Unsupported generator version.');
  }
  object(generation.parameters, 'Generation parameters');
  const required = [...supportedOptions].filter((key) => key !== 'seed');
  if (Object.keys(generation.parameters).length !== required.length
    || required.some((key) => !Object.hasOwn(generation.parameters, key)
      || generation.parameters[key] === null || generation.parameters[key] === undefined)) {
    throw new TypeError('Generation parameters must contain every recorded parameter.');
  }
  return generateWorkload({ ...generation.parameters, seed: generation.seed });
}
