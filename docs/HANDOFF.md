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

Day 2–Day 7 尚未实现。不得通过空提交、回填日期、虚构工时或无意义文件改动满足每日计划。

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
