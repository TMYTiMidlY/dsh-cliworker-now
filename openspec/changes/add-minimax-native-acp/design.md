# Design

## Context

动机和范围见 proposal.md。当前通用 `native-acp.mjs` 已有协议 1、可选 agentName 校验、选项选择、历史重放抑制、额外权限拒绝和关闭等待；但其默认 model→effort→mode 流程不能直接表达 MiniMax 的进程级 Ask 权限以及延迟 Plan。Cursor 接入代码和未提交产物必须保留，不能整段覆盖公共模块。

本次实际读取已安装 MiniMax Code 0.6.12 分发源码（不导入、不运行），确认：
- 认证文件 state schemaVersion 2、storeKind=file；credential envelope schemaVersion 1、record schemaVersion 1（原生 ct=dt=1，不接受 2），Bearer、clientId=mcode-public、audience=agent-backend，原生默认 scope 为 agent.default。
- namespace 为 `<dataDir>/auth/<buildEnv>/<region>/mcode-public/`，service 为 `com.minimax.mcode.oauth.<env>.<region>`；account 为 base64url SHA256(`resolve(dataDir)/auth + NUL + mcode-public`)，records key 为 service + NUL + account。
- identity cache 在 `<dataDir>/cli-auth/<env>/<region>/account-identity.json`，version=1、status=verified、realUserID、tokenFingerprint（sha256: + 当前 trimmed access token 哈希）；cache 的 region/buildEnv 必须匹配。
- 原生模型 option ID 形如 `m:<encode provider>:<encode model>:u` 或 `m:<encode provider>:<encode model>:v:<encode variant>`；这是 opaque select value，不是 provider/model display name；原生空 variant（以 :v: 结尾）也必须原样保留。
- model 控件 category=model；permissionMode category=_permission，process scope，支持 default/auto/bypassPermissions；thinkingEffort category=thought_level，选项来自当前模型。`set_config_option` value 必须是 string，返回完整 configOptions。
- `set_mode` 通过 pendingModeIntent 安排下一 prompt 转移，返回 `minimax-code/transition=next_prompt|settled`，所以当前阶段不开放 Plan。

父会话实际零 prompt 探测：initialize 成功且 agentInfo 为 minimax-code/protocol1、loadSession=true；session/new 原生拒绝并要求 `mcode login`。SDK 存在 providers/list 字符串不等于 server 已注册，不能使用。以上不是已认证模型目录或真实任务证据。

## Goals / Non-Goals

**Goals:**
- 使用专用薄适配层，把 MiniMax 自身认证、动态选型和 Ask 模式接入现有派遣/续聊/停止契约。
- 默认严格失败关闭，但准确区分未登录、认证已保存但稳定身份未知、来源不安全和实现不支持。
- 未授权真实执行仍可通过纯合成 fixture 核对生命周期与安全边界。

**Non-Goals:**
- 不导入/复制 MiniMax 内部 runtime，不克隆 token，不改原生账号目录、配置或环境全局值。
- 不支持 internal build、任意 OAuth endpoint、自定义外部认证路由、系统密钥环自动探测或递归账号搜索。
- 不开放 Plan、工具/MCP 注入、附件、fork、steer，不编造 native token/context 统计；已有同名 SDK 能力不能作为开放依据。

## Decisions

### 1. 独立集成入口，而不是复用 MiMo

增加 minimax CLI ID、标签与 short name、aliases、RuntimeConfig/minimaxExecutable/minimaxHome、Host schema、路径发现及 Client 图标。默认 executable 为 `~/.minimax-code/bin/mcode`；Windows 需要明确路径，不推测 IDE/另一个可执行文件。账户终端使用同一数据目录和 region/env 的原生 `login` 或普通入口，不注入 prompt/斜杠命令，也不自动操作用户账号。

替代方案：借用 mimo 或通用 agent 名称会混淆 provider、模型和会话身份，拒绝。

### 2. 单一原生数据根与可重复区域决策

显式 minimaxHome（绝对路径）> 当前 MINIMAX_DATA_DIR > MAVIS_DATA_DIR > homedir/.minimax。使用同一有效根生成元数据、绑定及任务环境，仅为当前子进程设置两个数据目录变量。region 从明确运行设置/原生 MAVIS_REGION、preferences/mcode-region.json 的 regions.prod、唯一有效区域 state 选取，最后 cn。环境只接受标准发行版 prod；未知/不支持构建和冲突选择固定拒绝。不读取 shell wrapper，不自动认领其他账号根。

读取 preferences 和候选 cn/en state 只是原生选择算法的有限两个位置，不做递归扫描。仅统计 matching env/region 且处于 authorizing/authenticated/refreshing/scope_upgrade_required/expired 的状态，忽略 anonymous/error/logging_out/logout_pending；存在两个有效状态但无明确原生选择时返回歧义。空白原生数据目录环境变量按原生 trim 后回落。

### 3. 有界安全读取和稳定身份

新增 minimax-account 模块（可拆安全 state helper）只读取上述精确文件。复用已有祖先检查，增加私有目录/文件检查、lstat→O_NOFOLLOW open→fstat→有界 read→fstat/lstat，拒绝 symlink、多硬链接、特殊文件、路径替换、过大 JSON。每次操作读取 state、指定 records entry、必要 identity cache，再重读状态及文件身份确认没有并发换号。

认证检查 state/record 的 env、region、generation、clientId、audience、scope 至少包含 agent.default，当前 token 非空、Bearer、expiry/refresh 格式有效。anonymous/authorizing/logout_pending/logging_out/expired/scope_upgrade_required/error 不能靠旧 record 恢复认证。refreshing 或当前 token 有效期不足原生最低一分钟（含过期）但 refresh 存在时可展示已保存认证/待原生续期；插件不自行刷新，未确认稳定当前认证前不绑定或查目录。

稳定主体只来自与当前 access fingerprint 精确匹配的 verified native identity cache realUserID，或后续第 9 项受限固定 userinfo 验证的字符串 realUserID；未核实的 record.subject/accountId、legacy local-runtime profile 不独立授权。缓存只用于确认当前主体，不能独立证明认证；tokenFingerprint 只用于相关性验证，不进入稳定主体或公开结果。账号 binding 对 data root、env、region、stable principal、native source contract 做 hash，不含 token/generation，支持同身份续期但保留所有启动重检。普通本地摘要缺少主体时返回 configured/准确说明，正式目录/绑定可先做受限身份验证；未确认前仍拒绝模型。

替代方案：直接使用 account/read 只能提供状态而没有稳定主体，并可能刷新；不采用其原始响应作为绑定。token hash/generation 易随续期变化且不证明用户身份，拒绝。

### 4. 经认证的零 prompt ACP 目录

可复用 Cursor 元数据生命周期结构，但不得把 Cursor 具体 wire/身份逻辑套给 MiniMax。独立 metadata runner 使用 `[mcode, acp]`、protocol1、clientCapabilities={}、mcpServers=[]，要求 agentInfo.name=minimax-code、loadSession 与确切 sessionId，读取 new 返回 model select。公开目录仅包含安全选项值及显示名称，不返回 provider list、status raw、endpoint、身份缓存或 token。

每个模型设置后，从完整回执读取其 thinkingEffort 实际选项；只将 EFFORTS 可准确表示项映射到 UI，不扩展未知项。无控件只 default；有控件时 default 表示保留该模型原生当前值，不能选择上个模型的默认强度。目录查询前后比较独立读取的稳定账号绑定，确认元数据 child 和范围退出后才返回。原生 session/new 会留下空会话，文档如实说明，不调用未验证 delete 或删除历史。

首阶段仅支持原生 token_plan（配置缺省遵循已核实的 native token_plan 默认）和 ACP provider=minimax。当前 config.yaml 有界私有读取，minimax_api_key/custom默认路由、未知提供商认证/endpoint覆盖、模型headers及modelRef api_key/base_url等覆盖均拒绝；原生已知 managed-login 的显式托管 baseURL 和占位 sk-xxx 不属于自定义认证覆盖，按后续第 8 项核对。内容摘要及文件版本纳入绑定，防止旧OAuth授权BYOK和A→B→A。provider list --json 不参与当前认证/模型准入；OAuth默认行、遮罩key、错误状态和任意endpoint均不是证据。当前 session/new 登录拒绝按精确固定识别映射成安全原生登录提示，不回显 RPC error 原文。

### 5. 专用 native transport，公共 ACP 仅增加可选 hook

新增 `native-minimax.mjs` 和共享可验证状态解析模块，transport minimax-acp-v1。执行 preflight 在 spawn 前拒绝 Plan、附件、tools/MCP、fork、steer，要求精确 argv 和 task cwd。公共 runNativeAcp 可增加可选 configure/validate/update hook，并保持所有现有 CLI 默认逻辑不变。

顺序：initialize 身份/协议确认→new/load 原 cwd+session→解析模型选项→设置精确 model 并检查完整回执→从更新后状态设置思考强度→设置 permissionMode=default 并核对 category/_meta scope/currentValue→确认会话 mode=default，无 pending Plan→注册 session→prompt。不发送 set_mode 来假装同步 Plan/default 转移；加载的是 plan 会话且无法证明 settled default 时拒绝。

持续 config_option_update 应检查 model/effort/permission 的不变式；发生漂移立即 cancel 并失败。拒绝所有 unsolicited FS/terminal/permission/elicitation 请求，不能因为默认 Ask 仍需要交互而切到 auto。正文/公开思考/工具事件沿原生 ID；仅 end_turn 可成功，cancelled、max_turn_requests、错误或无终态失败。保持历史 active=false 阶段抑制。cancel 通知后等待 owned quiescence，peer.close 的失败继续现有保守阻塞。

### 6. 新 CLI 专用数据边界与 Cursor 邻接修正

父会话只读复查发现，固定异常文案本身不能阻止 `native-acp` 原始 RPC 记录和 native transport stderr 进入桥输出/持久诊断。对 Cursor 与 MiniMax 采用可选 per-run data policy，在原始协议记录和原始 stderr 到达持久/公开 channel 前抑制；仅保留经过解析的正文、公开思考、工具和安全生命周期事件。现有其他 CLI 默认行为不变。通过端到端合成 PRIVATE_* 标记同时检查 bridge stdout、stderr、native/raw、diagnostic，而非只检查 result。

同时收紧 Cursor 元数据清理的 ownStop 判定：只有已确认本次受管终止、完整元数据和实际预期 SIGTERM/SIGKILL 或对应 native 128+signal 状态组合可以接受；不能因 ownStop=true 吞掉任意 exit1/未知 signal。MiniMax 元数据 runner 采用相同边界，精确行为参考 qoder-accounts.ts 的受管结束判定。此项是父会话明确追加的相邻安全修正，不扩大其他 CLI 行为范围。

父会话最新 Cursor status 的 flags=true 但 userInfo.userId 缺失，现有 configured/no principal 门禁正确；之前的 46 模型元数据不能外推为当前真实派遣通过，记录该缺口而不弱化绑定。

### 7. 最小合成验证，不扩大成功声明

账号 fixtures 全为明确 synthetic：scope/region/generation/subject/cache fingerprint/logout/expiry/unsafe file/race/secret leakage；RPC fixtures 覆盖 agent identity、model 原样编码、模型变更后 effort、permission default 确认、延迟 mode 拒绝、额外请求拒绝、load/cancel/partial/end_turn 等。运行邻接 Cursor/AGY/native ACP/路由/能力测试及 typecheck/隔离 preview。新增运行文件显式加入 build 资源复制清单和远端 schema，不改已有 preview。

### 8. Stage 1：合法 managed 显式配置（2026-10-24）

- 最新正式 start 错误发生在 configuration 的 blanket apiKey/baseURL 拒绝处，不是本次 OAuth 登录检查。父会话只读安全投影已证明当前配置为标准原生托管形态；本增量不再读取真实配置或凭据。
- 依据原生 0.6.12 effective-auth（chunk-X3PES5WL.js 的 Qs）执行纯判别：显式 authMode 优先；省略时由已知托管 HTTPS origin 推断 managed-login，省略 endpoint 时使用既有原生托管默认。仅准入 token_plan、默认 minimax、原生 Anthropic npm 的组合。
- 明确托管 origin 仅为 https://agent.minimaxi.com、https://agent.minimax.io、https://agent.minimax.cn；使用 URL 解析后的精确 origin，无 URL 用户名/密码，不做近似域或任意 endpoint 放行。显式 managed-login 也不豁免此端点限制。
- key 只能缺省、空字符串（原生视为缺 key）或字面量 sk-xxx。它们均不是 OAuth 身份证据；普通 provider.options.apiKey 不进行 ENV 插值。显式 api-key/oauth、其他或非字符串 key、未知/畸形/非 HTTPS/含用户凭据端点、provider/model headers 与模型认证覆盖继续返回固定的范围错误，不回显原值。
- 纯 helper 仅返回安全类型化判别，不返回 raw options、key 或 URL。账号模块在原有私有读取后调用；配置指纹、文件版本、稳定主体、scope、有效期及前后重检均不改。此增量不触及 AGY 共享运行时，也不扩展 MiniMax 模型筛选或原生能力。

### 9. Stable Identity：绑定前受限 userinfo（2026-10-24）

- 静态依据：chunk-5ADYFF2U.js 的 y9i（line8307、UTF16@6433030）默认 shared-core 分支通过 tke 尝试身份验证，成功只赋进程内 g（@6434337），失败 catch 后仍可保留 token；Vbe verified 文件写入（line6968、@6118693）只由 legacy mGt/l7n 调用。account/read 无稳定 ID；runtime/authContext 为注入入口；ACP /status 需 prompt 且公开身份不含 realUserID，均不作为 bootstrap。
- 仅正式目录及 binding 的 ensureVerifiedIdentity 可做一次 metadata GET。先以原私有读取产生 Host 内部 OwnOAuthProof（不返回 Client）：root/env/region、原生选区元数据与 config 文件指纹/版本、当前 authenticated state 和 credential generation/loginEpoch/scopes/expiry/精确 token 指纹及文件 stamp。普通 readMiniMaxAccount 仍只本地，缺主体保持 configured；未满足 OAuth 契约或不足一分钟有效期不发请求。
- HTTP 精确镜像 chunk-47KWM23C.js:585：prod cn 固定 https://agent.minimaxi.com，en 固定 https://agent.minimax.io；GET /v1/api/user/info。buildUrl（@2554950）的 mcode query、fetchAccountIdentity（@2552031）的 yy/x-timestamp/x-signature 和 Bearer header 按原合同构造，不使用模型 baseURL/custom host，也不借其他目录凭据。单请求默认3秒（可取消）、redirect:error、body64KiB有界，无自动刷新/重试/renewal/revoke/login。
- 严格检查 HTTP 与存在的 statusInfo/base_resp 数值成功状态，按原生 data.userInfo/user_info 或 root 同名对象读 realUserID/real_user_id 非空字符串，丢弃其余 PII 和原始错误。只返回 stable principal hash，不返回 ID/key/URL/query/header/body。401/403或原生明确认证拒绝与其他暂不可验证分别用固定说明，均不改写原生登录状态。
- HTTP 完成、失败、缓存命中及 pending 复用后都重新读取完整 proof；source/status/generation/loginEpoch/scopes/expiry/token/stamp 改变（含 ABA）则丢弃，不允许 configured 直接启动模型。目录后验只本地核对原 verified epoch，不对已变更的新来源再次发 userinfo；同 epoch 缺本地 cache 不撤销该轮已核实的 UID。可用每来源短期内存 cache/dedupe，仅保存 principal hash、source/token-epoch 关联与时效，不长存 token、不落盘新状态、不伪写 native cache。正常续期重新验证同 UID 后 principal 保持一致；换 UID/来源失效。
- 取消隐私覆盖 MiniMax 本地 document/source/summary、ensure、原生 binding material 及正式 readCliAccountBinding 的 pre/post/catch；固定 AbortError，不回传 caller reason/cause，其他 CLI 的原取消/cleanup 优先级不变。测试覆盖 preabort、HTTP 成功后 proof 重读中 abort 及本地读取中 abort。
- 模型/effort 仍取逐模型 ACP 回执，保留 native max；不扩 API/BYOK、Plan、MCP、附件、fork、steer，不改十二槽并发及其他 dirty。已静态确认 catalog set_config_option model 使用 selectSessionModel（ACP@433927→adapter@6093089→handler@2089942），sessionId 分支 updateSession 后直接 return，且目录不传触发全局 context 写入的 contextLimit，不修改用户全局/项目默认。真实 userinfo/目录/start 与原生终端生成证据分开记录，子任务仅合成验证及新隔离 preview。

### 10. ACP 安全失败诊断（2026-10-24）

- 只在 queryMiniMaxAcpModels 的既有流程增加类型化诊断。阶段固定 spawn/initialize/session_new/initial_state/select_model/selected_state/stop/exit/cleanup，原因固定为I/O、帧、RPC、合同、缺模型/权限控件、无支持provider、模型不符、超时/取消、大小、过早/异常退出及清理未知等枚举。首次失败阶段/原因不可变，异步reader和finally不得覆盖；最终退出和cleanup单独投影。
- init/state仅生成匹配或存在性bool；RPC code、exit code/signal仅固定白名单否则other/none，row为0至1024的有界数字。不输出任何原始agent/model/label/category、session/请求ID、正文/stderr/header/token/URL/PII/摘要hash/私人路径、原始异常/stack/cancel reason/cause。固定错误短句附安全token，不新增Remote schema、持久日志或配置。
- Native稀疏控件只诊断不接纳；逐模型max/成功wire、15秒/字节限制、停止及ProcessCleanupUnconfirmed门禁不变。清理未知保持原typed error优先，可附只白名单诊断供Host测试/固定提示，不把清理失败冒充已确认。
- 所有新增验收使用synthetic backend/frames，无真实CLI/HTTP/模型/账号读取。保留Host延期与并发全部源码，新的隔离preview含Remote及postgen types通过后交权；诊断实现完成不代表实际目录根因已修复。

### 11. 仅选择模型内部错误的固定枚举（2026-10-24）

- 仅phase=select_model且RPC严格等于数值-32603提取。Native ACP Pg@357334将Error.message解析为error.data，不能按外层Internal error区分；优先精确匹配data.details，结构化只读直接code/key/message，不递归解析或substring匹配。
- 固定literal来自Native Um/Mp（chunk-47KWM23C.js:4891@7399226/@7399572）：Invalid model reasoning、variant、reasoning/variant conflict、reasoning/effort conflict、thinking.effort、context_limit；另核Session not found、provider_id and model_id are required、Runtime does not expose Model Application.、Desktop model provider service is not configured。只输出对应enum，未知一律native_error_other。结构化SESSION_NOT_FOUND/MODEL_PROVIDER_UNAVAILABLE可映射对应大类，VALIDATION_ERROR本身不能推断参数；相互矛盾的已知结构化分类保守为other。
- envelope_kind固定details/structured/absent；details指直接string details，structured指其它普通对象，absent指没有支持的对象envelope。分类作为首次失败snapshot的一部分冻结；只有该phase/code附安全token，其他情况message/成功目录保持原样。无原文、长度/hash/stack/URL、未知key/code值外泄，无Remote/日志/配置新增；仍由父会话下一次正式models取得枚举后按证据修。

### 12. 精确配置拒绝隔离、验证子集与幂等选择（2026-10-24）

- 仅pending确为set_config_option/model、本轮初始广告exact value、当前owned session及当前row，phase=select_model、数值RPC=-32603且exact安全param_reasoning时，拒绝该pending为私有typed配置拒绝，不调用全局fail/terminate、不污染fatal RPC/native字段。不吞其它参数、码、phase、取消、超时或late reply。
- loop只catch该私有class，按exact opaque tuple去重计拒绝。下一tuple前在同child/原source/原15秒预算创建新owned空session，检查session ID不复用、初态strict及完整广告ID集合与最初相同；次序/label不作authority，新广告不能加入。每tuple至多一次、session数至多初始支持配置N，不发prompt、不写全局默认或删除历史。新初态、后态、未知RPC、字节/时限等仍fatal。
- strict state已确认当前model等于该广告tuple时直接取其真实effort；其余必须set且strict确认精确model，不复制旧effort。至少一项才返回。私有query/discover返回{models,notice}接既有ModelCatalog.notice，无shared/Remote变化；partial通知广告N/verifiedX/精确拒绝Y，不称模型不可用。末尾range/source/identity及首fatal冻结规则保持。
- 专用configureMiniMax先target广告有效性，exact current model才no-op；随后只在该model receipt下核requested effort，非default且exact current effort相同才no-op，否则set+confirm。permission默认Ask仍取fresh回执并做最后model/effort/default mode漂移核对；不改变shared native-acp或Plan等能力。

### 13. 元数据启动环境与账号快照隔离（2026-10-24）

metadata runner向ProcessBackend传递source.env的独立副本，不把账号快照的可变对象借给进程后端。后端即便附加自身环境字段，也不得改变已核对的source对象或造成来源后验误报。账号比较、私有epoch、凭据及文件ABA规则保持不变；真实来源变化仍整份拒绝。本防护有独立可重现的synthetic反例，但不能在正式实测前称为本机当前失败的已证实根因。

### 14. 来源后验差异的固定分类（2026-10-24）

sameSnapshot授权表达式保持不变。仅在拒绝后用私有WeakMap保存的无token文件版本分量区分state、credential、identity cache、source字段或未登记/待原生续期；对外只给固定enum，不输出任何原值、路径、指纹或主体。成功userinfo投影携带同一私有版本分量，不补造epoch。该分类不能把拒绝改成准入，真正来源变化及ABA仍整份拒绝。

### 15. 配置内容绑定与私有操作版本（2026-10-24）

- source.configuration仅完整config raw fingerprint（先过既有安全读取/route parser），不再把inode/ctime写入持久绑定。缺文件保持真实default sentinel且清root旧ledger，不伪造文件。其它source字段和原sameSnapshot授权表达式不改。
- 私有sourceConfigurationEpoch WeakMap绑定source对象，每root last-config registry≤64，只存fingerprint/安全stat/随机版本，无原文或凭据。相同raw和stamp复用；相同raw、不同inode、同dev/size/mode/nlink/uid/gid且既有owner/private检查成功的原子替换也复用并更新observed stamp。其它触碰产生新版本；缺失/不安全读取清ledger，淘汰后重读只能导致旧操作拒绝。每次安全内容读在route拒绝前也记版本，已观测API等变化不能被后续A覆盖。
- readOwn前后除source JSON外还核私有config epoch；OwnOAuthProof.epoch纳入该版本，accountSnapshotParts加入私有configuration版本并由成功userinfo clone继承，分类只给source-configuration-version固定enum。userinfo/cancel/TTL及state/credential/cache指纹+全戳保持；普通稳定binding A恢复A相同，但跨操作中的in-place同内容触碰/ABA失效。
- 明确边界：same-content atomic replace不等于已证明Native写入；仅最终快照不能辨认具有目录写权限的对抗者未被观测的atomic A→B→A，不能宣称所有配置ABA都检测或完整文件事件溯源。不新增权限、守护服务、文件watch框架、Native补丁/参数或复制用户配置，实际source/credential变化照旧拒绝。

## Risks / Trade-offs

- [当前认证仍待独立核对] → 旧原生登录拒绝与新配置层误拒分开记录；配置兼容修正不证明当前已登录。真实目录/模型待父会话独立验证，不能换到其他账号绕过。
- [静态身份 cache 在刷新后不匹配] → 本地摘要保持 configured；正式绑定可在当前有效 proof 上做一次固定 userinfo 验证，不要求盲清登录、不拿旧 token/display name 或 legacy profile 兜底。
- [原生 metadata 会写运行状态或生成空会话] → 不声称完全零副作用；不写用户配置/认证，记录空会话边界，确认本次 child 范围清理。
- [进程默认权限为 auto] → prompt 前必须设置并确认 default；失败不发送 prompt。
- [共享 ACP hook 影响已有 CLI] → hook 可选且默认完全保持原行为，邻接协议回归锁定。
- [Windows 账号私有性无 ACL 证据] → 不把 stat.mode 视作 ACL 验收；未能安全证明时拒绝对应文件来源，文档明确未实测。

## Migration Plan

无账号或历史迁移。仅在新的隔离 `.cache/minimax-preview-*` 构建并验收，保留 AGY/Cursor preview、tgz 和 rollback。完成时交接所有改动及实际命令/结果；本轮不触碰已安装插件、全局 profile、版本或 Git index。部署/回滚由父会话另按已有授权及无活动任务条件处理，可继续使用原 Cursor/AGY 隔离产物，不需要重写原生数据。
