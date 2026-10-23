# Proposal

## Why

用户明确要求加入 MiniMax Code（mmx）。当前源码在 `src/shared/types.ts`、账号管理、目录发现和原生桥中没有独立 MiniMax 入口，不能把它等同于 Xiaomi MiMo 或套用其他 ACP CLI 的权限、模型及认证规则。本机 MiniMax Code 0.6.12 的静态源码和父会话零 prompt 探测已确认 ACP v1，但当前默认来源的 `session/new` 返回原生登录要求，尚没有已认证目录或真实任务成功证据。

## What Changes

- 新增规范 ID `minimax`，仅接受 minimax、minimax code、mmx、mcode 别名，默认稳定入口 `~/.minimax-code/bin/mcode`；与 `mimo` 的账号、配置、Worker 和协议完全独立。
- 明确选择原生数据目录及 prod/cn 或 prod/en 路由，提供可选 `minimaxHome`；优先使用显式目录，其次当前 `MINIMAX_DATA_DIR`、`MAVIS_DATA_DIR`，最后 `~/.minimax`。不扫描或自动选用其他 shell 包装账号目录。
- 对当前自身账号进行有界、私有、无链接且前后身份一致的读取；核对 state、credential、scope、generation、region、client/audience 与稳定身份。只输出脱敏状态，令牌及身份缓存不进入 Gateway、日志或测试快照。
- 从经原生认证门禁的零 prompt ACP 会话读取准确模型选项。模型 ID 为原生不透明选项值，模型切换回执之后重新读取 thinkingEffort，仅提供实际支持的强度。`provider list --json` 的默认 OAuth 行和 SDK 的 providers/list 字符串不证明登录或可执行目录。
- 新增独立 `minimax-acp-v1`，要求协议版本 1 和 `agentInfo.name=minimax-code`；prompt 前确认精确模型、强度和进程级 Ask 权限 `permissionMode=default`。支持同 cwd 精确恢复、抑制历史重放、原生取消和完整进程范围清理。
- 暂不开放 Plan、附件、工具/MCP 注入、fork 或实时 steer。原生 Plan 具有 next_prompt 延迟转移，不能套用通用立即确认规则；不使用 auto/bypassPermissions。非预期文件、终端、权限和问题请求全部拒绝。
- 登录失败、身份无法确认和插件尚不支持分别说明；首阶段仅开放标准 token_plan / ACP minimax provider，API/custom来源及提供商/模型级认证、服务或请求头覆盖拒绝，当前配置摘要和文件版本纳入账号绑定；保留明确失败门禁，不为完成接入而虚构已登录、可用模型、统计或成功结果。

## Capabilities

### New Capabilities

- `minimax-cli`: MiniMax Code 的独立路由、自身账号、动态选型和安全 ACP 单轮/续聊生命周期。

### Modified Capabilities

无。复用既有自身账号隔离、明确派遣、元数据清理和任务准入基础设施；新增 CLI 的具体原生契约由 `minimax-cli` 持有，避免改写其他 CLI 的行为。

## Impact

影响 `src/shared/types.ts`、CLI 路由/路径/配置/Gateway schema、账号和绑定、模型目录、native worker/bridge/ACP 可选扩展、Client 标识及能力矩阵、隔离构建资源、回归测试和文档。无需新增第三方运行时依赖或导入 MiniMax 内部代码。

实现依据为已安装 0.6.12 包的 `run-acp-command-MV4O4NBX.js`（模型选项、permissionMode、thinkingEffort、延迟 mode）、`chunk-QJ2FEPC2.js`（原生认证命名空间/模式/区域）、`chunk-5ADYFF2U.js`（当前令牌绑定的原生身份缓存），以及本仓库 `src/host/native-acp.mjs`、`cursor-models.ts`、`cli-account-binding.ts` 和现有模拟 ACP 测试。父会话 initialize 成功只证明协议；session/new 的原生登录拒绝必须保留，不描述为插件误报。真实模型、已认证目录和 Windows 验收仍待授权/条件满足。

范围外：不修改已安装插件或 `~/.dsh`、不移动原生账号/历史、不发布、提交、推送或增加版本号；保留所有现有 AGY/Cursor 未提交修改和隔离产物。
