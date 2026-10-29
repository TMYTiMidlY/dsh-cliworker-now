# 固定安装版原生版本横幅验收（2026-10-25）

## 先区分发现入口与原生输出

真实浏览器以现有 `http://127.0.0.1:61060`、原生登录交换、当前父会话及CLI Worker设置导航，只读调用正式cliExecutablePath：OpenCode实际入口为 `/home/timidly/.opencode/bin/opencode`。没有使用shell PATH中的另一个程序替代该证据，未点击路径保存/恢复自动、登录、退出或账号终端。

该ELF为211,793,376 bytes，SHA256 `2df936a20cf74af5706020342164628f9a31978c50c2b0ad306b42b614fe245d`。只读程序源，不执行模块/import/eval或读取真实凭据/DB/history。静态完整链：

- effect/cli CliOutput默认@131424249；普通pipe/no-color时bold/dim均identity。
- formatter@131425441：`formatVersion(name,version) => bold(name)+' '+dim('v')+bold(version)`。
- 内置version flag@131450675通过Console.log（@131371041）输出formatter。
- root@131934196名称opencode，Et=Ve@131944580，入口@133155794将version=sa传入Command.run；sa@131919921固定2.0.31。

因此该分支完整普通pipe合同为 `opencode v2.0.31\n`，含换行17字符、trim后16字符。正式模型工具在修复前给出安全诊断 `format=unrecognized, chars=17, lines=1, ansi=false`，与链路吻合；没有暴露任意原始stdout/stderr。单凭常量或17字符本身不构成根因，决定性依据是上述renderer调用链。

## 最窄修复与反例

保留纯semver、旧lowercase `opencode [version] <semver>`；仅新增原生lowercase `opencode v<既有semver>` 完整行。prefix空白限定横向空格/tab，不让旧`\s+`跨行接受额外stdout。仍仅接受major1/2，不放宽其他品牌/大小写、重复v、额外输出、ANSI或未知主版本；不顺带扩大prerelease+build范围。安全错误只保留固定format枚举/字符行数/ANSI布尔，不复制原始未知程序载荷。

反例先打红：18 PASS、3 FAIL；失败恰为两条真实branded-v格式被拒，以及旧跨行prefix错误通过。修复后包含panel、v2 metadata/execution、dispatch、model-control、routing、account-binding的 **7文件450/450 PASS、0 SKIP**；Host/Client类型、严格本change及diffcheck均通过。不是全仓或真实模型完成声明。

## 候选、空闲热更新和动态结果

- 全新候选冻结293份源码并核对root/preview一致；再次构建/类型通过。
- 归档 `3a6df7ec3b21aaaefc6707b6d480fd89966bdcd09527a6b95b362a7bfc3c4240`，18,264,121 bytes，913个普通安全路径逐byte核对预览。
- 安装前正式并发读数global/parent active/queued均0；脚本再检查Worker/native进程及精确最新部署基线。实际旧包和profile先备份，然后官方plugin add --ignore-scripts；核对704份lib、802份既有Worker/events/raw/binding/fork字节不变，并发12、无关依赖不变。
- 保留其他会话已热装的AGY共享设置和cache-free显式账号目录修复，不重装旧7ca/680基线覆盖。Host现为 `20f82bf1c35a82b64d3ef2283d5471ec8dfe2de81ff093cfb966b6f7001972de`，Client为 `21efc4552afc1cc250a9aa054cb46eb1aa658d03d39dc64807c33a6c830899ce`。没有出货被撤下的Cursor分类草稿。
- 只更新已备份profile来源注释触发正常热加载；DSH PID38589/startTicks761921不变，没有另开服务器/重启，账号/凭据没有人工修改。
- 激活后**一次正式** `cliworker_models({cli:'opencode'})` 不再报版本无法确认，而进入下一真实门禁：`OpenCode v2 原生服务未运行或未登记；请在原生账号终端打开 OpenCode 后刷新，这不表示账号已登出`。

这证明版本分流修复已在实际原生入口生效；不能说成目录成功、账号登出、原生模型/工具/停止或完整OpenCode v2已验收。尚未自动启动服务、读取DB、认证、生成prompt或绕过门禁。下一步是按已有授权处理原生服务生命周期，再逐项真实验收。

私有构建/安装证明在现有`.cache/`任务材料中；原候选、备份均保留，无Git暂存/提交/推送/PR/版本变化或发布。
