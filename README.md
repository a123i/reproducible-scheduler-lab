# Reproducible Scheduler Lab

可复现的任务调度仿真项目，用来比较调度规则、核验指标，并保留可重跑的实验结果。目前提供确定性的单 worker、非抢占调度环境、FIFO/SJF 与等待加权贪心策略、固定 seed 工作负载生成器、命令行入口、等待时间公平性核验和可独立重算的固定批实验工具。具体计划见 [7 日路线图](docs/ROADMAP.md)。

项目采用 Node.js ESM 和内置测试工具，无第三方运行或测试依赖。运行、测试不需要下载包或联网。

## 快速开始

要求 Node.js **22 或更新版本**，以及随 Node.js 提供的 npm。在项目根目录运行：

```sh
npm test
npm run demo
node src/cli.mjs examples/tiny.json --policy fifo
node src/cli.mjs examples/tiny.json --policy sjf
node src/cli.mjs examples/fairness-tradeoff.json --policy sjf
node src/cli.mjs examples/fairness-tradeoff.json --policy waiting-weighted
node src/generate.mjs examples/generator/high-load.json
node src/cli.mjs examples/generated/high-load.json --policy sjf
node src/batch.mjs examples/experiments/baselines.json
node src/summarize.mjs examples/experiments/baselines.raw.json
node src/batch.mjs examples/experiments/policies.json
node src/summarize.mjs examples/experiments/policies.raw.json
npm run reproduce
```

无需执行 `npm install`。调度命令 `src/cli.mjs` 支持 `--policy fifo`（默认）、`--policy sjf` 和 `--policy waiting-weighted`。未知策略会返回非零退出码。

七日完整方法、逐场景结果、证据与限制见 [最终实验报告](docs/REPORT.md)。`npm run reproduce` 会核验四个生成输入、两批重复 raw/重算 summary、33 条配对 CLI 结果和 tiny 指标，全部成功才输出完成信息；它不修改项目文件。导出固定提交到无 Git 元数据、无已安装依赖、空 npm 缓存目录的验收命令见 [交付复现](docs/REPRODUCTION.md)。

## 调度规则

- 一个 worker 一次处理一个任务，开始后运行至完成，不能抢占。
- 时间使用整数。任务的 `release` 表示最早可执行时间，`duration` 表示执行时长。
- 环境先按 `release` 排序，再按 `id` 的 Unicode 代码点顺序决定 tie-break，不依赖本机语言设置或输入顺序。相同输入和相同动作序列应得到相同结果。
- 没有就绪任务且仍有未释放任务时，环境自动推进到下一次释放时间，记录 idle 时间。
- 动作是就绪任务的 `id`。一次 `step` 执行一个完整任务，并返回新的观察与指标。
- 单步 reward 为本次任务等待时间的负值：`-(start - release)`。累计 reward 对应总等待时间的负值。
- 全部任务执行完成后，`terminated` 为 `true`。

reward 只表示等待时间目标。它不单独代表公平性、吞吐能力或所有场景下的策略质量；应同时查看每任务等待和最大等待，不能只看平均值。

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

`transition` 包含 `id`、`start`、`finish`、`waiting`、`turnaround`。`metrics` 提供 `completedTasks`、`makespan`、`totalWaiting`、`meanWaiting`、`maxWaiting`、`totalTurnaround`、`meanTurnaround`、`busyTime`、`idleTime`、`utilization`。

`makespan` 为当前环境时间，包含已经自动推进的 idle 间隔；`busyTime` 为已完成任务的执行时长之和。等待与 turnaround 指标只统计已完成任务。`maxWaiting` 为其中最大的 `waiting`，没有完成任务时为 0，不代表就绪或未释放任务的实时等待上界。每任务等待保留在 `transition.waiting` 和 `schedule[].waiting`，不在指标内重复存储。

`env.getMetrics()` 可在 reset 后、空输入或运行中获取相同定义的独立指标快照。初始自动 idle 会计入 `makespan` 和 `idleTime`，即使尚无完成任务。直接调用 API 时，调用者负责从就绪任务中选择动作。

## 共享策略与完整运行 API

`src/policies.mjs` 导出 `fifo(observation)`、`sjf(observation)`、`waitingWeighted(observation)`、`getPolicy(name)`、`getPolicyDescriptor(name)` 和只读 `policyNames`：

- 输入为 `SchedulingEnv` 返回的有效观察；策略仅选择 `ready` 中的任务，不查看 `pending` 来提前空闲，也不修改观察
- 输出是一个就绪任务 ID；`terminated` 时返回 `null`，调用者不能将它传给 `step`
- 非终止但 `ready` 为空的观察不符合内核约定，策略会抛出错误
- FIFO 比较 `(release, id)`；SJF 比较 `(duration, release, id)`。ID 使用共享的 Unicode 代码点比较，不受语言设置、输入数组或 ready 数组顺序影响
- SJF 使用输入中已知的完整 duration，属于离线仿真的已知时长基准；它不会抢占正在运行的任务
- waiting-weighted 最小化 `duration - waitingWeight × (time - release)`，固定 `waitingWeight = 1`，平局按 `(release, id)`；BigInt 打分比较保证整数精确，仍只选择就绪任务
- `getPolicyDescriptor(name)` 返回独立的名称、语义版本及完整固定参数；运行器和批实验共用同一注册表。没有可变权重 CLI，不允许在归档中改权重却沿用原运行

`src/run.mjs` 导出与 CLI 共用的运行器：

```js
import { runSchedule } from './src/run.mjs';
import { sjf } from './src/policies.mjs';

const result = runSchedule(workload, 'sjf'); // 省略策略则使用 FIFO
console.log(result.policy, result.schedule, result.metrics);

// 也可以逐步使用共享接口：
let observation = env.reset();
while (!observation.terminated) {
  observation = env.step(sjf(observation)).observation;
}
```

运行器返回 `{ schemaVersion: 1, policy, schedule, metrics }`，不修改 workload。空输入返回空 schedule 和全零指标。`maxWaiting` 是版本 1 输出中新增加的字段，原有指标、FIFO 顺序和输入格式保持兼容。

## 比较基准与公平性

```sh
node src/cli.mjs examples/policy-comparison.json --policy fifo
node src/cli.mjs examples/policy-comparison.json --policy sjf
node src/cli.mjs examples/fairness-tradeoff.json --policy fifo
node src/cli.mjs examples/fairness-tradeoff.json --policy sjf
```

同时到达的 `policy-comparison.json` 中，FIFO 顺序为 A/B/C，总等待 11、最大等待 6；SJF 为 B/C/A，总等待 4、最大等待 3。

错开到达的 `fairness-tradeoff.json` 中，SJF 将平均等待从 `22/6` 降到 `14/6`，但最大等待从 **5 增至 6**，长任务等待从 **2 增至 6**。两者结束时间均为 10。这说明平均等待改善并不保证个体等待或最坏等待改善。

完整手算时间线、指标和局限见 [基准核验](docs/BASELINES.md)。这些有限输入不证明某种策略在任意到达模式下最优；本仿真也没有持续无限到达，不能将有限等待示例称为已观测到无限饥饿。

## 等待加权策略与对照

```sh
node src/cli.mjs examples/fairness-tradeoff.json --policy waiting-weighted
node src/cli.mjs examples/waiting-weighted-regression.json --policy waiting-weighted
node src/batch.mjs examples/experiments/policies.json
node src/summarize.mjs examples/experiments/policies.raw.json
```

在 fairness-tradeoff 中，加权策略总等待为 18、最大等待为 5：相对 FIFO 的总等待 22 有所改善；相对 SJF 的总等待 14、最大等待 6，则牺牲平均等待换取较小的最坏等待。新增三任务反例中，加权策略总等待 9，SJF 为 6，两者最大等待均为 5，说明权重不保证产生公平性收益。

七个相同输入 × 三种策略的固定批次共有 21 条运行，每个策略处理 60 个任务；FIFO/SJF/加权策略的总等待分别为 438/331/393，最坏等待分别为 33/36/33。原六输入 FIFO/SJF 批次保持不变，两个批次的聚合不要混比。

因为 `duration - (time - release) = duration + release - time`，对两个已就绪任务，共同等待不会改变其相对顺序；这不是动态优先级反转或无饥饿保证。完整扩展契约、固定权重与版本规则、手算反例和离线重跑命令见 [策略扩展与对照](docs/POLICIES.md)。

## 固定 seed 工作负载

`src/workload.mjs` 导出 `generateWorkload(options)`、`replayWorkload(generation)` 和 `validateGeneratorOptions(options)`。seed 必须显式给出，范围为 `0`–`4294967295` 的整数；不从时钟或 `Math.random()` 推导 seed。

```js
import { generateWorkload, replayWorkload } from './src/workload.mjs';

const workload = generateWorkload({
  seed: 42,
  taskCount: 12,
  duration: { min: 2, max: 6 },
  arrivalGap: { min: 0, max: 1 },
});
const replayed = replayWorkload(workload.generation);
// 相同生成器版本、seed 和参数，得到相同 tasks 与完整 JSON 数据
```

输出仍是可直接交给调度 CLI 的 schemaVersion 1 workload，额外包含 `generation: { generator, seed, parameters }`。parameters 保存全部默认值，因此重放不依赖调用者记得省略了哪些选项。`replayWorkload` 拒绝未知生成器版本和缺失的参数记录。

四组已提交输入覆盖低负载、高负载、同时到达的突发，以及实际出现的 idle 间隔；对应配置位于 `examples/generator/`，生成结果位于 `examples/generated/`，同名配对：

```sh
mkdir -p experiments/local
node src/generate.mjs examples/generator/high-load.json > experiments/local/high-load.json
node src/cli.mjs experiments/local/high-load.json --policy fifo
node src/cli.mjs experiments/local/high-load.json --policy sjf
node src/cli.mjs examples/generated/low-load.json --policy fifo
node src/cli.mjs examples/generated/bursty.json --policy sjf
node src/cli.mjs examples/generated/idle-gaps.json --policy fifo
```

生成 CLI 只向 stdout 写 JSON，不直接修改文件；保存路径由 shell 重定向决定。失败时只向 stderr 写简洁错误并返回退出码 1。以上命令不需要下载依赖或联网。

完整参数、突发间隔语义、伪随机算法和版本规则、固定输入的指标及重跑方法见 [工作负载与复现](docs/WORKLOADS.md)。生成器面向有限的教学与回归仿真，不是密码学随机源，也不宣称这些样本代表真实生产流量。不同 seed 通常产生不同样本，但退化参数或有限样本可能相同。

## 固定批实验与可重算汇总

```sh
mkdir -p experiments/local
node src/batch.mjs examples/experiments/baselines.json > experiments/local/baselines.raw.json
node src/summarize.mjs experiments/local/baselines.raw.json > experiments/local/baselines.summary.json
cmp examples/experiments/baselines.raw.json experiments/local/baselines.raw.json
cmp examples/experiments/baselines.summary.json experiments/local/baselines.summary.json
```

批次包含两个手算输入和四个固定 seed 场景，每个输入各运行 FIFO/SJF，一共 12 条原始结果。raw 保留完整规范化输入、已验证的 seed/生成参数、输入哈希、源码哈希、引擎/策略版本、配置、指标定义、schedule 和 metrics；没有时间戳或机器信息。manifest 的文件路径相对于 manifest 所在目录解析，不写入输出。

汇总命令仅从 raw 读取数据，独立核验时间线和单次指标，再计算任务加权平均等待、跨场景最坏等待及时间加权 utilization；不需要原输入文件。固定批次每个策略处理 57 个任务，FIFO 总等待 429、最大等待 33；SJF 总等待 325、最大等待 36。平均改善仍伴随最坏等待退化，不能只看汇总平均数。

`src/experiment.mjs` 导出 `runExperiment(specification)` 和 `summarizeExperiment(raw)`。完整 manifest/API、版本和哈希约定、重放校验、聚合权重、安全整数限制与结果见 [批实验协议](docs/EXPERIMENTS.md)。CLI 失败时 stdout 为空；重定向请使用单独的输出文件，不要覆盖输入。

## 目录

```text
src/             调度环境、共享策略、运行器、seed 生成器、批实验/汇总与 CLI
examples/        最小输入和手算策略/公平性 fixtures
examples/generator/ 固定 seed 生成配置
examples/generated/ 可重放的生成输入
examples/experiments/ 固定批次 manifest、raw JSON 和重算汇总
test/            Node.js 内置测试
scripts/reproduce.mjs 固定实验与交付的一键复现检查
docs/ROADMAP.md  7 日依赖与验收计划
docs/HANDOFF.md  实际状态、缺项和下一次恢复步骤
docs/BASELINES.md 手算基准、指标与公平性权衡
docs/WORKLOADS.md 生成协议、参数、场景与复现步骤
docs/EXPERIMENTS.md 批实验、溯源、独立核验和汇总定义
docs/POLICIES.md 策略契约、等待权重、改善/退化案例与配对比较
docs/REGRESSION.md 独立参考实现、手算前缀、属性检查和边界回归
docs/REPORT.md    七日方法、结果、证据与限制报告
docs/REPRODUCTION.md 干净源文件目录、离线配置与交付复跑
```

## 回归与指标交叉核验

```sh
npm run test:regression
node src/cli.mjs examples/regression-boundaries.json --policy fifo
node src/cli.mjs examples/regression-boundaries.json --policy sjf
node src/cli.mjs examples/regression-boundaries.json --policy waiting-weighted
```

`npm test` 已包含该回归套件，无需另装依赖。测试侧独立 BigInt 参考实现不调用内核、共享排序或策略选择函数；7,381 个小域穷举输入和 128 个固定 seed 配置覆盖完整三策略，核验完整时间线、每一步观察/指标、非法动作不改变状态、任意前缀 reset 与陈旧快照隔离。等待总量还通过就绪队列长度的时间积分交叉核验，并验证累计 reward 等于负总等待。

新手算 fixture 包含初始/中途 idle、恰好在完成时到达、Unicode 平局和加权 score 平局：三策略 makespan 18、busy 14、idle 4；FIFO/加权总等待 10，SJF 为 7，最坏等待均为 5。两份已归档批实验还与独立参考调度和 BigInt 汇总比较。完整范围、手算前缀表、安全整数边界、已补齐的覆盖缺口与仍有限制见 [回归核验](docs/REGRESSION.md)。

## 当前范围与后续工作

Day 1–7 已实现调度内核、FIFO/SJF/等待加权共享策略与 CLI、固定参数版本注册表、最大等待指标、手算示例与反例、固定 seed 生成器和场景 fixtures、批实验/原始结果/独立汇总、完整三策略的回归与指标交叉核验、最终实验报告及干净源文件目录交付检查。实际验收、commit 与发布状态以 [交接记录](docs/HANDOFF.md)、[报告](docs/REPORT.md) 和对应远程记录为准。

七日范围到 Day 7 交付结束；没有自动扩展成后续开发阶段。此项目没有训练结果，也不承诺某种策略会在所有工作负载上胜出。npm offline 配置下的干净目录复跑不等于操作系统级网络隔离，具体证据边界见交付复现文档。

开发记录只包含实际完成的工作和实际执行的测试。每日提交需要当天存在有意义且通过验收的改动；不使用空提交、回填日期或虚构工时补齐计划。公开发布仅包含本项目代码、测试、示例与文档。
