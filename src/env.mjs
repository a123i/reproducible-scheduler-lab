import { compareTasks } from './order.mjs';

/**
 * Validate and copy a versioned workload. All simulation times are exact safe
 * integers. Conservative horizon and aggregate bounds protect every task order.
 */
export function validateWorkload(workload) {
  if (workload === null || typeof workload !== 'object' || Array.isArray(workload)) {
    throw new TypeError('Workload must be an object.');
  }
  if (workload.schemaVersion !== 1) {
    throw new TypeError('Workload schemaVersion must be 1.');
  }
  if (!Array.isArray(workload.tasks)) {
    throw new TypeError('Workload tasks must be an array.');
  }

  const ids = new Set();
  let busyTime = 0;
  let latestRelease = 0;
  const tasks = Array.from(workload.tasks, (task, index) => {
    if (task === null || typeof task !== 'object' || Array.isArray(task)) {
      throw new TypeError(`Task ${index} must be an object.`);
    }
    const { id, release, duration } = task;
    if (typeof id !== 'string' || id.length === 0 || id.trim() !== id) {
      throw new TypeError(`Task ${index} id must be a nonempty string without surrounding whitespace.`);
    }
    if (!id.isWellFormed()) {
      throw new TypeError(`Task ${index} id must be a well-formed Unicode string.`);
    }
    if (ids.has(id)) {
      throw new TypeError(`Task ${index} id duplicates an earlier task.`);
    }
    if (!Number.isSafeInteger(release) || release < 0) {
      throw new TypeError(`Task ${index} release must be a nonnegative safe integer.`);
    }
    if (!Number.isSafeInteger(duration) || duration <= 0) {
      throw new TypeError(`Task ${index} duration must be a positive safe integer.`);
    }
    if (duration > Number.MAX_SAFE_INTEGER - busyTime) {
      throw new RangeError('Workload duration sum exceeds the safe integer range.');
    }
    busyTime += duration;
    latestRelease = Math.max(latestRelease, release);
    ids.add(id);
    return { id, release, duration };
  });
  if (latestRelease > Number.MAX_SAFE_INTEGER - busyTime) {
    throw new RangeError('Workload time horizon exceeds the safe integer range.');
  }
  const aggregateBound = tasks.reduce((bound, task) => (
    bound + BigInt(latestRelease - task.release) + BigInt(busyTime)
  ), 0n);
  if (aggregateBound > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Workload aggregate metric bound exceeds the safe integer range.');
  }
  return { schemaVersion: 1, tasks };
}

/** Single worker, nonpreemptive scheduling with event-driven idle advancement. */
export class SchedulingEnv {
  #tasks;
  #time = 0;
  #finished = new Set();
  #completed = [];

  constructor(workload) {
    this.#tasks = validateWorkload(workload).tasks.sort(compareTasks);
    this.reset();
  }

  reset() {
    this.#time = 0;
    this.#finished = new Set();
    this.#completed = [];
    this.#advanceIdle();
    return this.#observation();
  }

  step(taskId) {
    if (this.#finished.size === this.#tasks.length) {
      throw new Error('Episode has terminated; call reset before another step.');
    }
    const task = this.#tasks.find((candidate) => candidate.id === taskId);
    if (!task || this.#finished.has(task.id) || task.release > this.#time) {
      throw new Error('Action must identify an unfinished ready task.');
    }

    const start = this.#time;
    const finish = start + task.duration;
    const transition = {
      id: task.id,
      start,
      finish,
      waiting: start - task.release,
      turnaround: finish - task.release,
    };
    this.#completed.push(transition);
    this.#finished.add(task.id);
    this.#time = finish;
    this.#advanceIdle();
    const observation = this.#observation();
    return {
      observation,
      reward: transition.waiting === 0 ? 0 : -transition.waiting,
      terminated: observation.terminated,
      info: { transition: { ...transition }, metrics: this.getMetrics() },
    };
  }

  #advanceIdle() {
    const remaining = this.#tasks.filter((task) => !this.#finished.has(task.id));
    if (remaining.length && !remaining.some((task) => task.release <= this.#time)) {
      this.#time = remaining[0].release;
    }
  }

  #observation() {
    const remaining = this.#tasks.filter((task) => !this.#finished.has(task.id));
    return {
      time: this.#time,
      ready: remaining.filter((task) => task.release <= this.#time).map((task) => ({ ...task })),
      pending: remaining.filter((task) => task.release > this.#time).map((task) => ({ ...task })),
      completed: this.#completed.map((transition) => ({ ...transition })),
      terminated: remaining.length === 0,
    };
  }

  /** Metrics for completed tasks only; returns an independent snapshot. */
  getMetrics() {
    const completedTasks = this.#completed.length;
    const totalWaiting = this.#completed.reduce((total, task) => total + task.waiting, 0);
    const maxWaiting = this.#completed.reduce((maximum, task) => Math.max(maximum, task.waiting), 0);
    const totalTurnaround = this.#completed.reduce((total, task) => total + task.turnaround, 0);
    const busyTime = this.#completed.reduce((total, task) => total + (task.finish - task.start), 0);
    const makespan = this.#time;
    return {
      completedTasks,
      makespan,
      totalWaiting,
      meanWaiting: completedTasks ? totalWaiting / completedTasks : 0,
      maxWaiting,
      totalTurnaround,
      meanTurnaround: completedTasks ? totalTurnaround / completedTasks : 0,
      busyTime,
      idleTime: makespan - busyTime,
      utilization: makespan ? busyTime / makespan : 0,
    };
  }
}
