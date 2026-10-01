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
