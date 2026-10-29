# 准备期诊断验证记录

## 范围与阶段

本写者实施 tasks 1.1–1.3；2.1–2.3 由父会话独立构建、安装和实机核对，保持未勾选。入口规则已实际读取：`~/.agents/AGENTS.local.md` 为 610 WSL 本机规则；未读取其中提及的凭据或服务配置。

父明确批准了 resolve 阶段扩充：Cursor binding 在 status capture 前会先解析入口，原来该异常同样会被末级包装为账号错误。仅在 material 的既有 resolver 外安全映射，不变更入口选择/文件读取授权。旧 Windows 路径配置错误统一呈现安全 resolve/unknown，不复制任意原始消息或路径；其他 CLI 默认不使用新诊断。

## 实现

- 共享捕获末尾 Host 内部 `safeDiagnostics` opt-in，非 RPC/tool 参数；默认保留原异常身份、文案、成功值和 read→done 等待顺序。Cursor status 单独开启。
- 固定 phase：resolve/spawn/read/exit/timeout；封闭系统原因或 unknown，退出码仅 uint32 整数或 null。signal 仅映射固定 signal 标签，不复制任意信号名。预算为 read/output-limit，内部期限为 timeout/deadline，不根据原始 message/name 猜阶段。
- 安全异常不存原始 message/cause、输出、env/argv/name/code。Cursor 独立 CLI_METADATA_QUERY_FAILED 透传，不伪装未登录；JSON/真实无身份判定维持原语义。
- spawn 在 try 内，只有实际创建 handle 才 terminate/wait；typed cleanup 优先，包括 caller abort 后读取/完成 promise 才报告的 cleanup。取消 reason 保持控制身份，不拼进诊断；未知系统原因不靠正则透传。

## 红→绿

1. metadata-diagnostics + metadata-cleanup + catalog-decoding 初始 **12 FAIL / 10 PASS**，明确缺少 spawn/read/exit/timeout 的固定安全信息。
2. Cursor preparation 8项初始 **4 FAIL / 4 PASS**：同步/异步 resolver 和 status 捕获被吞为 generic binding account error。
3. typed cleanup 与 caller abort 竞争 **1 FAIL** 后修复，cleanup 仍优先；畸形/throwing completion 字段 **1 FAIL** 后封闭在 exit，不让它退化为账号失败。
4. runtime gate 5项覆盖 resolve/spawn/exit/cleanup/cancel：零 prompt、旧 Worker/run/conversation/模型偏好/账号绑定/历史不变；cleanup 只封锁 Cursor，关闭旧测试 store 后重新打开仍保护，其他 CLI 继续允许。初次冷开测试曾撞真实 store 单写锁，修正测试顺序先 close 再 reopen，没有修改锁业务。

所有元数据进程都是合成 handle；runtime 材料仅在项目 `.cache/cursor-preparation-runtime/run-*`。没有 native CLI、模型、账号/历史读取或自动重试。已有 Cursor outcome/fence 未改。

## 验收命令

均先 `umask 022`，pnpm 带 `--config.verifyDepsBeforeRun=false`。

```sh
pnpm --config.verifyDepsBeforeRun=false exec vitest run tests/metadata-diagnostics.test.ts tests/metadata-cleanup.test.ts tests/catalog-decoding.test.ts tests/cursor-preparation-diagnostics.test.ts tests/cursor-preparation-runtime.test.ts tests/cursor-native.test.ts tests/cli-account-binding.test.ts tests/cli-settings.test.ts tests/native-runtime.test.ts tests/dispatch-flow.test.ts tests/cursor-outcome-runtime.test.ts
pnpm --config.verifyDepsBeforeRun=false typecheck
pnpm --config.verifyDepsBeforeRun=false spec validate diagnose-cursor-preparation-metadata --strict --no-interactive
git diff --check
```

最终 **11 文件 364 PASS / 0 FAIL**；Host/Client 类型对 DSH 0.2.1-rc.2、该 change strict 与 diff 检查均通过，相关后台 jobs 已收齐。未跑全仓；不将已通过的类型/关联检查冒称 2.1 的隔离构建/包一致核验完成。

合成通过不证明真实准备失败根因、账号登出、额度或恢复。以上为原写者阶段记录：该写者未构建/打包/安装、改版本、Git 写或归档。父后续结果另列如下，不反向修改两次原始失败事实。

## 父独立复验与隔离候选

独立只读审查发现两项边界：accepted code=0仍有signal被误当成功，默认非Cursor在spawn/read原错误与caller取消竞争时异常身份被覆盖。父先补11反例，实际 **11 FAIL/21 PASS**；只在安全分支接受允许的uint32且signal必须null/undefined，将取消覆盖限回opt-in。单文件转 **32 PASS**。这些是防御及兼容性反例，不冒称生产中已发生。

随后父将既有Cursor outcome/fence与本诊断合并重跑19个关联文件：[报告](../../../.cache/cursor-diagnostics-parent-20261025-r1.json)实际 **634 PASS/0 FAIL/1既有SKIP**（635 total）。Host/Client类型、两change strict、diffcheck通过；765个源码/构建/测试输入在执行前后逐一冻结核对，[输入证明](../../../.cache/cursor-diagnostics-parent-20261025-r1.json.inputs.json)记录同一report hash。未跑全仓。

全新隔离preview及包通过自己的构建/类型；295份src、511份产品输入冻结一致，Client仍21efc455，Host为a4ef5c9542f85f0fa5e18c16aa9b20b824e0d6d2ac798d1f30ed757c020b1ea4。仅精确允许上述既有官方turn-process测试skip，不允许其他skip。构建器从旧“撤下实验必须排除”门禁改为显式reviewed模式：两份runtime helper及声明必须与已审src逐字节相同、包内齐全，不能泛放任何cursor-outcome名字。919个archive regular条目与preview逐项一致；包18276053 bytes，SHA256 `9bf92f83964ec01b4cb5fee218e3f45622bf53c26aa8ae20151f7bc823f6175c`。[构建证明](../../../.cache/cursor-outcomes-diagnostics-20261025-r1-package/build-proof.json)。

## 官方空闲热更新与一次正式核对

全局正式工具为limit12、active0/queued0；文件watch确认连续3秒Worker空闲后复验native helper process guard。备份当时实际在线包与四份profile文件，才官方 `dsh plugin --profile web add ... --ignore-scripts`。710个安装产物一致，816份当时历史文件byte未变（不是拿较早802数冒充当前），其他依赖和concurrency不变，DSH仍PID38589/startTicks761921。[安装证明](../../../.cache/install-backups/cursor-outcomes-diagnostics-20261025-r1/installation-proof.json)。仅更新原profile activation comment触发热装，父逐行确认除第2行注释其余128行完全相同；未重启、未改设置语义、未中断其他任务。

只对原cursor-5、旧run1581d619及精确grok4.7参数ID做一次formal followup，真实准入新run **94472825-4d7c-4eeb-adc5-32ee6e0d8c59** / job cliworker-29f65cd339754ceb。旧准备故障本次没有再现，**不能据此断言已找到之前根因**。仍同native session ffa41bea，native model回执精确匹配；最终failed、partial、cleanup confirmed，实际错误为“CLI请求的额外权限已拒绝”。public body虽有CURSOR_NEGATIVE_EXECUTED，但不拿它证明执行过脚本。

[安全观察](../../../.cache/cursor-native-negative-20261025-r1-observation.json)只筛这一个run：42条事件、shell command与发出的脚本精确一致；独立exit证明文件不存在。权限拒绝诊断后该tool曾UNKNOWN，终态又COMPLETED，而整个run ERROR；此为需继续核的权限/工具投影边界，**未证明shell exit7已经执行或被正确分类**。job与run公开正文已收齐，不自动重发、不添加force、不放宽Native保护。原Shell计划转为独立权限合同只读审查；账号/目录通过、准备准入恢复、实际工具权限拒绝三类证据分别记录。

本change已交付安全诊断并完成部署核对，不等于Cursor全部工具验收，更不等于Kimi/OpenCode或新多鉴权导入完成。上述剩余目标在总任务与各自change中继续；不通过归档隐藏缺口。
