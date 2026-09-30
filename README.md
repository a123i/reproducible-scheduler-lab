# Reproducible Scheduler Lab

可复现的任务调度仿真项目，用来比较调度规则、核验指标，并保留可重跑的实验结果。首日范围是一个确定性的单 worker、非抢占调度环境及命令行入口。后续一周逐步增加策略、工作负载和实验工具，具体计划见 [7 日路线图](docs/ROADMAP.md)。

项目采用 Node.js ESM 和内置测试工具，无第三方运行或测试依赖。运行、测试不需要下载包或联网。

## 快速开始

要求 Node.js **22 或更新版本**，以及随 Node.js 提供的 npm。在项目根目录运行：

```sh
npm test
npm run demo
node src/cli.mjs examples/tiny.json --policy fifo
```

无需执行 `npm install`。首日命令行支持 FIFO；后续策略在实现并验收后才列入可用功能。

## 调度规则

- 一个 worker 一次处理一个任务，开始后运行至完成，不能抢占。
- 时间使用整数。任务的 `release` 表示最早可执行时间，`duration` 表示执行时长。
- 环境先按 `release` 排序，再按 `id` 的 Unicode 代码点顺序决定 tie-break，不依赖本机语言设置或输入顺序。相同输入和相同动作序列应得到相同结果。
- 没有就绪任务且仍有未释放任务时，环境自动推进到下一次释放时间，记录 idle 时间。
- 动作是就绪任务的 `id`。一次 `step` 执行一个完整任务，并返回新的观察与指标。
- 单步 reward 为本次任务等待时间的负值：`-(start - release)`。累计 reward 对应总等待时间的负值。
- 全部任务执行完成后，`terminated` 为 `true`。

reward 只表示等待时间目标。它不单独代表公平性、吞吐能力或所有场景下的策略质量；后续实验会同时比较其他指标。

## 输入格式与例子

工作负载为 JSON：

```json
{
  "schemaVersion": 1,
  "tasks": [
    { "id": "A", "release": 0, "duration": 3 },
    { "id": "B", "release": 1, "duration": 2 },
    { "id": "C", "release": 8, "duration": 1 }
  ]
}
```

`validateWorkload` 校验并复制输入，主要约束为：

- `schemaVersion` 必须为 `1`，`tasks` 必须为数组；空数组表示立即结束的 episode。
- `id` 必须是唯一的非空、合法 Unicode 字符串，不能有首尾空白或孤立代理项；`release` 为非负安全整数，`duration` 为正安全整数。
- 令 `H = max(release) + sum(duration)`（空输入的 `H = 0`），则 `H` 和保守聚合界 `sum(H - release)` 都不能超过 `Number.MAX_SAFE_INTEGER`。内核用 BigInt 核验聚合界，使整数时间、总等待和总 turnaround 保持精确。

该边界是保守支持域；即使某个具体任务顺序不会溢出，超过保守界的输入仍会被拒绝。平均等待、平均 turnaround 和 utilization 使用 JavaScript `number` 小数，不保证有理数的无损表示。

FIFO 在此例中依次执行 A、B、C：A 在 0–3 运行，B 在 3–5 运行，5–8 为空闲，C 在 8–9 运行。预期结束时间为 **9**，总等待时间为 **2**，busy 时间为 **6**，idle 时间为 **3**，累计 reward 为 **-2**。

## JavaScript API

`src/env.mjs` 导出 `SchedulingEnv` 和 `validateWorkload`：

```js
import { SchedulingEnv, validateWorkload } from './src/env.mjs';

const workload = {
  schemaVersion: 1,
  tasks: [
    { id: 'A', release: 0, duration: 3 },
    { id: 'B', release: 1, duration: 2 },
    { id: 'C', release: 8, duration: 1 },
  ],
};

validateWorkload(workload);
const env = new SchedulingEnv(workload);
const observation = env.reset();
const result = env.step('A');
console.log(observation, result);
```

`reset()` 返回观察，包含 `time`、`ready`、`pending`、`completed`、`terminated`。`ready` 和 `pending` 是任务对象数组，`completed` 是已完成 transition 的数组。`step(id)` 返回：

```js
{
  observation,
  reward,
  terminated,
  info: { transition, metrics }
}
```

`transition` 包含 `id`、`start`、`finish`、`waiting`、`turnaround`。`metrics` 提供 `completedTasks`、`makespan`、`totalWaiting`、`meanWaiting`、`totalTurnaround`、`meanTurnaround`、`busyTime`、`idleTime`、`utilization`。

`makespan` 为当前环境时间，包含已经自动推进的 idle 间隔；`busyTime` 为已完成任务的执行时长之和。直接调用 API 时，调用者负责从就绪任务中选择动作；CLI 使用已实现的策略完成整个工作负载。

## 目录

```text
src/             调度环境与 CLI
examples/        最小可复现输入
test/            Node.js 内置测试
docs/ROADMAP.md  7 日依赖与验收计划
docs/HANDOFF.md  实际状态、缺项和下一次恢复步骤
```

## 当前范围与后续工作

首日交付范围是调度内核、FIFO CLI、最小示例、基础测试和文档。实际验收、commit 与 push 状态以 [交接记录](docs/HANDOFF.md) 为准。

基准策略比较、固定 seed 生成器、批实验、可扩展策略接口和最终报告属于后续计划，尚不能当作现有功能。此项目没有训练结果，也不承诺某种策略会在所有工作负载上胜出。

开发记录只包含实际完成的工作和实际执行的测试。每日提交需要当天存在有意义且通过验收的改动；不使用空提交、回填日期或虚构工时补齐计划。公开发布仅包含本项目代码、测试、示例与文档。
