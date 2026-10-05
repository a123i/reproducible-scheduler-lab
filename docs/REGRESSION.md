# 回归与指标交叉核验

Day 6（2026-10-05 UTC）把原先分散的回归和一次性核验补成持续运行的完整三策略检查。新增测试不改变调度行为、策略版本、源码哈希或已有实验结果；不以更多文件或测试名称代替可核验的行为。

## 离线复跑

要求 Node.js 22+，不需要 `npm install` 或联网。在仓库根目录运行：

```sh
npm test
npm run test:regression
node src/cli.mjs examples/regression-boundaries.json --policy fifo
node src/cli.mjs examples/regression-boundaries.json --policy sjf
node src/cli.mjs examples/regression-boundaries.json --policy waiting-weighted

mkdir -p experiments/local
for name in baselines policies; do
  node src/batch.mjs "examples/experiments/$name.json" > "experiments/local/$name.raw.json"
  cmp "examples/experiments/$name.raw.json" "experiments/local/$name.raw.json"
  node src/summarize.mjs "experiments/local/$name.raw.json" > "experiments/local/$name.summary.json"
  cmp "examples/experiments/$name.summary.json" "experiments/local/$name.summary.json"
done
```

`npm test` 已执行 `test/regression.test.mjs`，专用命令只是方便集中定位，不需要重复运行才算完整测试。已有 Node.js 22/24 CI 矩阵自动执行这套测试，以及两组归档的字节级再生成比较。测试在断言失败时报告策略、seed 或完整小输入，能直接重现；不从时钟或 `Math.random()` 抽样。

## 三层交叉核验

1. **手算前缀**：下方固定 fixture 的每个 transition、reward、环境时间与完成任务指标由常量表锁定，先约束生产结果与测试参考实现
2. **独立调度参考**：测试侧使用 BigInt 时间和聚合、排序后的剩余任务列表，以及固定宽度 Unicode 代码点编码。它不调用生产的环境状态转移、排序、策略或指标函数；加权策略以等价的 `duration + release` 排序，刻意不同于生产的 `duration - (time - release)` 算法。仅最终公开数字和比值转为 Number，转换时检查整数精确性
3. **守恒与队列积分**：逐步核验累计 reward 为负总等待；最终 busy 为输入 duration 总和，turnaround 为 busy 加总等待，makespan 为 busy 加 idle。另以 release 事件令就绪队列计数 +1、dispatch 事件令其 -1，积分队列长度随时间的面积，核验总等待。积分不读取 transition 的 waiting 字段；同一时刻事件间宽度为零

逐步比较包括 ready/pending/completed 的内容和排序、`terminated`、step 返回的 transition/reward/metrics，以及单独调用的 `getMetrics()`。非终止观察必须有就绪任务，每个动作必须合法，每个任务恰好完成一次，时间单调且任务不抢占。

## 手算边界 fixture

`examples/regression-boundaries.json` 有意打乱输入顺序：

| ID | release | duration |
| --- | ---: | ---: |
| block | 2 | 5 |
| old | 3 | 4 |
| short | 6 | 1 |
| U+E000 | 14 | 1 |
| U+10000 | 14 | 1 |
| end | 16 | 2 |

两个 Unicode ID 是对应单个字符。代码点顺序为 U+E000 在前，与直接按 UTF-16 code unit 排序的结果不同。

所有策略初始自动 idle 到 2：尚未完成任务，busy、waiting 和 turnaround 均为 0，makespan/idle 均为 2，utilization 为 0。

FIFO 与 waiting-weighted 的时间线相同。时间 7 时，old 的 score 为 `4-(7-3)=0`，short 为 `1-(7-6)=0`；加权策略按 release 平局选择 old：

| 完成任务 | start–finish | waiting | turnaround | step 后 time | busy | 累计 waiting | 累计 turnaround | maxWaiting |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| block | 2–7 | 0 | 5 | 7 | 5 | 0 | 5 | 0 |
| old | 7–11 | 4 | 8 | 11 | 9 | 4 | 13 | 4 |
| short | 11–12 | 5 | 6 | 14 | 10 | 9 | 19 | 5 |
| U+E000 | 14–15 | 0 | 1 | 15 | 11 | 9 | 20 | 5 |
| U+10000 | 15–16 | 1 | 2 | 16 | 12 | 10 | 22 | 5 |
| end | 16–18 | 0 | 2 | 18 | 14 | 10 | 24 | 5 |

SJF 在时间 7 先处理 short：

| 完成任务 | start–finish | waiting | turnaround | step 后 time | busy | 累计 waiting | 累计 turnaround | maxWaiting |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| block | 2–7 | 0 | 5 | 7 | 5 | 0 | 5 | 0 |
| short | 7–8 | 1 | 2 | 8 | 6 | 1 | 7 | 1 |
| old | 8–12 | 5 | 9 | 14 | 10 | 6 | 16 | 5 |
| U+E000 | 14–15 | 0 | 1 | 15 | 11 | 6 | 17 | 5 |
| U+10000 | 15–16 | 1 | 2 | 16 | 12 | 7 | 19 | 5 |
| end | 16–18 | 0 | 2 | 18 | 14 | 7 | 21 | 5 |

第三步完成时 finish 为 12，但返回观察已推进到 14，所以此时 idle 为 4。时间 16 恰好到达的 end 已可立即执行，不增加 idle。最终三策略 busy/idle/makespan 均为 14/4/18，utilization 为 `14/18`；累计 reward 分别为 -10、-7、-10。均值取表内累计量除已完成任务数，不能把尚未执行任务的等待算进中途指标。

## 持久回归范围

| 检查 | 确定的样本与不变量 |
| --- | --- |
| 小域穷举 | 0–4 个任务，每任务 release ∈ {0,1,2}、duration ∈ {1,2,3}，固定互异 ID 含前缀和 BMP/补充平面字符；共 `1+9+81+729+6561=7381` 个输入 × 3 策略 = 22143 个参考结果，并各重跑反转输入，共 44286 次运行器比较 |
| 固定 seed 前缀 | seed 0–125、2147483648、4294967295，共 128 配置 × 3 策略 = 384 个 episode；taskCount 为配置索引 mod 25，包含空输入、不同 duration/gap、初始 idle 与 burst；完整参数公式保存在测试 `seeded()` 中 |
| 非法动作 | 在固定 seed 和手算/端点的每个非终止前缀注入未知 ID、未释放和已完成任务（存在时）、undefined/null/number/boolean/object/array/BigInt/Symbol/装箱字符串；应抛错且指标不变，随后合法 step 必须仍与完整参考状态一致；终止后再 step 必须拒绝 |
| reset/隔离 | 每个策略在手算 fixture 的 0–6 个已完成任务前缀重置，污染旧输入、观察、transition、metrics；再依次用全部三策略重放，并在每步污染返回值，后续状态仍与参考一致。也核验 reset 不会反向修改旧快照 |
| 安全整数 | 空集、单任务 duration=MAX_SAFE_INTEGER、最晚安全 release、多任务近上界 release/score、巨型 duration；2–8 个任务精确构造最后安全聚合/时间界，再增加 1 明确拒绝。均使用 BigInt 构造或核验边界 |
| 变形属性 | 25 个固定 seed 输入 × 3 策略，将所有时间 ×3、所有 release +19 或同时变换，任务顺序不变；等待/turnaround/busy 按比例变化，非空 episode 的 makespan/idle 增加偏移，空 episode 仍全零 |
| 批实验 | 两份已提交 raw 的全部 33 条结果及 pooled summary 与独立参考比较；另混合手算边界与 25 个固定 seed 输入，共 26 输入 × 3 策略 = 78 条结果，核验含空 workload 的任务加权/时间加权汇总 |

测试显式核对策略注册表。以后新增策略必须补充独立参考语义，不能静默漏测。

## 本阶段解决的覆盖缺口

- 旧生成器属性测试主要对 FIFO/SJF 核验最终指标；新增完整三策略的每步观察、reward 与状态校验，包含等待加权策略
- 批汇总器虽然独立重算指标，但仍共用生产策略函数；新增不依赖该函数的测试参考及手算常量，降低共享错误同时通过的风险
- 将此前一次性小域核验持久化为正常测试；增加 reset 前缀、跨策略重放、非法动作不变性、陈旧快照污染和精确整数边界
- 新 fixture 锁定“完成时间不一定等于 step 后环境时间”的中间状态，避免后续优化错误漏记自动 idle

本次检查未发现需要修改生产实现的缺陷；解决的是回归覆盖缺口，不虚构已修复的运行时 bug。两份已有实验 raw/summary 保持字节不变，不因新增测试伪造实验变化。

## 仍有限制

- 小域穷举和固定 seed 检查是有限域证据，不是全部合法输入的数学证明、模糊测试覆盖率或统计性能结论
- 独立参考仍由同一文字规格推导，可能存在共同误读；手算常量、不同计算路径与队列积分降低风险但不能消除它
- 固定 seed 输入仍由生产生成器提供；其 PRNG 与重放另有既有专门测试。本阶段的独立性主要是调度、排序和指标，不宣称独立重新实现所有输入生成
- 浮点均值和 utilization 仍有 Number 表示限制；测试从精确整数分子/分母计算期望，不声称小数无损
- 非法动作回归覆盖正常 JavaScript 值；不支持把带副作用的任意 Proxy/getter 当作不可信沙箱输入。公开 CLI 读取普通 JSON
- 仍为有限任务、单 worker、非抢占、小规模仿真；没有训练、全局最优、无饥饿或真实负载代表性结论。保守安全整数支持域、批聚合上界、源码哈希非认证限制继续适用
- 最终实验方法/结论报告和干净目录交付验证留给 Day 7；本记录不提前宣称已完成
