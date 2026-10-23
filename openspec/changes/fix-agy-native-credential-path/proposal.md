## Why

当前账号状态 `src/host/account-identity.ts` 和执行账号绑定 `src/host/cli-account-binding.ts` 均固定读取 `.gemini/jetski-standalone-oauth-token`。本机 WSL 的 AGY 使用 `.gemini/antigravity-cli/antigravity-oauth-token`，导致原生终端可用但插件报告未登录并阻止模型查询。修复必须贯通状态和授权，不搬动用户凭据或制造第二份认证。

## What Changes

- 将非 Windows 文件认证的状态、模型预检和账号绑定统一到当前 AGY 原生凭据路径。
- 保留有界读取、no-follow、并发替换检查、身份摘要与秘密清零行为。
- 不回退旧 jetski 文件；当前原生文件缺失、失效或不可读时明确拒绝，避免旧凭据复活。
- Windows 原生 Credential Manager 路径保持不变。
- 使用明确合成的数据覆盖正确路径、旧文件冲突、退出、轮换、非法链接与模型授权。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `cli-account-isolation`：增加 AGY 文件认证来源一致性需求。

## Impact

影响 Host 的 AGY 登录状态、模型目录预检和账号绑定，以及关联合成测试和使用说明。不修改宿主、CLI 原生文件、用户历史、包名或版本。不涉及 OpenCode、Kimi 或新增 CLI；它们分别在后续变更处理。真实远端模型/登录可用性尚未验收，合成测试不替代真实模型调用。
