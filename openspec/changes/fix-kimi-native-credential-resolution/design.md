## Context

已实测 Kimi --version 为 2.2.0。原生 CLI provider list --json 保留 camelCase apiKeyEnv 引用和 provider.env 字典；不会展开任意引用。静态原生 provider-credential/model-auth/connection 源码表明：非空 apiKey/apiKeyEnv/oauth 冲突拒绝；显式引用缺值报错、不回退；类型 env 映射为 kimi→KIMI_API_KEY、openai/openai_responses→OPENAI_API_KEY、anthropic→ANTHROPIC_API_KEY、google-genai→首个非空原始 VERTEXAI_API_KEY/GOOGLE_API_KEY 后再 trim。原生后层可能使用环境默认值，但插件继续要求显式归属。

## Goals / Non-Goals

统一可核验来源；秘密只在 Host 内存及显式子进程 env；API 状态不冒充 OAuth。无模型生成、登录/退出、配置迁移、Google 模型协议扩展或全局环境模型覆盖支持。

## Decisions

1. 新纯分类器保留 selected-invalid/unresolved/conflict 等区别，不在无效已选凭据后改选其他来源。冲突先于占位值过滤。
2. apiKeyEnv 名称和值按原生 trim；仅解析明确声明的名称。运行时工具桥保留变量、控制字符及不安全名称拒绝；引用缺值不授权。provider.env 是私有字面值，不是 shell 引用。
3. 敏感环境被 DSH 默认清除，故显式引用的值必须在选定 native source 上生成 private modelEnvironment；任务只传入所选模型声明的键。原生桥 request.json 不含 env。
4. 准备来源快照和最后当前来源均必须匹配 admission binding，阻止 A→B→A 时把准备好的 B 密钥送进 A 的任务。引用字段变化也进入来源指纹。
5. 原生账号终端只传明确引用且已解析的必要变量；不导出任意宿主凭据。已有 provider/model 路由及 OAuth 安全门禁保留。
6. 状态、目录和执行统一拒绝已存在的全局 KIMI_MODEL_* 覆盖，不静默改变用户原生配置。
7. 保留变量拒绝忽略ASCII大小写，避免Windows引用别名覆盖桥控制环境。终端分配前的元数据查询同样必须确认范围退出；无法确认时记录该CLI的unsafe query并通知runtime，不能因无PTY对象而释放为可用。

## Risks / Trade-offs

原生未来类型或复杂认证保留未支持状态；不发明 vertexai env 映射。provider/model credential override 冲突不转成 OAuth 成功。局部模拟与本地配置读取不能代替用户旧 GUI 问题复现或远端授权验证。

## Migration Plan

无数据迁移。保留先前 AGY/Cursor/MiniMax/OpenCode dirty 工作与所有构建/回退包；独立预览验证后才准备候选，安装需再次确认。
