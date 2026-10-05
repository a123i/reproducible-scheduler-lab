# 开发交接记录

## Day 1 验收快照

- 记录日期：2026-09-30（UTC），首日功能发布前
- 已完成：确定性单 worker、非抢占调度内核，FIFO CLI，输入校验，最小示例，测试和使用文档
- 技术栈：Node.js ESM 和内置测试工具，无第三方运行或测试依赖；最低 Node.js 22
- 云端验收环境：Node.js 24.19.0、npm 11.9.0、Git 2.52.0
- 发布目标：[a123i/reproducible-scheduler-lab](https://github.com/a123i/reproducible-scheduler-lab)。公开内容仅包含本项目代码、测试、示例、CI 配置与文档
- 初始提交：`d4f585193e06f859728bfa4164f4256c3e322ce5`。首日改动保留这一历史，不重写远程分支
- 内核已包含安全整数时间和聚合保护、稀疏数组拒绝、合法 Unicode ID 校验，以及状态隔离回归覆盖
- CI 已配置 Node.js 22/24；本地通过不等于远程 CI 通过。远程发布与 CI 在本记录完成时尚未核验
- 未计时，不填写工时；未来日期和阶段均属于计划，不能视为已执行

本文件是提交前的验收记录，不是持续刷新的远程状态。发布是否成功以 [main 提交历史](https://github.com/a123i/reproducible-scheduler-lab/commits/main/) 和 [CI 运行记录](https://github.com/a123i/reproducible-scheduler-lab/actions/workflows/ci.yml) 中对应的同一 SHA 为准。

## 云端实际验收

| 项目 | 实际执行与结果 |
| --- | --- |
| 完整测试 | `npm test`：58 项通过，0 失败，0 skipped，退出码 0 |
| 示例运行 | `npm run demo`：退出码 0；makespan 9、totalWaiting 2、totalTurnaround 8、busyTime 6、idleTime 3 |
| JavaScript 语法 | 对 `src/*.mjs` 和 `test/*.mjs` 逐一执行 `node --check`，全部通过 |
| 确定性和状态隔离 | 完整测试已覆盖重复运行、reset、输入/观察/transition 防外部修改及指标快照 |
| 边界与错误处理 | 完整测试已覆盖空输入、非法动作、非法 JSON、Unicode 排序、安全整数及聚合边界 |
| 格式检查 | `git diff --check` 通过 |
| 公开发布前修复 | 校验错误使用任务序号，避免恶意 ID 向终端注入控制序列；CLI 回归测试覆盖重复 ID、非法 release 和 duration |
| 发布状态 | 本记录完成时功能提交尚未发布；发布后应核对远程 SHA 和相同 SHA 的 Node.js 22/24 CI |

CLI 输出 schedule 和 metrics；reward 通过 JavaScript API 返回并由内核测试核验。平均值和 utilization 使用浮点数，精度限制与保守支持域见 README。

CI 的官方 checkout/setup-node v7 操作已锁定到已核验的完整提交 SHA；应用自身运行不需要下载依赖。

## 恢复与发布核验

1. 阅读 README 和本记录；检查当前分支、工作区状态及远程 `main`，不要覆盖其他人的改动
2. 如果首日功能尚未发布，先运行 `npm test`、`npm run demo` 和语法检查，修复实际失败，再发布真实改动
3. 仅向上述授权仓库发布项目产物。发布可以使用正常 Git push 或已授权的 GitHub 提交接口；记录实际使用方式，不把接口提交写成命令行 push
4. 发布后读取远程 `main` SHA，核对该提交的文件内容和 Node.js 22/24 CI。查看 `git log`、`git ls-remote origin refs/heads/main` 或 GitHub 查询结果；CI 失败时修复并重新核验，未执行时如实记录
5. 首日实际发布和验收完成后，在下一次日执行中按 [ROADMAP.md](ROADMAP.md) 继续 Day 2：共享策略接口、SJF、可区分策略的手算 fixture，以及最大等待等公平性指标

以上为 Day 1 发布前的历史快照；后续状态见下方实际记录。不得通过空提交、回填日期、虚构工时或无意义文件改动满足每日计划。

## 后续实际工作记录模板

每次执行后追加实际结果，保留失败和未完成项；发布前记录与发布后核验分开表述。

```text
实际日期/时区：
执行阶段：
完成的行为与对应文件：
实际验收命令与运行环境：
结果与失败原因：
实际计时（仅有计时证据时填写；否则写未计时）：
功能 commit SHA（未提交则说明）：
发布方式、远程分支与 SHA（未发布则说明）：
同一 SHA 的 CI 状态与链接（未运行则说明）：
未解决问题：
下一次第一步：
```

## Day 2 验收快照

- 实际日期/时区：2026-10-01（UTC），Day 2 功能发布前
- 恢复检查：从公开仓库读取并克隆 `main`，起点为 Day 1 `322024f178a0dc3b210a5a1c964e5c4cb1d1e53f`，工作区干净；没有发现仓库级 AGENTS.md 或本地技能要求
- Day 1 发布核验：上述 SHA 已在远程 `main`；[CI run 36672008333](https://github.com/a123i/reproducible-scheduler-lab/actions/runs/36672008333) 为 completed/success（本次读取核实）
- 完成的行为：抽出 `src/order.mjs` 公共 tie-break；`src/policies.mjs` 提供统一观察到动作的 FIFO/SJF 接口；`src/run.mjs` 与 CLI 共用整集运行；环境增加 `getMetrics()` 和 `maxWaiting`
- 每任务等待继续使用既有 `schedule[].waiting`，文档明确中途统计仅含已完成任务；新增聚合字段不会改变旧指标值与默认 FIFO 行为
- 新增 `examples/policy-comparison.json`、`examples/fairness-tradeoff.json` 和 [BASELINES.md](BASELINES.md)，对照手算时间线；公平性例子中总等待从 22 降至 14，最大等待从 5 升至 6
- 新增策略/运行器测试，补充 CLI 与环境回归；CI 增加 SJF 公平性示例 smoke 命令，保留 Node.js 22/24 矩阵
- 实际环境：Node.js 24.19.0、npm 11.9.0；运行不需要第三方包或联网。npm 在本环境提示已有 http-proxy 环境配置的弃用警告，不影响命令退出状态
- 未计时，不填写工时

| 项目 | 实际执行与结果 |
| --- | --- |
| 完整测试 | `npm test`：76 项通过，0 失败，0 skipped，退出码 0 |
| 原有示例 | `npm run demo` 与 `node src/cli.mjs examples/tiny.json --policy sjf` 均成功；makespan 9、totalWaiting 2、maxWaiting 2、busyTime 6、idleTime 3 |
| 策略比较 | 两个新增 fixture 各运行 FIFO/SJF CLI，4 条命令均退出码 0；时间线和指标符合 BASELINES 手算 |
| JavaScript 语法 | `src/*.mjs` 与 `test/*.mjs` 逐个 `node --check`，全部通过 |
| 确定性及隔离 | 测试覆盖重复运行、反转输入、无序 ready、冻结观察、reset 与指标快照；Unicode 和 release tie-break 均有回归 |
| 独立复核 | 未发现阻塞缺陷；复跑完整测试、语法、demo 与全部比较命令通过；另以独立仿真器核验 45,242 个策略结果及 22,621 个 Day 1 FIFO 兼容结果 |
| 格式检查 | `git diff --check` 通过 |
| 功能 commit / 发布 | 本快照为提交前记录，Day 2 SHA 尚未生成；计划使用已授权 GitHub tree/commit/ref 接口做非强制快进发布，不将其称为 shell push |
| 同一 SHA CI | Day 2 尚未发布，因此未运行；发布后核对远程同一 SHA 的 Node.js 22/24 检查 |

当前未解决功能阻塞：无。Day 3–Day 7 尚未实现；没有训练、批实验或固定 seed 生成器。SJF 使用已知时长，只比较有限 workload，不保证全部到达模式下最优或最公平。

下一次第一步：检查远程 `main` 和 CI，核验 Day 2 实际 SHA 与两个 Node.js 作业；如已成功，再按 ROADMAP 的 Day 3 实现固定 seed 生成器、参数记录、不同负载/突发/空闲 fixtures 与可复现性测试。若发布失败则保留真实失败状态，先恢复本阶段发布，不能重复制造同一增量或空提交。

## Day 3 验收快照

- 实际日期/时区：2026-10-02（UTC），Day 3 功能发布前；前面的 Day 1/2 记录保留为历史快照
- 恢复检查：云端既有 checkout 的 `main` 与公开远程一致，起点为 `c1e9e206c66113988b1aa4c2e37f396e77138949`，工作区干净；没有仓库级 AGENTS.md 或附加技能文件
- Day 2 发布核验：远程提交历史已确认上述 SHA；[CI run 36837025245](https://github.com/a123i/reproducible-scheduler-lab/actions/runs/36837025245) 为 completed/success，`test (22)` 与 `test (24)` 均成功。本次修改前重跑 76 项测试全部通过
- 完成的行为：`src/random.mjs` 提供局部状态、显式 uint32 seed、整数高位分桶和拒绝采样；`src/workload.mjs` 提供完整参数校验、最坏情况 BigInt 安全界、生成与版本化元数据重放；`src/generate.mjs` 提供独立 JSON 配置到 stdout 的 CLI
- 生成输出保留 `lcg32-workload-v1`、seed、全部规范化参数和稳定 ID；不引入时间戳、随机 UUID、第三方依赖或联网要求；既有手写输入与调度 CLI 保持兼容
- 四组固定配置和生成输入位于 `examples/generator/`、`examples/generated/`：low-load、high-load、bursty、idle-gaps，均可直接通过 FIFO/SJF CLI 运行
- 新增 PRNG/生成器/CLI 测试与 [WORKLOADS.md](WORKLOADS.md)；更新 README、路线图及 CI 的字节级再生成 smoke 检查
- 实际云端环境：Node.js 24.19.0、npm 11.9.0；npm 提示已有 http-proxy 环境配置的弃用警告，不影响退出状态。本地没有单独运行 Node.js 22，以发布后对应 SHA 的 CI 为准
- 未计时，不填写工时

| 项目 | 实际执行与结果 |
| --- | --- |
| 完整测试 | `npm test`：121 项通过，0 失败，0 skipped，退出码 0 |
| 兼容示例 | `npm run demo` 成功，既有 tiny 的 makespan 9、totalWaiting 2、maxWaiting 2、busyTime 6、idleTime 3 保持不变 |
| 四组生成 | 对四个配置分别运行 `node src/generate.mjs`，用 `cmp` 核验与已提交 fixture 字节一致，全部成功 |
| 八组调度 | 四个生成输入各执行 FIFO/SJF CLI，8 条命令均退出码 0；指标符合 WORKLOADS 固定样本表 |
| JavaScript 语法 | 对所有 `src/*.mjs`、`test/*.mjs` 执行 `node --check`，全部通过 |
| 确定性与边界 | 固定 PRNG 向量、BigInt 参考递推、拒绝采样、完整元数据重放、默认参数、空任务、最大计数、非法参数和安全整数边界均有覆盖；100 个 seed 的混合参数集核验两种策略的任务唯一完成、时间和指标不变量 |
| 独立复核 | 独立重跑 121 项测试通过；另以 BigInt 参考实现核验 800000 次区间取样、10000 组完整生成结果及 1728 组极端参数域校验，均通过，未发现阻塞缺陷 |
| 格式检查 | `git diff --check` 通过 |
| 功能 commit / 发布 | 本快照为提交前记录，Day 3 SHA 尚未生成；使用已授权 GitHub tree/commit/ref 接口做非强制快进发布，不将其称为 shell push |
| 同一 SHA CI | 本快照完成时 Day 3 尚未发布，因此其 CI 未运行；发布后须核对远程相同 SHA 的 Node.js 22/24 检查 |

当前未解决功能阻塞：无。已知限制：LCG 面向固定 fixtures，不保证统计独立性或生产流量代表性；不同 seed 不保证有限样本都不同；burstGap 不是实际 idle 的保证；taskCount 最大 10000，现有环境并未针对大规模性能优化。元数据只描述生成过程，手改 tasks 后不自动校验其来源。完整批实验封装、加权策略与报告仍未实现。

下一次第一步：核验 Day 3 远程 `main` SHA 和 Node.js 22/24 CI；成功后按 ROADMAP Day 4 实现固定输入批比较、逐次原始 JSON 与可重算汇总，保留输入、seed、参数、策略与版本信息。若发布失败先恢复本阶段发布；不要重做 Day 3 或制造空提交。

## Day 4 验收快照

- 实际日期/时区：2026-10-03（UTC），Day 4 功能发布前；之前的 Day 1–3 记录保留为历史快照
- 恢复检查：云端 checkout 干净，`main` 起点为 `7434c1018242f84cd19cd93e53ca3e1be4b3fd25`，与远程分支及公开 fetch 结果一致；没有仓库级 AGENTS.md 或附加技能要求，未覆盖他人的改动
- Day 3 发布核验：上述 SHA 的 [CI run 36984292139](https://github.com/a123i/reproducible-scheduler-lab/actions/runs/36984292139) 为 completed/success，`test (22)` 与 `test (24)` 均成功；修改前在本地重跑 121 项测试全部通过
- 完成的行为：`src/experiment.mjs` 提供 `runExperiment` 和 `summarizeExperiment`；`src/batch.mjs` 读取固定 manifest 并输出自包含 raw JSON；`src/summarize.mjs` 仅从 raw 独立核验时间线/指标，再输出任务及时间加权汇总
- 原始数据保存规范化完整输入、已重放核验的 seed/参数、输入内容哈希、九个已知项目源码的字节哈希、引擎/策略版本、配置、指标定义、完整 schedule 和 metrics；无时钟、主机信息、环境变量或绝对输入路径
- 校验覆盖每个输入/策略组合恰好一次、任务唯一完成、合法策略动作、无额外 idle、准确的 duration/waiting/turnaround、原始指标一致性和批次 BigInt 聚合安全界；未知版本或不一致数据报错，不输出部分汇总
- 六个固定输入 × 两种策略的 manifest、raw 和 summary 位于 `examples/experiments/`。每种策略各处理 57 个任务；FIFO 总/最大等待为 429/33，SJF 为 325/36，表明平均改善仍可能伴随最坏等待退化
- 新增 `test/experiment.test.mjs`、`test/experiment-cli.test.mjs` 和 [EXPERIMENTS.md](EXPERIMENTS.md)，更新 README、路线图与 Node.js 22/24 CI 的 raw/summary 字节级再生成比较
- 实际云端环境：Node.js 24.19.0、npm 11.9.0；项目运行不需要安装依赖或联网。npm 显示已有 http-proxy 配置警告及版本更新提示，不影响命令退出状态。本地未单独运行 Node.js 22，以发布后同一 SHA 的 CI 为准
- 未计时，不填写工时

| 项目 | 实际执行与结果 |
| --- | --- |
| 完整测试 | `npm test`：148 项通过，0 失败，0 skipped，退出码 0 |
| 原有兼容检查 | `npm run demo` 成功；四组生成 CLI 与提交 fixtures 的 `cmp` 全部一致；四个生成输入各运行 FIFO/SJF，8 条调度命令成功 |
| 固定批实验 | `node src/batch.mjs examples/experiments/baselines.json` 成功，输出与 `baselines.raw.json` 字节一致；同样输入重复运行一致 |
| 独立重算汇总 | `node src/summarize.mjs <raw.json>` 成功，输出与 `baselines.summary.json` 字节一致；测试证明原输入/manifest 文件删除后仍可汇总 |
| 汇总与边界 | 覆盖任务加权/时间加权与错误的均值平均的区别、全空 workload、输入隔离、Unicode 排序、MAX_SAFE_INTEGER 边界、跨运行聚合溢出、修改指标/时间线、重复/遗漏组合和未知版本 |
| CLI 与隐私边界 | 覆盖任意 cwd、相对/绝对路径、含空格路径、help、非法参数/JSON/文件、空 stdout 失败、错误不回显输入和路径、额外 workload 字段/环境变量不进入 raw |
| 扩展抽样检查 | 对 400 个批次的 3200 条生成输入策略结果，另从原始时间线核验整数总量、最坏等待、busy 与 makespan，均通过 |
| 独立复核 | 使用另一套仿真算法核验 7381 个小工作负载、14762 个策略结果及两组 pooled 汇总；已提交的 12 条原始运行也匹配。拒绝 974 个标量篡改、232 个额外字段、1035 个缺失字段和 6 个重算哈希后的任务篡改；聚合溢出明确拒绝，未发现阻塞缺陷 |
| JavaScript 与格式 | 全部 `src/*.mjs`、`test/*.mjs` 逐个 `node --check` 通过；`git diff --check` 通过 |
| 功能 commit / 发布 | 本快照为提交前记录，Day 4 SHA 尚未生成；使用已授权 GitHub tree/commit/ref 接口做非强制快进发布，不将其称为 shell push；不创建或提取 shell 发布凭据 |
| 同一 SHA CI | 本快照完成时 Day 4 尚未发布，因此其 CI 尚未运行；发布后须核对远程相同 SHA 的 Node.js 22/24 检查 |

当前未解决功能阻塞：无。已知限制：摘要重算独立于环境的状态转移实现，但共享 workload 校验和策略选择函数；哈希用于内容关联和源码对照，不提供可信签名或来源认证。归档 source hash 只核验格式，不要求与本机源码相同；未知协议或语义不兼容变更需要版本升级。聚合超过安全整数域须拆分批次；小规模固定样本不代表真实流量，不提供置信区间，也不能据此推导全局最优。用户写在任务 ID 中的数据仍会进入 raw，公开新输入前需要自行审查。源码注释变化也会改变源码哈希，修改已记录源码后须重新生成、审查固定 raw/summary。

下一次第一步：核验 Day 4 实际远程 `main` SHA 与 Node.js 22/24 CI；成功后按 ROADMAP Day 5 固定策略扩展约定、增加带等待时间权重的贪心策略，在同一批输入上与 FIFO/SJF 对照，补充改善和退化案例及合法动作测试。如本阶段发布失败先恢复发布，不能重复制造 Day 4 增量、空提交或回填日期。

## Day 5 验收快照

- 实际日期/时区：2026-10-04（UTC），Day 5 功能发布前；之前的 Day 1–4 记录保留为历史快照
- 恢复检查：云端 checkout 干净，起点为 `ed21088f7694c47c2886d75cd68275e19656617d`，与远程 `main` 一致；未发现仓库级 AGENTS.md 或附加技能要求，未覆盖其他人的改动
- Day 4 发布核验：该 SHA 的 [CI run 37111925060](https://github.com/a123i/reproducible-scheduler-lab/actions/runs/37111925060) 为 completed/success；`test (22)` 和 `test (24)` 均成功；修改前本地重跑 148 项测试全部通过
- 新增 `waiting-weighted` / `waitingWeighted`，最小化 `duration - waitingWeight × (time - release)`；固定权重 1，以 BigInt 精确比较，平局仍按 `(release, Unicode 代码点 id)`；只选择 ready 动作、无抢占、无观察修改或隐式跨调用状态
- 策略注册表统一绑定名称、版本、固定参数及函数；`getPolicyDescriptor` 返回独立数据快照，CLI 帮助与查找和批实验溯源均复用注册表；FIFO/SJF 名称、版本、输出和选择语义不变
- 新增 [POLICIES.md](POLICIES.md)，记录策略扩展契约、公式、固定参数与版本约定、手算改善/退化和局限；README、EXPERIMENTS、路线图与 CI 同步更新
- 原六输入 × FIFO/SJF 批次保持原指标，仅因源码改变再生成 source hash/raw hash；新 `examples/experiments/policies.json` 加入三任务反例并在全部七输入上比较三策略，共 21 条 raw 运行，每策略 60 个任务
- 固定新批次总等待 FIFO/SJF/waiting-weighted 为 438/331/393，最坏等待为 33/36/33；三者总 makespan/busy/idle 为 359/204/155
- 实际云端环境：Node.js 24.19.0、npm 11.9.0。项目仍为零第三方依赖，运行和测试无需安装包或联网；npm 的既有 http-proxy 配置警告及版本提示不影响退出状态。本地未单独运行 Node.js 22，需以发布后同一 SHA 的 CI 为准
- 未计时，不填写工时

| 项目 | 实际执行与结果 |
| --- | --- |
| 完整测试 | 最终 `npm test`：163 项通过，0 失败，0 skipped，退出码 0 |
| 加权策略契约 | 覆盖合法 ready 动作、终止/空 ready、同 score 按 release/id 平局、Unicode、冻结观察、顺序重排、不访问 pending/completed、独立重复调用、有效 workload 的安全整数边界和负 score |
| 参考选择 | 100 个固定 seed、每个 15 个任务，逐步与独立小整数参考排序比较，1500 个动作全部合法且一致 |
| 手算反例 | fairness-tradeoff 中最坏等待相对 SJF 由 6 降到 5，但总等待 14 升到 18；新三任务反例中总等待 6 升到 9，而最坏等待均为 5；完整时间线和每任务指标均被测试核验 |
| 版本与归档 | 固定参数记录和快照隔离通过；修改/遗漏权重、未知版本、额外参数、将不符策略的 SJF 时间线冒充加权结果均被明确拒绝 |
| 原有兼容检查 | `npm run demo` 成功；四组生成 CLI 与提交 fixtures 的 `cmp` 全部一致；四个生成输入各运行三策略，12 条调度命令成功 |
| 固定批实验 | baselines 和 policies 两份 manifest 均重复生成 raw 字节一致，且与归档 `cmp` 一致；两份汇总从 raw 独立重算后与归档 `cmp` 一致 |
| 独立复核 | 独立重跑 163 项测试通过；另一套 BigInt 参考实现核验 7381 个穷举小工作负载、22143 个策略结果，以及 3000 个接近 MAX_SAFE_INTEGER 的结果，全部一致；21 条新归档运行及 pooled 汇总一致；原 Day 4 raw 可用当前汇总器重现其原 summary |
| JavaScript 与格式 | 全部 `src/*.mjs`、`test/*.mjs` 逐个 `node --check` 通过；`git diff --check` 通过 |
| 功能 commit / 发布 | 本快照为提交前记录，Day 5 SHA 尚未生成；使用已授权 GitHub tree/commit/ref 接口做非强制快进发布，不将其称为 shell push；不创建或提取 shell 发布凭据 |
| 同一 SHA CI | 本快照完成时 Day 5 尚未发布，因此其 CI 尚未运行；发布后须核对远程相同 SHA 的 Node.js 22/24 检查，包括两组 raw/summary 字节再生成 |

当前未解决功能阻塞：无。已知限制：新策略固定权重 1，无权重扫描或自动调参；线性 score 对已就绪任务的共同时间项会抵消，所以不会仅因共同等待而反转相对顺序。有限任务环境不能证明无限到达流的饥饿性质或普遍公平性。新策略不保证平均/最大等待总能改善，也没有训练或全局最优结论。原有保守安全整数域、批聚合边界、固定样本代表性和哈希非认证限制继续适用；详见 README、POLICIES 和 EXPERIMENTS。

下一次第一步：核验 Day 5 实际远程 `main` SHA 和 Node.js 22/24 CI；成功后按 ROADMAP Day 6 补齐完整三策略的边界、非法动作、reset、观察隔离及回归，用手算 fixtures 和固定 seed 属性检查交叉核验指标，并归档实际发现/解决的问题与剩余限制。如本阶段发布失败先恢复发布，不重复 Day 5、制造空提交或回填日期。

## Day 6 验收快照

- 实际日期/时区：2026-10-05（UTC），Day 6 回归增量发布前；之前的 Day 1–5 记录保留为历史快照
- 恢复检查：云端 checkout 干净，起点为 `bea725133e0b5fff897437158619c236a5c4f631`，本地/远程 `main` SHA 与 tree `22657044538e9099267c851cc8a8ed7ce48651f3` 一致；未发现仓库级 AGENTS.md 或附加技能要求，没有覆盖他人的改动
- Day 5 发布核验：上述 SHA 的 [CI run 37189442649](https://github.com/a123i/reproducible-scheduler-lab/actions/runs/37189442649) 为 completed/success，`test (22)` 与 `test (24)` 均成功；修改前本地重跑 163 项测试全部通过
- 新增 `test/regression.test.mjs`：独立 BigInt 调度/指标参考，不复用生产环境、策略、排序或聚合实现；用等价 score 和不同 Unicode 比较路径核验完整三策略。另通过队列长度时间积分核验总等待
- 新增 `examples/regression-boundaries.json`：六任务手算 fixture，包含初始/中途 idle、完成时恰好到达、Unicode 与等待加权 score 平局；每个前缀的 transition/reward/指标锁定为手算常量
- 新增 [REGRESSION.md](REGRESSION.md) 和 `npm run test:regression`，说明有限穷举、固定 seed、非法动作/reset/隔离、精确边界、变形属性及归档交叉核验；完整 `npm test` 和现有 Node.js 22/24 CI 自动包含该套件
- 本次解决的是持续回归覆盖缺口，未发现需修改生产实现的 bug；没有变更 `src/`、引擎/策略版本或已有 raw/summary。批实验字节重现保持不变
- 实际云端环境：Node.js 24.19.0、npm 11.9.0。未安装第三方依赖；npm 的已有 http-proxy 配置警告不影响命令退出状态。本地未单独运行 Node.js 22，需以发布后相同 SHA 的 CI 为准
- 未计时，不填写工时

| 项目 | 实际执行与结果 |
| --- | --- |
| 完整测试 | `npm test`：177 项通过，0 失败，0 skipped，退出码 0 |
| 专用回归 | `npm run test:regression`：14 项通过，0 失败，0 skipped；包含在上述完整测试中，不重复计数 |
| 独立小域参考 | 7381 个 0–4 任务输入 × 三策略，共 22143 个参考结果；每个还核验反转输入，共 44286 次运行器比较，全部一致 |
| 固定 seed 与逐步状态 | 128 组固定 seed 参数 × 三策略，共 384 个 episode；逐步核验观察、指标、合法动作、非法动作不变性、reward 守恒与终止行为，全部通过 |
| reset / 隔离 | 三策略分别在新 fixture 的所有 0–6 个完成任务前缀 reset；污染旧输入/观察/transition/metrics 后跨全部三策略重放，并逐步污染返回快照，全部通过 |
| 数值边界与变形 | 覆盖 MAX_SAFE_INTEGER 单任务、近上界 release/score、精确聚合/时间界的接受与 +1 拒绝；25 个 seed 输入 × 三策略的时间缩放/平移属性全部通过 |
| 批指标交叉核验 | 两份归档 33 条 raw 结果和 pooled summary 与独立参考一致；另 26 输入 × 三策略的 78 条混合空/idle/生成结果及任务/时间加权汇总一致 |
| 原有兼容检查 | `npm run demo` 成功；四组 generator CLI 与提交 fixtures 的 `cmp` 全部一致；四个生成输入各运行三策略，12 条 CLI 调度命令成功 |
| 新手算 CLI | 三种策略运行新边界 fixture 均成功；makespan/busy/idle 为 18/14/4，总等待 FIFO/SJF/加权为 10/7/10，最大等待均为 5 |
| 固定实验复跑 | baselines 和 policies 两份 manifest 各重复生成 raw，均与归档字节一致；独立 summarize 输出也与各自归档 `cmp` 一致 |
| 独立复核 | 另一次独立 QA 重跑完整 177 项及专用 14 项测试、两批 raw/summary、四组生成、12 条策略 CLI、语法及格式均通过；复核独立 oracle、队列积分、前缀隔离、手算表与样本计数，未发现阻塞问题；另在临时副本注入 8 种指定故障，专用回归均检出，不代表全面 mutation coverage |
| JavaScript 与格式 | 所有 `src/*.mjs`、`test/*.mjs` 逐个 `node --check` 通过；`git diff --check` 通过 |
| 功能 commit / 发布 | 本快照为提交前记录，Day 6 SHA 尚未生成；使用已授权 GitHub tree/commit/ref 接口做非强制快进发布，不将其称为 shell push；不创建或提取 shell 发布凭据 |
| 同一 SHA CI | 本快照完成时 Day 6 尚未发布，CI 尚未运行；发布后须核对远程相同 SHA 的 Node.js 22/24 检查与两组 raw/summary 再生成 |

开发时一个拟用“大 duration”测试输入超过既有保守聚合支持域，被正确拒绝；调整为域内输入并另增精确边界 +1 拒绝测试，没有为测试放宽生产校验。这属于测试数据修正，不是生产缺陷。

当前未解决功能阻塞：无。有限穷举不是对全部合法输入的证明；固定 seed 输入生成仍使用生产生成器，独立性主要覆盖调度/排序/指标；参考实现也可能共同误读规格。浮点比值、单 worker 非抢占、有限任务、保守整数支持域、批聚合边界与哈希非认证限制继续适用。完整范围和限制见 REGRESSION；不声称统计置信度、全局最优、无饥饿或真实负载代表性。

下一次第一步：核验 Day 6 实际远程 `main` SHA 与 Node.js 22/24 CI；成功后按 ROADMAP Day 7 编写可复现实验方法/结果/限制报告，使每条结论可追溯到已归档输入与原始结果，验证干净目录的离线使用并准备真实可交付版本。如本阶段发布失败先恢复发布；不要重做 Day 6、制造空提交或回填日期。
