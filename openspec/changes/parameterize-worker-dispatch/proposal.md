# Proposal

## Why

用户明确要求 CLI Worker 不直接向人提问，而由 Agent 在工具调用中指定选型。现有 start 虽接受 model/effort，首次角色、项目沿用和双版本 Qoder 仍可能弹问题卡，妨碍程序化调度。

## What Changes

- **BREAKING**：start 改为参数化派遣，不生成选型、角色、沿用或 Qoder 版本问题卡；缺少必要输入返回可补参的错误，不创建任务。
- 显式 model/effort/role 经过实时目录与预设校验；缺省先复用当前父对话完整设定，再复用同项目同 CLI 有效完整设定。没有完整设定且未传 model 时不猜模型。
- 首次显式模型但省略角色表示不使用预设；role 可指定精确预设 ID 或 none。已有 Worker 的角色快照不变。
- 提供只读 cliworker_roles；更新工具与路由指引和使用文档。实际权限、账号、并发与停止边界不变。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `worker-dispatch`：选型输入、缺参拒绝、复用与并发取消、入口指引改为非交互契约。

## Impact

Host 工具注册/选型路径、路由提示、派遣测试与使用文档；无凭据或存储格式迁移，不更换 CLI、不修改宿主核心、不自动提交或发布。
