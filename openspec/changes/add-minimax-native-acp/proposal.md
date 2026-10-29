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

## Stage 1 Follow-up（2026-10-24）

父会话最新正式派遣在配置层被拒绝，尚未进入本次 OAuth 校验，不是已证明的登录失败。安全投影显示当前是原生默认 token_plan、minimax 提供商与 Anthropic npm，options 仅有原生占位 `sk-xxx` 和 HTTPS、无 URL 用户凭据、origin 属于原生托管集合的 baseURL。现有“出现 apiKey/baseURL 即拒绝”误伤该标准配置。

本增量仅增加纯有效路由判别：先按显式 authMode 决定，再按已知托管 origin 推断，结合 token_plan、默认提供商及 npm 核对；接受原生托管显式 endpoint 和占位 key，不把占位当身份。真实 key、API/oauth/custom 或未知服务与模型级认证/请求头覆盖仍不在本阶段支持范围；不清配置、不改 OAuth 主体/有效期/私有读取及来源 ABA 快照。不在本增量开放 API/BYOK、Plan、MCP、附件、fork、steer，也不宣称真实账号或完整能力验收通过。

## Stable Identity Follow-up（2026-10-24）

Stage1 已部署后，父会话正式 models 越过配置门禁，准确停在“认证已保存，但当前稳定账号身份无法确认”。用户另报告原生终端 hello 正常生成、M3.1-Flash / 订阅限免 / Effort max；这证明原生生成可用，不证明插件已获得稳定主体，也不证明本次 userinfo 请求成功。

静态 0.6.12 默认 sharedAuthCore 启动分支尝试 userinfo，即便成功也仅保留进程内身份；失败亦可保留有效 token 继续生成。既有 account-identity.json 的 verified 写入只在 legacy 分支，因而要求用户再开 CLI 并不保证补齐缓存。本增量在正式绑定/目录之前，用当前已验证 OAuth proof 请求一次原生固定区域 userinfo，取得字符串 realUserID 后前后重核，才允许后续模型准入；普通账号摘要不隐式发网络。仅严格当前 token 关联的 verified native cache 或该受限 userinfo 可提供主体，不再用未核实 record.subject/accountId 或 legacy profile 凑数。所有网络测试合成，真实 API/CLI/模型、安装与打包仍由父会话另行处理。

## ACP Safe Diagnostic Follow-up（2026-10-24）

身份增量已由父会话独立复验并部署，最新正式 models 已进入 ACP 目录的通用失败；这既不证明本次 HTTP 路径一定成功，也不是目录或模型通过。静态0.6.12 initialize/new/选项合同总体吻合，但 mt 可返回稀疏控件，15秒总预算、输出/帧/退出也都被当前通用提示抹去。本次只增加阶段、原因、布尔检查和固定白名单RPC/退出值的安全诊断，保留不可变首错与独立清理状态。不得猜根因、放宽解析、补假控件、改变预算/Native配置、重做身份流程或触碰刚上线Host延期；由父会话下一次正式 metadata 读取定位后另行修复。

## Select-model Internal Error Follow-up（2026-10-24）

父会话部署安全诊断后的一次正式 models 已证实：init/初态/4个minimax广告项通过，首条model setter返回-32603且cleanup已确认。已排除本次稀疏控件/时限/帧/退出；请求string value与Native schema吻合，仍不能断言内部根因。原生Pg将未处理Error.message解析成error.data或details，外层只显示Internal error。本增量仅对select_model且数值RPC=-32603，在Host内精确白名单匹配已核Native固定details literal或结构化已知code/key/message，输出native_error/envelope_kind枚举。未知为other，不回显原文或按泛VALIDATION_ERROR猜参数，不修wire/身份/effort、不开新目录/服务或放宽门禁。

## Validated Configuration Subset Follow-up（2026-10-24）

父会话下一次实机证据已明确为param_reasoning：原生拒绝当前广告配置的reasoning取值策略，并非own undefined、max或登录失败。现授权从诊断转功能：仅隔离pending作用域严格匹配的exact配置拒绝，拒绝后用同owned进程干净空session严格确认原广告集合，再验证其余tuple；只发布实际确认的模型/effort子集并用现有notice明确数量和限制，不把整个模型判不可用。catalog与专用run保留upstream精确当前值no-op，不重设已确认model/effort；不同选择仍setter+strict验证。未知错误/后态/来源/清理全failclosed，15秒和单CLI进程不增，可能留下有界多个owned空会话。此为功能候选，父会话随后正式模型选择和真实任务验收，不继续仅诊断循环。

## Same-content Atomic Config Save Follow-up（2026-10-24）

父会话已受控实测Native查询后config.yaml原字节及语义完全相同、dev/size/mode/nlink/uid/gid不变，但inode/mtime/ctime变化。原绑定把配置inode等同账号source，令正常Native原子save永久后验失败。本次只分离稳定内容与操作内版本：source.configuration/Binding route用完整安全config raw fingerprint，私有每root有界64 ledger和source WeakMap追版本。同raw同stamp或安全同内容新inode原子替换可继承版本；其它改变、缺失/不安全读取/淘汰均使旧操作安全失效。state/token/credential/cache全戳保持。

这是账号source语义修正，不是移除认证。快照无法证明原子替换由哪个进程写入，也不能完整侦测未被观测的atomic A→B→A；不再宣称完整配置事件溯源。已观测内容/路由变化及in-place ABA仍拒绝，稳定binding在相同来源A恢复A时相同。真实CLI/模型验收仍由父会话后续执行。

## Capabilities

### New Capabilities

- `minimax-cli`: MiniMax Code 的独立路由、自身账号、动态选型和安全 ACP 单轮/续聊生命周期。

### Modified Capabilities

无。复用既有自身账号隔离、明确派遣、元数据清理和任务准入基础设施；新增 CLI 的具体原生契约由 `minimax-cli` 持有，避免改写其他 CLI 的行为。

## Impact

影响 `src/shared/types.ts`、CLI 路由/路径/配置/Gateway schema、账号和绑定、模型目录、native worker/bridge/ACP 可选扩展、Client 标识及能力矩阵、隔离构建资源、回归测试和文档。无需新增第三方运行时依赖或导入 MiniMax 内部代码。

实现依据为已安装 0.6.12 包的 `run-acp-command-MV4O4NBX.js`（模型选项、permissionMode、thinkingEffort、延迟 mode）、`chunk-QJ2FEPC2.js`（原生认证命名空间/模式/区域）、`chunk-5ADYFF2U.js`（当前令牌绑定的原生身份缓存），以及本仓库 `src/host/native-acp.mjs`、`cursor-models.ts`、`cli-account-binding.ts` 和现有模拟 ACP 测试。父会话 initialize 成功只证明协议；session/new 的原生登录拒绝必须保留，不描述为插件误报。真实模型、已认证目录和 Windows 验收仍待授权/条件满足。

范围外：不修改已安装插件或 `~/.dsh`、不移动原生账号/历史、不发布、提交、推送或增加版本号；保留所有现有 AGY/Cursor 未提交修改和隔离产物。
