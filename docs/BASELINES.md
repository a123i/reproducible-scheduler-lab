# FIFO/SJF 手算基准与公平性

本页对应 Day 2 实现，所有时间均为整数仿真时间。单 worker、非抢占、无调度开销；仅在没有就绪任务时自动 idle。SJF 使用 workload 提供的已知 duration，不进行时长预测。

## 确定性约定

- FIFO：在 ready 中取 `(release, id)` 最小的任务
- SJF：在 ready 中取 `(duration, release, id)` 最小的任务
- ID 按 Unicode 代码点逐个比较；共同前缀相同时较短字符串在前，不使用 locale 或 UTF-16 码元排序
- 两策略与环境共用 ID/release 比较逻辑。策略不修改观察，不受 ready 数组顺序影响，不为尚未释放的短任务主动空闲
- 每次任务完成、下一次选取前会纳入 `release <= time` 的所有未完成任务；运行中到达的任务不能抢占当前任务

## 指标定义

每个完成任务有 `waiting = start - release`、`turnaround = finish - release`。单步 reward 是负 waiting（零等待返回正零）。

- `totalWaiting` / `meanWaiting`：已完成任务的等待总和 / 平均值
- `maxWaiting`：已完成任务的最大等待；尚无完成任务时为 0
- 每任务等待：`schedule[].waiting`（运行中为 `observation.completed[].waiting`）
- `totalTurnaround` / `meanTurnaround`：已完成任务的周转总和 / 平均值
- `busyTime`：已完成任务 duration 总和；`makespan`：当前时间，含自动推进的 idle
- `idleTime = makespan - busyTime`，`utilization = busyTime / makespan`（makespan 为 0 时为 0）

中途的 maxWaiting 不统计尚在排队的任务。终止时它才是整个 workload 的最大等待。`getMetrics()` 返回独立快照；reset 会清除统计。平均值为浮点数，整数界限遵循 README 中的保守支持域。

## Fixture 1：同时到达，改变执行顺序

输入：[policy-comparison.json](../examples/policy-comparison.json)。A/B/C 均在 0 到达，duration 分别为 5/1/2。

| 策略 | 执行区间与顺序 | 按执行顺序的等待 | 总等待 | 平均等待 | 最大等待 | 总 turnaround |
| --- | --- | --- | --- | --- | --- | --- |
| FIFO | A 0–5；B 5–6；C 6–8 | 0, 5, 6 | 11 | 11/3 | 6 | 19 |
| SJF | B 0–1；C 1–3；A 3–8 | 0, 1, 3 | 4 | 4/3 | 3 | 12 |

两者 completedTasks = 3、makespan = busyTime = 8、idleTime = 0、utilization = 1。累计 reward 分别为 -11 和 -4。

## Fixture 2：平均等待下降，最坏等待上升

输入：[fairness-tradeoff.json](../examples/fairness-tradeoff.json)。A 在 0 到达、duration 3；long 在 1 到达、duration 3；short-1 至 short-4 分别在 1/2/3/4 到达、duration 均为 1。

A 是初始唯一就绪任务，所以两个策略都运行 A 0–3。之后 FIFO 先执行 long；SJF 先清空连续就绪的短任务。

| 任务 | release | duration | FIFO 区间 | FIFO 等待 | SJF 区间 | SJF 等待 |
| --- | --- | --- | --- | --- | --- | --- |
| A | 0 | 3 | 0–3 | 0 | 0–3 | 0 |
| long | 1 | 3 | 3–6 | 2 | 7–10 | 6 |
| short-1 | 1 | 1 | 6–7 | 5 | 3–4 | 2 |
| short-2 | 2 | 1 | 7–8 | 5 | 4–5 | 2 |
| short-3 | 3 | 1 | 8–9 | 5 | 5–6 | 2 |
| short-4 | 4 | 1 | 9–10 | 5 | 6–7 | 2 |

FIFO：总等待 `0 + 2 + 4 × 5 = 22`，平均 `22/6`，最大 **5**；总 turnaround 为 `22 + 10 = 32`。

SJF：总等待 `0 + 6 + 4 × 2 = 14`，平均 `14/6`，最大 **6**；总 turnaround 为 `14 + 10 = 24`。

两者 completedTasks = 6、makespan = busyTime = 10、idleTime = 0、utilization = 1。累计 reward 分别为 -22 和 -14。

长任务被推迟，平均等待却改善；必须同时查看每任务和最坏等待。这个有限 fixture 展示等待权衡，并不证明无限饥饿或普适最优。本项目现阶段没有源源不断到达的无限流、抢占、多个 worker、调度开销、预测误差或老化机制。

## 重跑与验收

```sh
npm test
node src/cli.mjs examples/policy-comparison.json --policy fifo
node src/cli.mjs examples/policy-comparison.json --policy sjf
node src/cli.mjs examples/fairness-tradeoff.json --policy fifo
node src/cli.mjs examples/fairness-tradeoff.json --policy sjf
```

`test/run.test.mjs` 独立写出两组手算 transition 与聚合期望，不从运行器结果生成期望。策略测试核验 Unicode tie-break、release tie-break、不修改冻结观察、ready 顺序无关、终止约定和非抢占。CLI 测试覆盖 SJF 选择、重复输出、空输入、idle 与安全错误输出；内核测试覆盖 maxWaiting 的完成任务语义、历史最大值与 reset/快照隔离。
