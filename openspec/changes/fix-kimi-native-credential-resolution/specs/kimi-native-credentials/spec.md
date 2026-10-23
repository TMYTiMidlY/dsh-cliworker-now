## ADDED Requirements

### Requirement: 原生凭据选择一致
系统 SHALL 使用同一分类器解析 Kimi 原生 camelCase provider 元数据，按 provider.type 匹配私有 env，不以其他提供商或未声明的宿主密钥证明账号。

#### Scenario: 类型对应的字面 env
- **WHEN** openai 或 anthropic 提供商在自身 env 中声明对应类型的 API 密钥
- **THEN** 状态显示 API configured，目录及绑定采用相同的自身密钥，不使用 env.KIMI_API_KEY 代替

#### Scenario: 已选凭据无效或冲突
- **WHEN** 已选内联值为未支持占位值，或 apiKey/apiKeyEnv/oauth 存在原生冲突
- **THEN** 拒绝授权该来源，不切换其他密钥，也不将冲突解释成 OAuth 已登录

### Requirement: 显式环境引用私有传递
系统 SHALL 仅解析 apiKeyEnv 明确声明的变量；任务和账号终端 MUST 显式传递所需私有环境项，且不得把环境值写入公开记录、argv 或原生桥请求文件。

#### Scenario: 引用缺失
- **WHEN** 声明的变量缺失或去除空白后为空
- **THEN** 显示配置未就绪并拒绝任务绑定，不回退其他环境值或 OAuth

#### Scenario: 环境清除与准备快照
- **WHEN** Harness 清除敏感继承变量，或准备期间来源发生 A→B→A
- **THEN** 只恢复明确声明的选定来源；准备快照和最后当前来源都与 admission 匹配，否则不启动模型

#### Scenario: 账号终端准备查询未完成清理
- **WHEN** 在分配PTY之前运行的原生元数据查询无法确认进程范围已退出
- **THEN** 保持该CLI的安全阻断并通知运行时，不分配终端、不准入新任务，也不连带禁用其他CLI

### Requirement: 未支持覆盖不混用
系统 MUST 在状态、目录、绑定和任务入口一致拒绝未实现的 KIMI_MODEL_* 全局覆盖，不把目录来源和实际执行来源混在一起。

#### Scenario: 全局覆盖存在
- **WHEN** 宿主存在非空 KIMI_MODEL_* 覆盖
- **THEN** 返回固定安全的未支持诊断，不发出模型 prompt 或使用另一来源的密钥
