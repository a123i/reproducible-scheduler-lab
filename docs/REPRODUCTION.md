# 源文件交付与离线复现

本页说明拿到源文件后如何复跑全部固定实验，以及怎样确认结果不依赖原工作区、Git 元数据、`node_modules` 或已有 npm 缓存。实验方法、数据结论和完整限制见 [REPORT.md](REPORT.md)。

## 最短命令

预先安装 Node.js 22+ 及随附 npm，进入仓库或已解压源文件根目录：

```sh
npm test
npm run demo
npm run reproduce
```

不执行 `npm install`。只有复现检查也可运行 `node scripts/reproduce.mjs`，不需要 npm 或 Git。脚本根据自身位置找到项目，可以从另一目录启动；无参数或 `--help` 是唯一支持的形式。

成功的复现命令输出：

```text
Reproduced 4 generated fixtures, 2 repeated batches, 2 audited summaries, 33 matched CLI runs, and the tiny demo.
```

它逐字节核对生成输入和两组 raw/summary；两批 raw 各生成两次以核对确定性。33 条 CLI 对照包含六输入基准和七输入三策略批次中的重叠场景，不是 33 个独立样本。tiny 检查 makespan 9、总等待 2、最大等待 2、busy 6、idle 3 等完整指标。

原始实验仍可逐项运行：

```sh
mkdir -p experiments/local
node src/generate.mjs examples/generator/high-load.json > experiments/local/high-load.json
cmp examples/generated/high-load.json experiments/local/high-load.json
for name in baselines policies; do
  node src/batch.mjs "examples/experiments/$name.json" > "experiments/local/$name.raw.json"
  node src/summarize.mjs "experiments/local/$name.raw.json" > "experiments/local/$name.summary.json"
  cmp "examples/experiments/$name.raw.json" "experiments/local/$name.raw.json"
  cmp "examples/experiments/$name.summary.json" "experiments/local/$name.summary.json"
done
```

这些 shell 重定向会预先清空输出目标，不能指向输入文件。复现脚本本身只在新临时目录写中间 raw，结束时清理；不会自动改归档或替你接受不一致结果。

## 从确定版本建立干净目录

以下为 Bash、Git、tar 和 Node.js/npm 的 Linux/macOS 风格命令。只使用已经在本地的提交，不访问远程或安装包。先用 `git status --short` 检查自己的改动；`git archive HEAD` 只导出当前提交，不会包含未提交文件，也不会覆盖原工作区。若要复现历史交付，把 HEAD 换成已核实的完整提交 SHA。

```bash
set -euo pipefail
git status --short
git rev-parse HEAD HEAD^{tree}
delivery=$(mktemp -d "${TMPDIR:-/tmp}/scheduler-delivery.XXXXXX")
mkdir "$delivery/source" "$delivery/home" "$delivery/cache"
touch "$delivery/user.npmrc" "$delivery/global.npmrc"
git archive --format=tar HEAD | tar -xf - -C "$delivery/source"
cd "$delivery/source"
test ! -e .git
test ! -e node_modules
offline_npm() {
  env -i PATH="$PATH" HOME="$delivery/home" \
    npm_config_offline=true npm_config_update_notifier=false \
    npm_config_cache="$delivery/cache" npm_config_userconfig="$delivery/user.npmrc" \
    npm_config_globalconfig="$delivery/global.npmrc" npm "$@"
}
offline_npm test
offline_npm run demo
offline_npm run reproduce
test ! -e node_modules
printf 'Validated source directory: %s\n' "$delivery/source"
```

此目录留在临时目录供读者查看；确认不再需要后可自行清理。项目自带 CI 在 Node.js 22/24 上用同样方式导出实际 checkout 的 HEAD（PR 时可能是合并测试提交），执行完整测试、demo 和复现，且检查没有生成 node_modules。

## 本次验证边界

- 实际环境：2026-10-06 UTC，dot 云端 Linux，Node.js 24.19.0、npm 11.9.0
- 提交前验收使用已暂存项目 tree 的 Git archive 导出，避免遗漏新增文件；导出不含 `.git`、`node_modules` 或原工作区临时结果。发布后必须对同一远程提交 SHA 再执行上述 HEAD 方式核验
- 使用空 HOME、空 npm cache、清空继承环境但保留 PATH，以及显式 npm offline / 禁用更新提示 / 空用户和全局 npm 配置；没有执行 install，完整测试、demo 与复现结果记录在 [HANDOFF.md](HANDOFF.md)
- 这是“无需第三方下载和项目缓存”的验收。npm offline 仅约束 npm，本次没有建立操作系统级网络隔离，也未抓包证明零网络系统调用，不能将其写成强制断网测试
- Node.js/npm 与 shell 工具已经预装；源码获取、运行时安装和远程 CI 的 actions 下载仍可能联网。GitHub CI 成功也不等于 CI 全程离线
- 应用与测试只使用 Node.js 内置模块。复现时要保留完整 `src/`、`scripts/`、`examples/`，运行 `npm test` 还需 `test/` 和 `package.json`；不依赖原 repo 所在绝对路径

## 检查失败时

先检查命令退出码，保留错误原文并确认使用的 commit、Node.js 版本和文件完整性。生成 fixture/raw/summary 不匹配时，不要直接覆盖归档“修复”失败；按 [EXPERIMENTS.md](EXPERIMENTS.md) 追查源码字节、输入、seed、策略版本和配置差异。缺少文件、CLI 非零退出或写 stderr 都会中止复现；已经打印部分调度输出的单独手工命令不等于整套验收通过。
