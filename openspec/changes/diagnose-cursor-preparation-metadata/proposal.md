# Proposal

## Why

2026-10-25 当前安装包中，Cursor续聊两次在准备期被笼统的CliAccountBindingError拒绝，旧run未变、未产生新job；随后正式账号摘要为authenticated，父会话及原Worker目录均成功。因此现有证据不能证明已登出，也不能仅凭目录成功宣称续聊可用。`captureCatalogMetadata`与账号绑定异常包装丢失了安全可公开的进程阶段，妨碍继续定位。

## What Changes

- 为 Cursor binding 捕获前的入口 resolve 与现有有界元数据捕获，保留固定枚举 resolve/spawn/read/exit/timeout 的失败阶段、受限退出码/已知系统原因码等最小安全诊断，不复制原始异常消息、stdout/stderr、环境或argv。
- Cursor原生status捕获失败时给出明确的元数据调用错误，不把未知进程失败一律包装为账号登录失败；取消、清理未确认及确有原生未认证证据仍保留各自语义。
- 覆盖真实失败路径的合成反例，随后仅在空闲备份热更新后，以同一个原Worker和精确run/model前置条件核实准备阶段；没有新证据或修复时不自动重试。
- 不改变账号绑定、目录筛选、原生权限、模型/强度、Worker历史或任务准入；不新增工具参数、提问卡、登录动作或其他CLI回退。此变更只建立诊断，不预判实际故障或保证调用恢复。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `cli-connection-health`：增加Cursor准备期原生元数据故障的安全阶段诊断及证据边界。

## Impact

主要涉及Host的 [adapters](../../../src/host/adapters.ts) 元数据捕获、[cursor-accounts](../../../src/host/cursor-accounts.ts) 原生status入口及必要的账号异常透传；测试复用[metadata-cleanup](../../../tests/metadata-cleanup.test.ts)、[catalog-decoding](../../../tests/catalog-decoding.test.ts)、[cursor-native](../../../tests/cursor-native.test.ts)和[cli-account-binding](../../../tests/cli-account-binding.test.ts)，再加最小阶段/隐私反例。依据源码现状：捕获在spawn前后读流并finally终止/确认范围；Cursor只接受原生status身份；未知异常最终会退化为笼统绑定错误。Client复用现有安全错误展示，无新RPC、存储、依赖、包名/0.8.2变化，不修改Harness核心、用户账号/配置或其他CLI业务。不归档其他变更，不提交或发布。
