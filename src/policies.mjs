import { compareTasks } from './order.mjs';

/** Built-in policies share (observation) => ready task ID, or null at termination. */
function selectReady(observation, compare) {
  if (observation.terminated) return null;
  if (!observation.ready.length) {
    throw new Error('A nonterminal observation must contain a ready task.');
  }
  // Do not sort or mutate the supplied observation; accept any ready-array order.
  let selected = observation.ready[0];
  for (const task of observation.ready) {
    if (compare(task, selected) < 0) selected = task;
  }
  return selected.id;
}

/** Earliest release, then Unicode code-point ID order. */
export function fifo(observation) {
  return selectReady(observation, compareTasks);
}

/** Shortest available duration, then earliest release, then code-point ID order. */
export function sjf(observation) {
  return selectReady(observation, (left, right) => (
    left.duration - right.duration || compareTasks(left, right)
  ));
}

const waitingWeight = 1;

/** Minimize duration - waitingWeight * waiting, then release and code-point ID. */
export function waitingWeighted(observation) {
  // Defer score calculation until selectReady has handled termination/empty ready.
  // BigInt keeps score comparison exact throughout the supported integer domain.
  const score = (task) => BigInt(task.duration)
    - BigInt(waitingWeight) * (BigInt(observation.time) - BigInt(task.release));
  return selectReady(observation, (left, right) => {
    const leftScore = score(left);
    const rightScore = score(right);
    if (leftScore !== rightScore) return leftScore < rightScore ? -1 : 1;
    return compareTasks(left, right);
  });
}

// One registry binds public names, semantic versions, fixed parameters and selectors.
// Adding a name is compatible; changing an existing policy's behavior needs a new version.
const registry = Object.freeze({
  fifo: Object.freeze({ version: 'fifo-v1', parameters: Object.freeze({}), select: fifo }),
  sjf: Object.freeze({ version: 'sjf-v1', parameters: Object.freeze({}), select: sjf }),
  'waiting-weighted': Object.freeze({
    version: 'waiting-weighted-v1', parameters: Object.freeze({ waitingWeight }), select: waitingWeighted,
  }),
});

export const policyNames = Object.freeze(Object.keys(registry));

function lookup(name) {
  if (typeof name === 'string' && Object.hasOwn(registry, name)) return registry[name];
  // Never echo arbitrary policy names into CLI diagnostics.
  throw new Error(`Unknown policy. Supported policies: ${policyNames.join(', ')}.`);
}

export function getPolicy(name) {
  return lookup(name).select;
}

/** Return an independent serializable descriptor; callers cannot alter the registry. */
export function getPolicyDescriptor(name) {
  const { version, parameters } = lookup(name);
  return { name, version, parameters: { ...parameters } };
}
