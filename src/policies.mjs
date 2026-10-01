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

export const policyNames = Object.freeze(['fifo', 'sjf']);

export function getPolicy(name) {
  if (name === 'fifo') return fifo;
  if (name === 'sjf') return sjf;
  // Never echo arbitrary policy names into CLI diagnostics.
  throw new Error(`Unknown policy. Supported policies: ${policyNames.join(', ')}.`);
}
