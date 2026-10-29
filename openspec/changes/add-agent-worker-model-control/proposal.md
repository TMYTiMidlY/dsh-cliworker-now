# Proposal

## Why

真实 AGY 批量使用中，主 Agent 只能启动、续聊、停止和读取最新状态，不能枚举当前 Worker 的模型或显式更换模型。用户要求 Argon 后接 Opus，但在标题或提示词写 Opus 仍沿用 Argon，造成重复同模型审阅；缺少按 runId 取完整回复的入口又增加了回读子会话和误用历史结果的风险。

## What Changes

- 为已完成原生首次选型的 Worker 增加模型目录查询与显式模型/强度配置工具，复用已有账号范围、目录校验和空闲门禁，而非新增原生 CLI 协议。
- 首阶段以 AGY 的 Argon → Opus 同会话续聊及 fresh Opus 首个prompt正确选型为真实验收目标；新增明确cli只读目录和本父会话已完整确认setup的独立配置，保留角色/项目默认/其他parent/已有Worker。start只增加expected_model前置校验，不接受选型model或绕过首次问答。其他 CLI 不越过现有能力限制，OpenCode v2 已有会话仍固定模型。
- 按已核对匿名化provenance，原生child的working-directory/runtime-context通知不得单独准入或混进任务正文；在异步中间件前捕获claimed输入，保留真实用户同文和混合输入，不读取或修改个人原会话。
- 为续聊增加可选的预期模型/前序轮次校验；不匹配时在创建新运行和投递正文前拒绝，不能用任务标题代替配置。
- 增加按 Worker/runId 读取公开回复的只读入口，区分配置模型、原生观察模型、部分正文、失败、中断与结果待核实；长回复分页，不静默截断或拿最新轮替代指定轮。
- 修正现有支持矩阵中 MiniMax Plan、OpenCode v2 fork 以及被后续事实推翻的 Cursor 身份结论，明确源码 HEAD、隔离候选和在线包的区别。
- 保持首次模型/强度/角色的原生问答、同父会话归属、角色快照、队列和清理边界；不增加自动选模、隐式重试、自动新建 Worker 或全局项目默认改写。

## Capabilities

### New Capabilities

- `worker-agent-model-control`: 主 Agent 对自己已经创建的 Worker 查询精确模型目录、在空闲时配置并核验后续派遣目标的能力。

### Modified Capabilities

- `worker-run-outcomes`: 增加主 Agent 按原生运行身份读取公开完整回复和独立结果状态的契约，保留失败正文且防止跨轮污染。

## Impact

- Host 工具注册、`configureWorker`/`catalogForWorker` 的共享校验入口、续聊准入与运行结果查询；对应协议类型、提示指引和集成夹具。
- 复用 `src/host/index.ts` 既有目录/配置服务、`src/host/runtime.ts` 的空闲及账号保护、`src/host/native-agy.mjs` 的原生 init 模型一致性检查，以及存储中的 runId/公开历史。
- 需要关联测试、隔离生成 Remote 后的 Host/Client 构建/typecheck，以及获授权的真实 AGY 模型切换和结果取回验收。
- 热加载只更新本插件，保留现有 DSH 进程和 URL；更新前检查全局活动 Worker，不能为验证而停止其他会话或绕过 Gateway 鉴权。
- 不改 Harness 核心、用户 skill、包名或 0.8.2 版本；不自动提交、推送、创建 PR、安装最终整合候选或发布。既有 CLI 的真实验收缺口继续公开。
