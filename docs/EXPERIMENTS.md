# 固定批实验与原始结果

Day 4 提供六个固定输入 × FIFO/SJF 的完整配对比较。实验数据、seed、生成参数、策略版本、配置、时间线和指标定义都保存在 raw JSON；汇总命令只需这一个文件，不需要原 manifest、输入文件或 Git 元数据。

## 离线重跑

要求 Node.js 22+。在仓库根目录运行，不需要 `npm install` 或联网：

```sh
mkdir -p experiments/local
node src/batch.mjs examples/experiments/baselines.json > experiments/local/baselines.raw.json
node src/summarize.mjs experiments/local/baselines.raw.json > experiments/local/baselines.summary.json
cmp examples/experiments/baselines.raw.json experiments/local/baselines.raw.json
cmp examples/experiments/baselines.summary.json experiments/local/baselines.summary.json
```

同一源码、manifest 和输入重跑得到相同字节。Node.js 22/24 的 CI 也执行这组比较。`experiments/local/` 已被 Git 忽略；CLI 只向 stdout 写完整 JSON，不直接创建目录、修改输入或自动发布。失败时 stdout 为空，stderr 为简洁错误，退出码为 1。shell 的 `>` 本身会预先创建或清空目标，因此不要将输出重定向到输入文件，也不要将失败留下的空文件当作实验结果。

已提交的三份文件位于 `examples/experiments/`：

- `baselines.json`：manifest，只选择项目已有的手算与固定 seed 输入
- `baselines.raw.json`：六个规范化输入和十二次独立运行的原始记录
- `baselines.summary.json`：由 raw 重新计算的策略汇总及 raw 内容哈希

它们是小规模、有限的回归样本，不是生产负载或统计抽样研究。

## Manifest 与 JavaScript API

```json
{
  "schemaVersion": 1,
  "policies": ["fifo", "sjf"],
  "workloads": [
    { "id": "comparison", "path": "../policy-comparison.json" },
    { "id": "high-load", "path": "../generated/high-load.json" }
  ]
}
```

`path` 相对于 manifest 所在目录解析，不相对于 shell 的工作目录；绝对路径也可用于本地输入。路径仅用于读取，不写入 raw。输入文件仍采用既有 workload schema。`id` 是用于关联结果的人工场景标签，须唯一、长度 1–64，以 ASCII 字母或数字开头，其余字符只能是字母、数字、点、下划线或连字符。

`policies` 和 `workloads` 必须为非空数组；策略不得重复，且只支持已实现的 FIFO/SJF。每个 workload 自身可以有零个任务。manifest 及每个 entry 的字段必须完整且无未知字段，避免拼写错误悄悄改变实验。一次批次仅执行每个输入/策略组合一次；重复跑同一确定性样本不是新增独立样本。

```js
import { runExperiment, summarizeExperiment } from './src/experiment.mjs';

const raw = runExperiment({
  schemaVersion: 1,
  policies: ['fifo', 'sjf'],
  workloads: [
    { id: 'example', workload: { schemaVersion: 1, tasks: [
      { id: 'A', release: 0, duration: 5 },
      { id: 'B', release: 0, duration: 1 },
    ] } },
  ],
});
const summary = summarizeExperiment(raw);
```

API 接受内嵌 `workload`，CLI 的 manifest 接受 `path`。API 返回独立对象，不修改调用者的输入。raw 按 manifest 的输入顺序、再按策略顺序记录运行。

## 原始 JSON 与溯源

raw schemaVersion 1 的主要字段：

| 字段 | 含义 |
| --- | --- |
| `experimentVersion` | `scheduler-experiment-v1`；约定 raw 格式与验证/汇总协议 |
| `provenance.engine` | `single-worker-nonpreemptive-v1`；单 worker、非抢占内核语义 |
| `provenance.configuration` | worker 数、抢占开关、整数 tick 时间单位、自动 idle 规则、Unicode 代码点 tie-break |
| `provenance.sourceFilesSha256` | 九个固定 `src/` 文件的原始文件字节 SHA-256，包括内核、策略、运行器、生成/重放模块和实验工具；不读取 Git 身份、环境变量或任意用户文件 |
| `metricDefinitions` | 每次运行的全部指标定义，与 README 的完成态指标一致 |
| `policies` | 名称、版本（`fifo-v1` / `sjf-v1`）、完整参数对象（目前均为 `{}`） |
| `inputs` | 场景 ID、规范化 workload 的 SHA-256，以及完整 workload |
| `runs` | 每个输入/策略组合的 `inputId`、`policy`、逐任务 `schedule` 和 `metrics` |

workload 只保留 `schemaVersion`、任务的 `id/release/duration` 和可选的已验证 `generation`。任务按 `(release, id)` 规范化排序；与仿真无关的自定义字段不会复制到产物。若输入有 `generation`，先使用记录的生成器版本、seed 和全部参数重放，再核验规范化任务完全一致；手改 tasks 却留下旧生成记录会报错。手写 workload 没有 seed，不填造一个 seed。

输入哈希与 summary 的 `rawSha256` 采用相同编码：递归按 JavaScript 默认字符串排序排列对象键，保留数组顺序，再用 `JSON.stringify`（无缩进）得到 UTF-8 字节，计算 SHA-256。因此 JSON 缩进和对象键的书写顺序不改变哈希；任务排序规范化后，不同的输入任务数组顺序也得到相同 input 哈希。raw 的输入/运行数组顺序会影响 raw 哈希。

源码哈希允许把归档数据与具体项目源码对照，不宣称签名或可信认证。汇总器只检查所记录源码哈希的字段和格式，不强制它们等于本机源码；这样相同已知协议的旧产物仍可独立汇总。若调度、指标或策略语义不兼容，开发者必须更新对应版本及验证逻辑，不能只换源码却继续声称语义未变。只改注释也会改变源码哈希和固定 raw/summary 快照，因此修改这些源码后应重新生成并审查快照。

产物不包含时钟、运行耗时、主机名、绝对输入路径、环境变量、凭据或自动探测的 Git 信息。用户提供的场景 ID 和任务 ID 本来就是实验输入，会保留在结果中；公开其他实验前仍须人工检查输入不含个人或私有数据。程序不是隐私数据自动脱敏器。

## 汇总如何独立核验

`summarizeExperiment` 不调用 `SchedulingEnv` 或 `runSchedule` 重跑内核，也不直接信任已有的 metrics：

1. 校验已知协议/引擎/策略版本、配置、指标定义、完整输入和 input 哈希
2. 对带 seed 的输入验证生成记录，拒绝不完整元数据或任务与 seed 不符
3. 检查每个输入/策略组合恰好一次；拒绝重复、遗漏和不属于 manifest 的组合
4. 从原始任务及 schedule 逐步检查每个任务恰好完成一次、合法就绪动作、无额外 idle、duration、waiting 和 turnaround；使用共享策略选择函数核验运行所声明的策略
5. 独立从时间线计算全部单次 metrics，要求与 raw 中记录完全一致
6. 对已核验数据按策略汇总，返回关联 raw 的 SHA-256

独立的是时间线/指标算术与汇总路径；策略选择和 workload 校验仍复用已测试的共享模块，因此这不是完全独立的第二套策略实现，也不是对任意恶意文件的来源认证。合法改写整个数据文件并重算哈希，不能靠哈希本身识别；版本未知或内部数据矛盾则明确报错，不输出部分汇总。

## 聚合定义与固定结果

汇总对每个策略保留 `runCount`、`completedTasks`、总等待、任务加权平均等待、最大等待、总/平均 turnaround、总 makespan、总 busy、总 idle 和时间加权 utilization；每个字段定义同时写入 summary。

- `meanWaiting = sum(totalWaiting) / sum(completedTasks)`，不是各场景 meanWaiting 的等权平均
- `meanTurnaround` 使用相同任务权重
- `maxWaiting` 是全部场景中最坏的单任务等待，不是最大值的平均
- `pooledUtilization = sum(busyTime) / sum(makespan)`，不是各场景 utilization 的等权平均
- `totalMakespan` 是独立 episode 结束时间的和，包含每个 episode 的初始 idle，不是连接在一起运行的一条时间线
- 零任务 workload 计入 runCount；若所有任务都为空，所有时间、平均数及 utilization 均为 0
- 批次整数求和先使用 BigInt，超过 `Number.MAX_SAFE_INTEGER` 则明确拒绝汇总，要求拆分批次，不静默丢精度。raw 的合法单次结果仍可保留
- 平均数与比例使用 JavaScript `number`；允许普通浮点舍入，没有置信区间或统计显著性保证

固定六场景共 57 个任务，每个策略各 6 次运行：

| 策略 | 总等待 | 任务加权平均等待 | 最大等待 | 总 turnaround | 总 makespan | 总 busy / idle |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| FIFO | 429 | 429/57 ≈ 7.5263 | 33 | 623 | 349 | 194 / 155 |
| SJF | 325 | 325/57 ≈ 5.7018 | 36 | 519 | 349 | 194 / 155 |

两者 pooled utilization 为 `194/349 ≈ 0.555874`。此固定批次中 SJF 降低总/平均等待，但最坏等待从 33 增至 36。它不能推导 SJF 对所有输入更公平、更优或有显著统计改善。细节仍须查看 raw 的每场景 metrics 和每任务 waiting；汇总会掩盖不同场景的权衡。

下一阶段才增加带等待时间权重的策略；当前没有训练、加权策略或生产流量结论。
