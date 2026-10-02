# 固定 seed 工作负载与复现协议

Day 3 增加可离线运行的生成器。已有调度输入 schemaVersion 仍为 1；`generation` 是附加的来源记录，既有手写 workload 不需要这个字段。环境校验会复制 tasks 并忽略附加元数据，调度 CLI 的结果目前仍为 `{ schemaVersion, policy, schedule, metrics }`。要保存可复现实验，应保留生成输入本身；完整批实验来源封装属于 Day 4。

## API 和配置

`src/workload.mjs`：

- `generateWorkload(options)` 返回 `{ schemaVersion: 1, generation, tasks }`
- `validateGeneratorOptions(options)` 返回规范化副本 `{ seed, parameters }`，不生成任务
- `replayWorkload(generation)` 使用完整来源记录重建 workload；拒绝不支持的版本或不完整参数
- `generatorVersion` 当前为 `lcg32-workload-v1`；`maxTaskCount` 为 10000

| 参数 | 默认值 | 支持范围与含义 |
| --- | --- | --- |
| seed | 无，必须提供 | 无符号 32 位整数，0–4294967295；不接受字符串或隐式转换 |
| taskCount | 20 | 0–10000 的整数；0 生成空任务集合 |
| initialRelease | 0 | 非负安全整数；第一个任务的 release |
| duration | `{ "min": 1, "max": 8 }` | 闭区间内抽取整数；1 ≤ min ≤ max ≤ 4294967295 |
| arrivalGap | `{ "min": 0, "max": 4 }` | 相邻任务 release 的基础增量，闭区间整数；0 ≤ min ≤ max ≤ 4294967295 |
| burstSize | 1 | 1–10000 的整数；每组多少任务后添加 burstGap；允许大于 taskCount |
| burstGap | 0 | 非负安全整数；跨组时在基础 arrivalGap 之外额外添加的间隔 |

省略的参数使用默认值；显式 `null`、非整数、未知字段、反向区间或区间缺少 min/max 都会报错。范围对象的未知字段也会报错，避免拼写错误悄悄改变实验。seed 的 `-0` 规范化为 `0`。输入、输出元数据、任务及后续生成调用之间不共享可变状态。

第一个任务直接使用 initialRelease。以后每个任务都抽取一次基础 arrivalGap；当它的从零开始的索引是 burstSize 的倍数时，再加 burstGap。最后一组可以不满；最后一个任务后不会生成间隔。

例如 initialRelease=5、arrivalGap 固定为 1、burstSize=3、burstGap=10、taskCount=7 时，release 为 `5, 6, 7, 18, 19, 20, 31`。想让一组任务同时到达，设置 arrivalGap 为 `{ "min": 0, "max": 0 }`。burstGap 只保证输入 release 的间隔；如果之前的任务仍在排队，并不保证 worker 真正 idle。

所有参数在生成前经过最坏情况安全整数检查：令所有 duration 与基础 gap 都取各自最大值，核验 `H = max(release) + sum(duration)` 和 `sum(H - release)` 不超过 `Number.MAX_SAFE_INTEGER`。使用 BigInt 计算这些界，不会先发生浮点整数溢出后再检测。可能生成不受支持输入的整个参数范围会被拒绝，即使某个 seed 的实际样本较小。空输入的这两个界均为 0。生成后还会调用既有 `validateWorkload`。

10000 是生成器的明确资源上限，不是性能承诺。现有环境每步会复制/扫描任务与历史，适合小规模可检查实验；大规模性能优化不在 Day 3 范围内。

## v1 的精确伪随机协议

`src/random.mjs` 的 `createRandom(seed)` 返回 `nextUint32()` 与 `integer(min, max)`。每个实例彼此隔离，同一实例的两个方法共享该实例的随机状态，没有全局随机状态：

1. 初始状态就是 seed，包括 0
2. 每次取样先更新 `state = (1664525 × state + 1013904223) mod 2^32`，返回更新后的状态；实现采用 `Math.imul` 和无符号 32 位转换
3. 对整数闭区间，令 `width = max - min + 1`、`bucketSize = floor(2^32 / width)`、`limit = bucketSize × width`
4. 丢弃所有大于或等于 limit 的随机字，直到接受一个 word；结果为 `min + floor(word / bucketSize)`。这避免把不均匀尾部映射为取模偏差；并不意味着相邻样本互相独立
5. 单点区间仍消耗一个随机字；拒绝采样可能消耗更多。第一个任务先抽 duration，以后依次抽 arrivalGap、加确定性 burstGap、抽 duration
6. ID 按生成顺序为 task-000001、task-000002 等，固定六位数字补零；tasks 保留此顺序

seed=1 的前六个随机字为 `1015568748, 1586005467, 2165703038, 3027450565, 217083232, 1587069247`。默认参数且 taskCount=3 时，三个 `(release, duration)` 为 `(0, 2), (1, 5), (4, 1)`。测试还用独立 BigInt 递推核验边界 seed，覆盖不均匀尾部拒绝分支。

生成输出按固定字段顺序构造，CLI 用两空格 JSON 缩进和末尾换行；不包含时间戳、主机信息或随机 UUID。相同版本、seed 与规范化参数产生相同 JSON 字节，已在测试和 Node.js 22/24 CI 矩阵中设为检查项。影响字节、ID、抽样或默认参数含义的协议改动应使用新 generator 标识，不能悄悄改变 v1 重放。

这是用于可复现 fixtures 的简单 LCG，存在周期与相关性限制，不能用于密码学、安全令牌或统计独立性承诺。不同 seed 不保证每个有限工作负载都不同；固定 duration/gap、零任务等配置可产生相同 tasks。固定 seed 重复运行也不是独立实验重复。

## 已提交场景

每组配置位于 `examples/generator/<名称>.json`，生成文件位于 `examples/generated/<名称>.json`。四组均显式使用 seed=20261002、12 个任务、duration 范围 2–6；当前四个固定样本的 busyTime 都为 44。

| 名称 | 到达设置 | 观察到的行为 |
| --- | --- | --- |
| low-load | 基础间隔 8–12 | 每个任务均能立刻开始；总等待 0，idleTime 78 |
| high-load | 基础间隔 0–1 | 初始就绪后一直忙碌；总等待较大 |
| bursty | 基础间隔 0，每组 4 个任务，组间额外 8 | 三组同时到达，release 为 0、8、16；已有队列导致无实际 idle |
| idle-gaps | 初始 release=5，基础间隔 1–2，每组 3 个任务，组间额外 30 | 包含初始 idle 及多段实际空闲；idleTime 77 |

以下是固定样本的仿真值，由 tests 锁定并可用两个 CLI 重算，不是统计估计：

| 名称 | 策略 | makespan | totalWaiting | maxWaiting | idleTime |
| --- | --- | ---: | ---: | ---: | ---: |
| low-load | FIFO / SJF | 122 | 0 | 0 | 78 |
| high-load | FIFO | 44 | 214 | 33 | 0 |
| high-load | SJF | 44 | 167 | 36 | 0 |
| bursty | FIFO | 44 | 157 | 25 | 0 |
| bursty | SJF | 44 | 119 | 30 | 0 |
| idle-gaps | FIFO | 121 | 25 | 6 | 77 |
| idle-gaps | SJF | 121 | 21 | 6 | 77 |

高负载与突发样本再次说明：SJF 降低总/平均等待，但可以增加最大等待。这里只比较相同固定输入；不同场景的 utilization 是有限窗口结果，不能作为生产系统稳态负载率的估计。

## 离线复现

```sh
npm test
mkdir -p experiments/local
node src/generate.mjs examples/generator/high-load.json > experiments/local/high-load.json
cmp examples/generated/high-load.json experiments/local/high-load.json
node src/cli.mjs experiments/local/high-load.json --policy fifo
node src/cli.mjs experiments/local/high-load.json --policy sjf
```

`cmp` 是可选的系统字节比较工具；`npm test` 已用 Node.js 检查所有四组配置生成和元数据重放的字节一致性，不依赖 `cmp`。所有应用和测试运行只需 Node.js 22+ 与 npm，不需要 npm install。手动更改 tasks 后，generation 仍只描述原生成过程；重放不会保留手动改动，也不会自动认证修改后的数据。

下一阶段将用这些固定输入构建批实验，保存完整输入、seed、参数、策略、版本信息与逐次原始指标，并确保汇总能从原始结果重算。
