## Why

当前已安装 Host 在新建 AGY Worker 前串行执行三次完整原生模型目录预检，每次走 captureCatalogMetadata 的独立 15 秒期限；单独 cliworker_models 只执行一次。现场 default/lxy 均出现目录偶尔成功而启动在产生 Worker/job 前 timeout/aborted。源码确认该短期限及错误分类缺口，尚不能把现场失败归因为厂商额度或认证。

## What Changes

- 仅为 AGY 原生模型目录提供 60 秒的有界元数据预算；其他 CLI 默认 15 秒和任务期限不变。
- AGY 使用既有脱敏元数据诊断，区分内部期限、调用者取消及清理不确定，不暴露命令、凭据或原始输出。
- 原生设置检查与目录进程、身份检查使用同一已选择 HOME，避免 lxy 误读 default 设置。
- 不删除任何账号绑定、模型/effort、权限、项目、角色、并发或排队后重验；本轮不做目录缓存或三次查询的结构性去重。

## Capabilities

### New Capabilities
- `agy-catalog-preflight`: 原生目录预检的有界等待、取消与诊断契约。

### Modified Capabilities

无；既有身份与派遣门禁保持。

## Impact

仅 Host adapters 的 AGY 目录调用和关联回归；无 Client、持久存储格式、账号配置、全局并发或权限改动。隔离构建/回归后才做本机更新，真实恢复仍须由正式 cliworker 入口取得 Worker/run 和原生结果，不能用模拟通过替代。当前仓库既有dirty保全，不自行发版；最终按本次用户已明确授权的保守收口统一核归属、提交并推送原分支，不将本change当成独立发布授权。
