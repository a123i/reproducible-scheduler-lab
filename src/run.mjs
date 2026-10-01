import { SchedulingEnv } from './env.mjs';
import { getPolicy } from './policies.mjs';

/** Run one deterministic episode with a built-in policy. */
export function runSchedule(workload, policy = 'fifo') {
  const select = getPolicy(policy);
  const env = new SchedulingEnv(workload);
  let observation = env.reset();
  while (!observation.terminated) {
    observation = env.step(select(observation)).observation;
  }
  return {
    schemaVersion: 1,
    policy,
    schedule: observation.completed,
    metrics: env.getMetrics(),
  };
}
