## Why

本机 Kimi 2.2.0 原生源码支持显式 apiKeyEnv 与按 provider.type 选择的私有 env 密钥。当前插件只认 apiKey/env.KIMI_API_KEY：合成配置已复现有效 OpenAI env 被报未登录、非 Kimi provider 误用 Kimi key、忽略显式引用及凭据冲突仍可绑定等问题。当前用户实际探测为 API configured、37 个本地模型且绑定成功，不能把这些潜在兼容问题说成已证明的旧界面误报根因。

## What Changes

- 共享原生凭据分类器，统一状态、目录及绑定的来源/冲突规则；不采用无声明的环境变量回退。
- 显式环境引用仅读取所声明名称，按同一私有快照传入原生子进程；处理 Harness 的默认敏感变量清除，不复制整个宿主环境。
- 保留 API configured 与 OAuth authenticated 的区别；缺引用值显示配置未就绪，不切换其他密钥或账号。
- 拒绝未实现的全局 KIMI_MODEL_* 覆盖，防止目录与任务来源不一致。

## Capabilities

### New Capabilities
- `kimi-native-credentials`: 原生 API 来源解析及精确子进程传递。

### Modified Capabilities

无已纳管主规格替换；OAuth 文件读取与其他 CLI 保持原状。

## Impact

Host 的 Kimi status、first-party sources、绑定及启动；增加纯模拟回归与文档。无 Client 控件、核心、凭据文件、版本、安装、提交或发布变更。真实模型另需原生选型授权。
