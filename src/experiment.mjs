import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { validateWorkload } from './env.mjs';
import { compareTasks } from './order.mjs';
import { getPolicy } from './policies.mjs';
import { runSchedule } from './run.mjs';
import { replayWorkload } from './workload.mjs';

export const experimentVersion = 'scheduler-experiment-v1';
const engine = 'single-worker-nonpreemptive-v1';
const sourceFiles = [
  'batch.mjs', 'env.mjs', 'experiment.mjs', 'order.mjs', 'policies.mjs',
  'random.mjs', 'run.mjs', 'summarize.mjs', 'workload.mjs',
];
const configuration = {
  workerCount: 1,
  preemptive: false,
  timeUnit: 'integer-tick',
  idle: 'advance-to-next-release',
  idTieBreak: 'unicode-code-point',
};
const metricDefinitions = {
  completedTasks: 'Number of tasks in the completed schedule.',
  makespan: 'Final finish time measured from time zero; zero for an empty workload.',
  totalWaiting: 'Sum of start - release over all tasks.',
  meanWaiting: 'totalWaiting / completedTasks; zero when completedTasks is zero.',
  maxWaiting: 'Maximum start - release; zero for an empty workload.',
  totalTurnaround: 'Sum of finish - release over all tasks.',
  meanTurnaround: 'totalTurnaround / completedTasks; zero when completedTasks is zero.',
  busyTime: 'Sum of task duration over all tasks.',
  idleTime: 'makespan - busyTime; includes idle time before the first release.',
  utilization: 'busyTime / makespan; zero when makespan is zero.',
};
const summaryDefinitions = {
  runCount: 'Number of input workloads evaluated by this policy, including empty workloads.',
  completedTasks: 'Sum of completedTasks across this policy\'s runs.',
  totalWaiting: 'Sum of totalWaiting across this policy\'s runs.',
  meanWaiting: 'totalWaiting / completedTasks; task-weighted, not a mean of run means; zero for no tasks.',
  maxWaiting: 'Maximum maxWaiting across this policy\'s runs; zero for no tasks.',
  totalTurnaround: 'Sum of totalTurnaround across this policy\'s runs.',
  meanTurnaround: 'totalTurnaround / completedTasks; task-weighted; zero for no tasks.',
  totalMakespan: 'Sum of per-run makespan; runs are separate episodes, not one continuous timeline.',
  totalBusyTime: 'Sum of per-run busyTime.',
  totalIdleTime: 'Sum of per-run idleTime.',
  pooledUtilization: 'totalBusyTime / totalMakespan; time-weighted, not a mean of run utilizations; zero for zero horizon.',
};

function keys(value, required, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== required.length
    || required.some((key) => !Object.hasOwn(value, key))) {
    throw new TypeError(`${label} must contain exactly the documented fields.`);
  }
}

function equal(actual, expected, label) {
  if (!isDeepStrictEqual(actual, expected)) throw new TypeError(`${label} does not match the recorded protocol or data.`);
}

function nonemptyArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${label} must be a nonempty array.`);
}

function policies(names) {
  nonemptyArray(names, 'Policies');
  const seen = new Set();
  return Array.from(names, (name) => {
    getPolicy(name);
    if (seen.has(name)) throw new TypeError('Policies must not contain duplicates.');
    seen.add(name);
    return { name, version: `${name}-v1`, parameters: {} };
  });
}

function inputId(id, seen) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id) || seen.has(id)) {
    throw new TypeError('Input IDs must be unique 1-64 character ASCII letters, digits, dots, underscores or hyphens, starting with a letter or digit.');
  }
  seen.add(id);
}

// Sort keys recursively so hashes do not depend on JSON indentation or key order.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function normalizedWorkload(value) {
  const workload = validateWorkload(value);
  workload.tasks.sort(compareTasks);
  for (const task of workload.tasks) if (task.release === 0) task.release = 0;
  if (Object.hasOwn(value, 'generation')) {
    const replayed = replayWorkload(value.generation);
    equal(workload.tasks, replayed.tasks, 'Generated input tasks');
    return { schemaVersion: 1, generation: replayed.generation, tasks: workload.tasks };
  }
  return workload;
}

function sourceHashes() {
  return Object.fromEntries(sourceFiles.map((file) => [
    `src/${file}`, createHash('sha256').update(readFileSync(new URL(file, import.meta.url))).digest('hex'),
  ]));
}

/** Run every requested policy on every input exactly once, retaining raw data. */
export function runExperiment(specification) {
  keys(specification, ['schemaVersion', 'policies', 'workloads'], 'Experiment specification');
  equal(specification.schemaVersion, 1, 'Experiment schemaVersion');
  const selected = policies(specification.policies);
  nonemptyArray(specification.workloads, 'Workloads');
  const ids = new Set();
  const inputs = Array.from(specification.workloads, (entry) => {
    keys(entry, ['id', 'workload'], 'Workload entry');
    inputId(entry.id, ids);
    const workload = normalizedWorkload(entry.workload);
    return { id: entry.id, sha256: hash(workload), workload };
  });
  const runs = inputs.flatMap((input) => selected.map(({ name }) => {
    const { schedule, metrics } = runSchedule(input.workload, name);
    return { inputId: input.id, policy: name, schedule, metrics };
  }));
  return {
    schemaVersion: 1,
    experimentVersion,
    provenance: { engine, configuration: { ...configuration }, sourceFilesSha256: sourceHashes() },
    metricDefinitions: { ...metricDefinitions },
    policies: selected,
    inputs,
    runs,
  };
}

// This reduction does not call the environment or runSchedule: arithmetic is
// independently reconstructed from recorded tasks and transitions.
function inspectSchedule(input, run) {
  if (!Array.isArray(run.schedule) || run.schedule.length !== input.workload.tasks.length) {
    throw new TypeError('Each run must complete every input task exactly once.');
  }
  const remaining = new Map(input.workload.tasks.map((task) => [task.id, task]));
  const select = getPolicy(run.policy);
  let time = 0;
  let totalWaiting = 0;
  let maxWaiting = 0;
  let totalTurnaround = 0;
  let busyTime = 0;
  for (const transition of run.schedule) {
    keys(transition, ['id', 'start', 'finish', 'waiting', 'turnaround'], 'Transition');
    const task = remaining.get(transition.id);
    if (!task) throw new TypeError('Schedule contains an unknown or repeated task.');
    let nextRelease = Infinity;
    for (const candidate of remaining.values()) nextRelease = Math.min(nextRelease, candidate.release);
    time = Math.max(time, nextRelease);
    const ready = [...remaining.values()].filter((candidate) => candidate.release <= time);
    if (select({ time, ready, terminated: false }) !== task.id) {
      throw new TypeError('Schedule does not follow the recorded policy.');
    }
    const waiting = time - task.release;
    const turnaround = waiting + task.duration;
    equal(transition, {
      id: task.id, start: time, finish: time + task.duration, waiting, turnaround,
    }, 'Transition');
    totalWaiting += waiting;
    maxWaiting = Math.max(maxWaiting, waiting);
    totalTurnaround += turnaround;
    busyTime += task.duration;
    time += task.duration;
    remaining.delete(task.id);
  }
  const completedTasks = run.schedule.length;
  const metrics = {
    completedTasks,
    makespan: time,
    totalWaiting,
    meanWaiting: completedTasks ? totalWaiting / completedTasks : 0,
    maxWaiting,
    totalTurnaround,
    meanTurnaround: completedTasks ? totalTurnaround / completedTasks : 0,
    busyTime,
    idleTime: time - busyTime,
    utilization: time ? busyTime / time : 0,
  };
  equal(run.metrics, metrics, 'Run metrics');
  return metrics;
}

function safeSum(values) {
  const total = values.reduce((sum, value) => sum + BigInt(value), 0n);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Batch summary aggregate exceeds the safe integer range; use smaller batches.');
  }
  return Number(total);
}

/** Validate archived raw data and recompute task/time-weighted policy totals. */
export function summarizeExperiment(raw) {
  keys(raw, ['schemaVersion', 'experimentVersion', 'provenance', 'metricDefinitions', 'policies', 'inputs', 'runs'], 'Raw experiment');
  equal(raw.schemaVersion, 1, 'Raw schemaVersion');
  equal(raw.experimentVersion, experimentVersion, 'Experiment version');
  keys(raw.provenance, ['engine', 'configuration', 'sourceFilesSha256'], 'Provenance');
  equal(raw.provenance.engine, engine, 'Engine version');
  equal(raw.provenance.configuration, configuration, 'Simulation configuration');
  keys(raw.provenance.sourceFilesSha256, sourceFiles.map((file) => `src/${file}`), 'Source hashes');
  for (const digest of Object.values(raw.provenance.sourceFilesSha256)) {
    if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) throw new TypeError('Source hashes must be SHA-256 hex strings.');
  }
  equal(raw.metricDefinitions, metricDefinitions, 'Metric definitions');
  nonemptyArray(raw.policies, 'Policies');
  const selected = policies(Array.from(raw.policies, (policy) => {
    keys(policy, ['name', 'version', 'parameters'], 'Policy');
    return policy.name;
  }));
  equal(raw.policies, selected, 'Policy versions and parameters');
  nonemptyArray(raw.inputs, 'Inputs');
  const inputs = new Map();
  const ids = new Set();
  for (const input of raw.inputs) {
    keys(input, ['id', 'sha256', 'workload'], 'Input');
    inputId(input.id, ids);
    const workload = normalizedWorkload(input.workload);
    equal(input.workload, workload, 'Normalized input');
    equal(input.sha256, hash(workload), 'Input SHA-256');
    inputs.set(input.id, input);
  }
  if (!Array.isArray(raw.runs) || raw.runs.length !== inputs.size * selected.length) {
    throw new TypeError('Raw runs must contain every input/policy pair exactly once.');
  }
  const perPolicy = new Map(selected.map(({ name }) => [name, new Map()]));
  for (const run of raw.runs) {
    keys(run, ['inputId', 'policy', 'schedule', 'metrics'], 'Run');
    const input = inputs.get(run.inputId);
    const group = perPolicy.get(run.policy);
    if (!input || !group || group.has(run.inputId)) {
      throw new TypeError('Raw runs contain an unknown or repeated input/policy pair.');
    }
    group.set(run.inputId, inspectSchedule(input, run));
  }
  const summaries = selected.map(({ name }) => {
    const metrics = [...perPolicy.get(name).values()];
    const sum = (field) => safeSum(metrics.map((metric) => metric[field]));
    const completedTasks = sum('completedTasks');
    const totalWaiting = sum('totalWaiting');
    const totalTurnaround = sum('totalTurnaround');
    const totalMakespan = sum('makespan');
    const totalBusyTime = sum('busyTime');
    return {
      policy: name,
      runCount: metrics.length,
      completedTasks,
      totalWaiting,
      meanWaiting: completedTasks ? totalWaiting / completedTasks : 0,
      maxWaiting: metrics.reduce((maximum, metric) => Math.max(maximum, metric.maxWaiting), 0),
      totalTurnaround,
      meanTurnaround: completedTasks ? totalTurnaround / completedTasks : 0,
      totalMakespan,
      totalBusyTime,
      totalIdleTime: sum('idleTime'),
      pooledUtilization: totalMakespan ? totalBusyTime / totalMakespan : 0,
    };
  });
  return {
    schemaVersion: 1,
    experimentVersion,
    rawSha256: hash(raw),
    inputCount: inputs.size,
    runCount: raw.runs.length,
    metricDefinitions: { ...summaryDefinitions },
    policies: summaries,
  };
}
