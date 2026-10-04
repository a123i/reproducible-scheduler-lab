# 策略扩展、等待权重与对照

Day 5 增加确定性的 `waiting-weighted` 基准。它和 FIFO/SJF 使用同一环境、输入、动作、reward 和指标定义，不训练模型，也不改变任务的 release/duration。

## 固定策略契约

`src/policies.mjs` 是名称、语义版本、固定参数和选择函数的唯一注册表：

| 名称 | 版本 | 参数 | 选择规则 |
| --- | --- | --- | --- |
| `fifo` | `fifo-v1` | `{}` | 最小 `(release, id)` |
| `sjf` | `sjf-v1` | `{}` | 最小 `(duration, release, id)` |
| `waiting-weighted` | `waiting-weighted-v1` | `{ "waitingWeight": 1 }` | 最小 `(duration - waitingWeight × waiting, release, id)` |

- `getPolicy(name)` 返回 `(observation) => readyTaskId | null`；`getPolicyDescriptor(name)` 返回独立的 `{ name, version, parameters }` 数据快照
- `policyNames` 是只读的支持名称数组；不允许 `constructor`、`__proto__` 等原型名字成为策略
- 输入须为 `SchedulingEnv` 的有效观察。策略只读 `ready` 和决策所需的 `time`，不读取未来 `pending` 来主动空闲，也不读取已完成历史来保留隐式状态
- 非终止时必须选择 `ready` 中的一项；非终止且 ready 为空会报错。终止时返回 `null`，不可再传给 `step`
- 选择不能修改观察、任务或数组；相同观察必须给出相同动作，ready 数组顺序不能影响结果。不得使用时钟、全局随机数、环境变量或调用顺序
- 最后按 `release`、Unicode 代码点 `id` 确定平局，不依赖语言设置。环境仍负责拒绝非法动作，且不会抢占正在运行的任务
- 契约接受内核已经校验过的观察，不是任意外部对象的完整校验器

`fifo`、`sjf`、`waitingWeighted` 可直接调用。CLI 与 `runSchedule` 通过同一注册表查找函数；批实验通过同一注册表记录名称、版本及参数，汇总时再核验它们。修改返回的 descriptor 或 raw 参数对象不会改变后续调用。

## 等待时间加权贪心规则

在决策时间 `t`，每个就绪任务的 `waiting = t - release`，计算：

```text
score = duration - 1 × waiting
选择 score 最小的任务；平分按 release、id 排序
```

权重固定为 **1**，与 `waiting-weighted-v1` 绑定；本次没有权重扫描、自动调参或可变权重 CLI。固定参数写入 raw，手工改为其他权重、遗漏字段或改版本都会被汇总器拒绝。这避免运行实际使用一个权重、数据却记录另一个权重。不同权重的实验需要另行定义并版本化，不能只改归档 JSON。

score 越低越优；较长的任务可以凭借较早到达而领先于新到达的短任务。内部以 BigInt 计算并比较整数 score，输出仍采用现有 JSON 数字及任务 ID，没有浮点打分误差。reward 仍为实际等待的负值，不是 score 的负值。

这里有一个重要限制：`duration - (t - release) = duration + release - t`。在同一次决策里 `-t` 是共同项，因此两个已经就绪的任务不会仅因一起多等了一段时间而改变相对顺序。它是带等待差异的线性贪心排序，不能声称提供动态优先级反转、等待上限或无饥饿保证。本项目只模拟有限任务集合，所有任务最终都会被执行；这也不证明无限到达流的性质，本文没有声称观测到无限饥饿。同时到达的任务拥有相同等待，顺序与 SJF 完全一致。

## 手算改善与退化

### 公平性改善伴随总等待退化

沿用 `examples/fairness-tradeoff.json`，每种策略都执行同样的六个任务：

| 策略 | 顺序 | 总等待 | 平均等待 | 最大等待 | long 的等待 |
| --- | --- | ---: | ---: | ---: | ---: |
| FIFO | A, long, short-1, short-2, short-3, short-4 | 22 | 22/6 | 5 | 2 |
| SJF | A, short-1, short-2, short-3, short-4, long | 14 | 14/6 | 6 | 6 |
| waiting-weighted | A, short-1, short-2, long, short-3, short-4 | 18 | 3 | 5 | 4 |

加权策略的完整时间线：

| 任务 | start–finish | waiting | turnaround |
| --- | --- | ---: | ---: |
| A | 0–3 | 0 | 3 |
| short-1 | 3–4 | 2 | 3 |
| short-2 | 4–5 | 2 | 3 |
| long | 5–8 | 4 | 7 |
| short-3 | 8–9 | 5 | 6 |
| short-4 | 9–10 | 5 | 6 |

在 `t=5`，long 的 score 为 `3 - (5-1) = -1`，short-3 的 score 为 `1 - (5-3) = -1`，平局选择更早到达的 long。加权策略比 FIFO 少 4 个等待 tick；相对 SJF，最坏等待由 6 降到 5，但总等待由 14 升到 18。short-3、short-4 各自从等待 2 增到 5，不能说每个任务都受益。

### 总等待退化且没有最坏等待收益

`examples/waiting-weighted-regression.json` 专门保留反例：

| 任务 | release | duration |
| --- | ---: | ---: |
| block | 0 | 5 |
| old-long | 1 | 4 |
| new-short | 4 | 1 |

`block` 都在 0–5 执行。在 `t=5`，old-long 和 new-short 的 score 都是 0，加权策略按更早 release 选择 old-long：

| 策略 | 后续时间线 | 各任务等待（block, old-long, new-short） | 总等待 | 最大等待 |
| --- | --- | --- | ---: | ---: |
| FIFO / waiting-weighted | old-long 5–9, new-short 9–10 | 0, 4, 5 | 9 | 5 |
| SJF | new-short 5–6, old-long 6–10 | 0, 5, 1 | 6 | 5 |

相对 SJF，加权策略的平均等待从 2 升至 3，而最坏等待没有改善。两个场景都在测试中按完整时间线核验，不以较好案例掩盖反例。

## 配对实验与复现

```sh
node src/cli.mjs examples/fairness-tradeoff.json --policy waiting-weighted
node src/cli.mjs examples/waiting-weighted-regression.json --policy waiting-weighted
mkdir -p experiments/local
node src/batch.mjs examples/experiments/policies.json > experiments/local/policies.raw.json
node src/summarize.mjs experiments/local/policies.raw.json > experiments/local/policies.summary.json
cmp examples/experiments/policies.raw.json experiments/local/policies.raw.json
cmp examples/experiments/policies.summary.json experiments/local/policies.summary.json
```

`policies.json` 包含原六个基准输入和上面的三任务反例；每个输入各运行全部三种策略，共 **7 个输入、21 条运行，每策略 60 个任务**。同一批次中的输入及 seed 完全相同；增加反例后的聚合不能直接与旧六输入批次相比。

| 策略 | 总等待 | 任务加权平均等待 | 最大等待 | 总 turnaround |
| --- | ---: | ---: | ---: | ---: |
| FIFO | 438 | 438/60 = 7.3 | 33 | 642 |
| SJF | 331 | 331/60 ≈ 5.5167 | 36 | 535 |
| waiting-weighted | 393 | 393/60 = 6.55 | 33 | 597 |

三者总 makespan 都为 359、busy 为 204、idle 为 155，pooled utilization 为 `204/359`。这些有意保留的有限 fixtures 只支持此批次的结论，不提供生产适用性、统计显著性或全局最优的证明。

原 `baselines.json` 仍是六输入 × FIFO/SJF，没有改变输入或历史指标。本次只因策略/实验模块源码变化而再生成其 source hash 和关联 raw hash；七输入三策略数据独立保存于 `policies.raw.json` 和 `policies.summary.json`。完整数据协议见 [EXPERIMENTS.md](EXPERIMENTS.md)。

## 以后如何增加策略

1. 在 `src/policies.mjs` 写纯选择函数，并注册名称、明确语义版本、完整固定参数，不能仅靠函数名猜测版本
2. 证明有效观察只产生合法 ready 动作；测试终止/空 ready、平局、Unicode、输入冻结/顺序重排、独立调用与支持域数值边界
3. 给出独立参考排序或手算时间线，并提供改善与退化案例。若依赖已知 duration、未来信息或状态，必须明确披露并重新定义相应契约
4. CLI 的帮助/查找自动使用注册表；仍须补运行器、CLI、批实验、归档参数篡改和重算测试，不能只增加一个函数
5. 对现有名称更改行为时更新版本并设计归档兼容验证；不认识的旧/新版本必须明确拒绝，不能用新选择函数静默解释旧结果。新增名称不改变本次 `scheduler-experiment-v1` 数据结构，旧 reader 遇到新名称会拒绝，当前 reader 仍能核验旧 FIFO/SJF 归档
6. 在同输入 manifest 上比较，更新文档、固定 raw/summary 和 Node.js 22/24 的字节级重跑检查。只有通过验收的真实改动才能发布
