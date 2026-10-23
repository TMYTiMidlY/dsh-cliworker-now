# Proposal

## Why

已安装的 OpenCode 2.0.31 将凭据放入原生数据库，并通过原生服务提供 integration/provider/model 元数据；当前适配器仍读取 v1 auth.json 并准备隔离 OPENCODE_DB，会把已保存账号误判为未登录，且可能误用旧协议。本次先建立真实版本识别、原生服务元数据与安全拒绝边界，不把服务目录或 credential record ID 当作可执行账号授权。

## What Changes

- 识别原生版本，默认 PATH 缺失时识别官方 ~/.opencode/bin/opencode，不覆盖手动路径。
- Linux v2 只读取默认原生服务的私有 registry，校验原生进程、版本、回环地址及读取一致性，再使用固定 GET 元数据接口。缺服务不读数据库或 v1 auth.json，也不报告未登录。
- 从当前 integration 的首个 credential connection 与 provider/model 精确关联，保留模型和数组 variants 的原生标识；原生仅报告 needs_auth、环境或未知来源时保持真实限制。候选只作诊断，不开放为可执行选项。
- v2 状态、目录、账号终端、派遣和旧会话续聊均显式版本分流，任何 v2 任务在 v1 快照、临时数据库或工具注入前拒绝；v1 路径保留。
- 后续执行阶段接通真实 owned-session，只开放显式只读纯文本：最后一条会话规则全工具 deny，不覆盖用户默认 agent，不读取/编辑文件、不调用 shell/subagent/skill/question/MCP。正常原生 UI connect 创建新 credential record、refresh 复用原 record，按同服务、record ID、启动前后重检与切换观察遵循实际来源契约，不要求数学原子 pin。
- 区分稳定来源绑定与每轮服务 epoch；使用自有会话 marker/私有无凭据 ledger、精确 model echo、耐久 input ID、按自有会话 durable SSE 恢复和对应终态。停止必须取消自有 pending input、interrupt(resume=false)、同 PID wait 后复核 active 与对应终态；本地桥退出不能证明远端结束，缺证据持久隔离。
- 仅在真实执行路径及 Host→bridge→合成原生服务回归落实后移除该路径的 metadata-only gate。编辑、工具、MCP、附件、分支、steer 和真实服务/模型/GUI/非 Linux 验收仍未完成；不扩大为完整执行验收。

## Capabilities

### New Capabilities

- `opencode-native-service`: OpenCode v2 的原生版本、受信服务和只读元数据，以及与 v1 的安全分流边界。

### Modified Capabilities

无。既有 cli-account-isolation 和 cli-model-discovery 仍控制账号授权和可执行模型；本次不以诊断候选扩大可调用列表。

## Impact

Host accounts/adapters/extended-adapters/cli-account-binding/authorized-catalog、选型入口与 settings-catalog-cache；新增 v2 元数据模块与合成 HTTP/CLI 测试；README、usage/design/settings 说明。无新依赖、不更改包版本、不启动原生服务、不读取 credential values 或改变原生数据库，不安装或发布。本分支既有 AGY/Cursor/MiniMax 内容保留。
