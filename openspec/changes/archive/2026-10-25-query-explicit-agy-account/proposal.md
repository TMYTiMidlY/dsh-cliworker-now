## Why

父会话旧账号绑定失效时，cliworker_models(cli) 按旧绑定拒绝；显式 lxy 新任务又因缺少模型强度目录报 EFFORT_REQUIRED。start/configure_conversation 已有显式账号参数，但目录查询没有对应入口，形成无法在公开工具中重新选型的循环。

## What Changes

- cliworker_models 的显式 cli 查询接受可选 agy_account=default|lxy，只读查询所指定 AGY 账号的目录。
- 显式账号查询不沿用旧绑定，不建立首次确认、不保存偏好，也不更改任何 Worker。返回明确的只读账号查询范围，不把旧配置当作新账号已确认模型。
- 省略账号时保留原账号变更保护；Worker 查询、其他CLI及原生查询过程中的身份稳定性校验不变。

## Capabilities

### New Capabilities
- explicit-agy-catalog: 在已授权的显式 AGY 账号范围内只读发现模型及强度，用于后续正式参数化选型。

### Modified Capabilities

无现有主规格需求变更；新增只读查询选择器。

## Impact

仅 Host 工具 schema、目录路由、关联测试和使用文档；不修改UI、凭据、存储格式、旧Worker或DSH核心。不重启Web服务、不发布新版本。已有其他会话的未提交改动保持，不整体提交。
