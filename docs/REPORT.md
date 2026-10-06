# 七日调度实验与交付报告

记录日期：2026-10-06（UTC）。范围为 2026-09-30 至 2026-10-06 的 Day 1–7 实际工程增量。本文面向需要理解结果、检查证据并复跑项目的读者。

## 结论

项目已形成零第三方依赖的确定性单 worker 非抢占仿真器、三种共享策略、固定 seed 生成器、可核验批实验及回归套件。在同一七输入批次中，FIFO、SJF、waiting-weighted 的总等待分别为 **438、331、393**，最坏等待为 **33、36、33**。SJF 的平均等待更低，但最坏等待更高；等待加权策略在这些输入上做出了另一种权衡，不能保证每个任务受益。

Day 7 增加一条命令的交付复现检查、源文件独立目录验证和本报告，不修改调度实现、策略语义或已有实验归档。结果是有限 fixtures 的确定性比较，不是训练成果、统计显著性结论或生产性能评估。发布状态须核对本文所在提交及同一 SHA 的 CI；文末区分已核实的历史发布与本次提交前验收。

## 实验方法和证据

### 共同设置

- 引擎为 `single-worker-nonpreemptive-v1`：一个 worker、非抢占、整数 tick；无就绪任务时自动推进到下一次 release，不为未来任务主动空闲
- 三种策略对同一个输入各运行一次；duration 是预先已知的完整执行时长。FIFO 按 `(release,id)`，SJF 按 `(duration,release,id)`，waiting-weighted 按 `(duration-(time-release),release,id)` 选择，ID 平局采用 Unicode 代码点顺序
- 策略版本分别为 `fifo-v1`、`sjf-v1`、`waiting-weighted-v1`；加权参数固定为 `waitingWeight=1`，没有训练、调参或选 seed 搜优
- 每个任务的 waiting 为 `start-release`，turnaround 为 `finish-release`，累计 reward 等于负总等待。平均等待以任务数加权，最坏等待为所有已完成任务 waiting 的最大值；本报告使用完整 episode
- 各 episode 的 makespan 分别从 tick 0 计算，包含初始 idle；汇总将它们求和，不拼接 episode。pooled utilization 为总 busy/总 makespan。小数展示做舍入，原始整数和分数才是精确依据

完整定义与校验约定见 [EXPERIMENTS.md](EXPERIMENTS.md)；手算时间线与反例见 [BASELINES.md](BASELINES.md)、[POLICIES.md](POLICIES.md)。

### 输入和归档

主比较使用 [policies.json](../examples/experiments/policies.json)，共 7 输入、21 条运行、每策略 60 个任务。三个手写输入为 policy-comparison（3 任务）、fairness-tradeoff（6 任务）、waiting-weighted-regression（3 任务）。四个生成输入各 12 任务，均使用 `lcg32-workload-v1`、seed `20261002`、duration 区间 `[2,6]`，其余参数如下：

| 输入 | initialRelease | arrivalGap | burstSize | burstGap |
| --- | ---: | --- | ---: | ---: |
| low-load | 0 | [8,12] | 1 | 0 |
| high-load | 0 | [0,1] | 1 | 0 |
| bursty | 0 | [0,0] | 4 | 8 |
| idle-gaps | 5 | [1,2] | 3 | 30 |

配置在 [examples/generator](../examples/generator)，可重放输入在 [examples/generated](../examples/generated)。burstGap 是生成参数，实际 idle 仍由任务执行决定。

- [policies.raw.json](../examples/experiments/policies.raw.json)：完整规范化 inputs、seed/参数、输入哈希、九个源码文件哈希、配置/版本、每次 schedule 和 metrics
- [policies.summary.json](../examples/experiments/policies.summary.json)：经 raw 时间线核验后重新汇总；canonical raw SHA-256 为 `d35a5e4eec1e7977e93bc60ddec732a7eda20f280d0b3cd6bb78e201067c867d`
- [baselines.raw.json](../examples/experiments/baselines.raw.json) 与 [baselines.summary.json](../examples/experiments/baselines.summary.json)：保留原六输入 × FIFO/SJF 批次；canonical raw SHA-256 为 `4aa936b838db88dea601290f3903bb6e167b3f48c820a31980cefe1db685b920`

这里的 raw 哈希按协议规范化 JSON 后计算，不等于带缩进的文件字节哈希。主比较的每项数据可用 raw 中 `runs[].inputId` 与 `runs[].policy` 定位，任务级依据在对应 `schedule[]`。汇总数据位于 summary 的 `policies[]`。四个生成场景共用一个 seed，改变参数不构成四个独立随机样本；重复运行也不是新增独立样本。

## 主比较结果

### 每个输入的等待权衡

表中单元格为“总等待 / 最大等待”，单位为仿真 tick。

| raw inputId | 任务数 | FIFO | SJF | waiting-weighted |
| --- | ---: | ---: | ---: | ---: |
| policy-comparison | 3 | 11 / 6 | 4 / 3 | 4 / 3 |
| fairness-tradeoff | 6 | 22 / 5 | 14 / 6 | 18 / 5 |
| low-load | 12 | 0 / 0 | 0 / 0 | 0 / 0 |
| high-load | 12 | 214 / 33 | 167 / 36 | 201 / 33 |
| bursty | 12 | 157 / 25 | 119 / 30 | 140 / 23 |
| idle-gaps | 12 | 25 / 6 | 21 / 6 | 21 / 6 |
| waiting-weighted-regression | 3 | 9 / 5 | 6 / 5 | 9 / 5 |

按上述行顺序，三种策略的 makespan/busy/idle 均分别为 `8/8/0`、`10/10/0`、`122/44/78`、`44/44/0`、`44/44/0`、`121/44/77`、`10/10/0`。这些样本中的等待差异来自任务顺序，不是处理了不同数量的任务或引入额外 idle。

### 七输入配对汇总

| 策略 | 总等待 | 任务加权平均等待 | 最坏等待 | 总 turnaround |
| --- | ---: | ---: | ---: | ---: |
| FIFO | 438 | 438/60 = 7.3 | 33 | 642 |
| SJF | 331 | 331/60 ≈ 5.5167 | 36 | 535 |
| waiting-weighted | 393 | 393/60 = 6.55 | 33 | 597 |

每策略总 makespan 359、busy 204、idle 155，pooled utilization 为 `204/359 ≈ 0.568245`。

- SJF 相对 FIFO 总等待减少 107 tick，`107/438 ≈ 24.43%`，但最坏等待从 33 增至 36
- 加权策略相对 FIFO 总等待减少 45 tick，`45/438 ≈ 10.27%`，最坏等待仍为 33；bursty 输入同时改善总等待（157→140）和最大等待（25→23）
- 加权策略相对 SJF 总等待增加 62 tick，`62/331 ≈ 18.73%`，最坏等待从 36 降到 33；这是本批次的聚合权衡，不代表逐任务改善
- fairness-tradeoff 中 long 的等待从 SJF 的 6 降至加权策略的 4，但 short-3 和 short-4 各自从 2 增至 5
- waiting-weighted-regression 反例中，加权策略比 SJF 多 3 tick 总等待（6→9），最大等待仍为 5，说明加权也可能只付出代价而没有最坏等待收益

原六输入基准每策略 57 个任务，FIFO/SJF 总等待为 429/325、最坏等待为 33/36，总 makespan/busy/idle 为 349/194/155。这一批次不含加权反例，不能与七输入汇总直接混比。两份 raw 的 33 条记录包含重叠输入和策略，不能称为 33 个独立样本。

## 可复现性和交付验收

在完整源文件目录且 Node.js 22+ 已安装时：

```sh
npm test
npm run demo
npm run reproduce
```

无需 `npm install`。`npm run reproduce` 会再生成四个生成输入、各重复运行两个批次、从新 raw 重算两份 summary，与归档逐字节比较；再将 33 条单次调度 CLI 的完整 schedule/metrics 与批实验配对核验，并检查 tiny 的手算指标。它不依赖 `.git`、第三方包或原工作区输出，仅在新临时目录写中间 raw，正常完成或报错均清理该目录。失败时返回非零退出码，不打印部分成功报告。

本次新增的七项测试覆盖源文件独立目录（含空格路径、不同 cwd）、重复运行不改项目文件、帮助/非法参数、生成/raw/summary 字节变化、缺失输入和独立 CLI 漂移。原有测试继续覆盖内核、策略、PRNG、输入重放、批次核验和回归；计数不等于覆盖率或数学证明。

Day 6 的独立 BigInt 参考包含 7,381 个小域输入 × 三策略、128 个固定 seed 配置 × 三策略、逐步状态/reward/指标、非法动作/reset/陈旧快照隔离，以及等待队列时间积分。测试参考不复用生产排序/策略/内核；生产 summarize 只对时间线和指标算术独立，策略校验仍共享生产选择函数。这两种“独立性”不可混淆，完整范围见 [REGRESSION.md](REGRESSION.md)。

源文件归档提取、空 HOME/npm cache、npm offline 模式下的完整验收步骤与实际结果见 [REPRODUCTION.md](REPRODUCTION.md)。npm offline 是工具配置，不是操作系统断网；本次没有网络命名空间、拦截抓包或防火墙隔离证据，不声称已经验证强制断网运行。获得源码、安装 Node.js 和 GitHub CI 的 checkout/setup-node 可能需要网络，不属于本地实验复跑。

## 七日实际增量和发布证据

日期按 UTC；Day 1 的 Git 原始时区为 −07:00，本地日期可显示为前一天。下表列功能提交，不把初始化提交算作一天的工程增量。Day 1–6 的远程提交及各自 Node.js 22/24 作业在 2026-10-06 重新读取，均为 completed/success。

| 阶段与 UTC 日期 | 实际增量 | 功能提交 | 相同 SHA 的 CI |
| --- | --- | --- | --- |
| Day 1 · 2026-09-30 | 确定性内核、FIFO CLI、校验和基础测试 | [322024f](https://github.com/a123i/reproducible-scheduler-lab/commit/322024f178a0dc3b210a5a1c964e5c4cb1d1e53f) | [36672008333](https://github.com/a123i/reproducible-scheduler-lab/actions/runs/36672008333) |
| Day 2 · 2026-10-01 | 共享策略、SJF、公平性指标和手算对照 | [c1e9e20](https://github.com/a123i/reproducible-scheduler-lab/commit/c1e9e206c66113988b1aa4c2e37f396e77138949) | [36837025245](https://github.com/a123i/reproducible-scheduler-lab/actions/runs/36837025245) |
| Day 3 · 2026-10-02 | 固定 seed 生成、版本/参数重放、四种场景 | [7434c10](https://github.com/a123i/reproducible-scheduler-lab/commit/7434c1018242f84cd19cd93e53ca3e1be4b3fd25) | [36984292139](https://github.com/a123i/reproducible-scheduler-lab/actions/runs/36984292139) |
| Day 4 · 2026-10-03 | 自包含批实验、溯源哈希和可核验汇总 | [ed21088](https://github.com/a123i/reproducible-scheduler-lab/commit/ed21088f7694c47c2886d75cd68275e19656617d) | [37111925060](https://github.com/a123i/reproducible-scheduler-lab/actions/runs/37111925060) |
| Day 5 · 2026-10-04 | 固定等待权重策略、契约、改善/退化配对实验 | [bea7251](https://github.com/a123i/reproducible-scheduler-lab/commit/bea725133e0b5fff897437158619c236a5c4f631) | [37189442649](https://github.com/a123i/reproducible-scheduler-lab/actions/runs/37189442649) |
| Day 6 · 2026-10-05 | 独立 BigInt 参考、前缀/边界/指标回归 | [b2c1879](https://github.com/a123i/reproducible-scheduler-lab/commit/b2c1879c6d1c77c6f5b5369311c76872458f6730) | [37287120288](https://github.com/a123i/reproducible-scheduler-lab/actions/runs/37287120288) |
| Day 7 · 2026-10-06 | 最终报告、一键复现、干净源文件目录交付验证 | 本报告首次加入的提交，见[文件历史](https://github.com/a123i/reproducible-scheduler-lab/commits/main/docs/REPORT.md) | 提交前尚未运行，须按该 SHA 查[CI 历史](https://github.com/a123i/reproducible-scheduler-lab/actions/workflows/ci.yml) |

本报告随 Day 7 功能提交发布，无法在提交自身内容里预先记录自身 SHA 或未来 CI 结果；因此这里明确保留提交前状态。交付时应另行核实远程 `main`、本地相同 commit/tree 及其终态 CI。已有阶段的“尚未发布”交接文字是当时的历史快照，实际发布以本表和对应远程记录为准。

每日历史测试记录为 58、76、121、148、163、177 项（源自 [HANDOFF.md](HANDOFF.md)），每个阶段都有可运行增量；初始提交不计入这六项。Day 7 的实际验收另记于交接。没有可靠计时记录，因此不填写工作小时；提交日期和数量也不能证明工时、外部资格或任何平台评审结论。发布使用已授权 GitHub tree/commit/ref 接口做非强制快进，不把它描述为 shell `git push`，不创建或提取 shell 凭据。

## 限制和未实现工作

1. 仅支持有限任务、单 worker、非抢占、已知 duration；没有多 worker、依赖图、抢占、在线未知时长、训练或真实服务接入
2. 有意挑选的小样本不能代表生产流量；LCG 只用于固定回归，不提供统计独立性。没有置信区间、显著性检验、墙钟性能基准或全局最优结论
3. 加权 score 等价于 `duration+release-time`，已就绪任务共同等待不会改变相对顺序；固定权重 1 没有等待上界、动态优先级反转或无限到达流的无饥饿保证
4. 保守安全整数域与批次聚合上界会拒绝部分可能可运行的输入；均值和比例为普通浮点值。taskCount 上限 10,000，不等于已完成大规模性能验收
5. 小域穷举和独立参考仍可能共同误读规格，不是形式化证明；带任意副作用的 Proxy/getter 不属于 JSON 输入边界。哈希不是来源认证，汇总器也不会强制旧归档源码哈希等于本机源码
6. 本次干净目录检查证明不需要项目 Git 元数据、安装依赖或 npm 已有缓存；没有强制网络隔离测试，也未在 Windows/macOS 本机实测。CI 平台是 Ubuntu 的 Node.js 22/24

以上是交付边界，不是已承诺继续执行的新阶段。如以后扩展，应先明确新的需求、策略/数据版本和验收条件；本次七日范围到 Day 7 交付结束。
