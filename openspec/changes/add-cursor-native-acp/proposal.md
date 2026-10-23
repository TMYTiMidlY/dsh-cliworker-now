# Proposal

## Why

用户要求在 fork 中加入 Cursor Agent。当前 `CLI_IDS`、账号与原生运行桥没有 Cursor，不能复用其他 CLI 的账号、模型 ID 或权限开关。父会话已零 prompt 验证当前 Cursor 的 status JSON 与 ACP v1 初始化/新建会话元数据，但尚未进行真实模型验收。

## What Changes

- 新增独立 `cursor` CLI，别名为 cursor-agent/cursor agent/cursor CLI；不接管泛称 agent，不启动 Cursor IDE。
- 从原生 status 安全投影登录信息，使用稳定用户身份绑定账号；令牌存在但用户身份不可得时保留已配置状态，不冒称远端授权。
- 通过零 prompt ACP 元数据读取原样参数化模型 ID，仅支持 default effort。
- 独立 cursor-acp-v1 传输，在 prompt 前确认模型、agent/plan 模式，严格原会话恢复、取消及进程清理。
- 范围外：API key/自定义端点、工具/MCP 注入、附件、分支、实时引导及 Windows 自动发现；不修改已安装插件、账号或会话历史，不发布。

## Capabilities

### New Capabilities
- `cursor-cli`: Cursor 原生账号、模型目录与安全 ACP 任务生命周期。

### Modified Capabilities

无；复用现有账号隔离、派遣选型与宿主生命周期基础设施。

## Impact

共享 CLI 类型与路由；Host 账号、绑定、模型发现、运行桥和路径配置；Client 使用现有设置与侧栏列表；新增模拟回归及文档。无新增依赖和数据迁移。依据为 src/host/native-acp.mjs、authorized-catalog.ts、accounts.ts 和父会话真实 status/ACP 元数据核对。模拟验证不代表真实模型或 Windows 验收通过。
