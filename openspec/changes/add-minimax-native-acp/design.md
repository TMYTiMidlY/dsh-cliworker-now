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

优先用 record.subject/accountId 作为稳定身份；缺少时仅采用与当前 access fingerprint 精确匹配的 verified identity cache realUserID。缓存只用于确认当前主体，不能独立证明认证；tokenFingerprint 只用于相关性验证，不进入稳定主体或公开结果。账号 binding 对 data root、env、region、stable principal、native source contract 做 hash，不含 token/generation，支持同身份续期但保留所有启动重检。缺少稳定主体时返回 configured/准确说明，拒绝目录和任务，而非伪造完成。

替代方案：直接使用 account/read 只能提供状态而没有稳定主体，并可能刷新；不采用其原始响应作为绑定。token hash/generation 易随续期变化且不证明用户身份，拒绝。

### 4. 经认证的零 prompt ACP 目录

可复用 Cursor 元数据生命周期结构，但不得把 Cursor 具体 wire/身份逻辑套给 MiniMax。独立 metadata runner 使用 `[mcode, acp]`、protocol1、clientCapabilities={}、mcpServers=[]，要求 agentInfo.name=minimax-code、loadSession 与确切 sessionId，读取 new 返回 model select。公开目录仅包含安全选项值及显示名称，不返回 provider list、status raw、endpoint、身份缓存或 token。

每个模型设置后，从完整回执读取其 thinkingEffort 实际选项；只将 EFFORTS 可准确表示项映射到 UI，不扩展未知项。无控件只 default；有控件时 default 表示保留该模型原生当前值，不能选择上个模型的默认强度。目录查询前后比较独立读取的稳定账号绑定，确认元数据 child 和范围退出后才返回。原生 session/new 会留下空会话，文档如实说明，不调用未验证 delete 或删除历史。

首阶段仅支持原生 token_plan（配置缺省遵循已核实的 native token_plan 默认）和 ACP provider=minimax。当前 config.yaml 有界私有读取，minimax_api_key/custom默认路由、provider.minimax认证/endpoint覆盖、模型headers及modelRef api_key/base_url等覆盖均拒绝；内容摘要及文件版本纳入绑定，防止旧OAuth授权BYOK和A→B→A。provider list --json 不参与当前认证/模型准入；OAuth默认行、遮罩key、错误状态和任意endpoint均不是证据。当前 session/new 登录拒绝按精确固定识别映射成安全原生登录提示，不回显 RPC error 原文。

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

## Risks / Trade-offs

- [默认来源当前登录门禁拒绝] → 保留准确原生登录提示，真实目录/模型待条件满足；不能换到其他账号绕过。
- [静态身份 cache 在刷新后不匹配] → 返回 configured 而非使用旧身份，待 CLI 原生刷新身份；不拿旧 token 或 display name 兜底。
- [原生 metadata 会写运行状态或生成空会话] → 不声称完全零副作用；不写用户配置/认证，记录空会话边界，确认本次 child 范围清理。
- [进程默认权限为 auto] → prompt 前必须设置并确认 default；失败不发送 prompt。
- [共享 ACP hook 影响已有 CLI] → hook 可选且默认完全保持原行为，邻接协议回归锁定。
- [Windows 账号私有性无 ACL 证据] → 不把 stat.mode 视作 ACL 验收；未能安全证明时拒绝对应文件来源，文档明确未实测。

## Migration Plan

无账号或历史迁移。仅在新的隔离 `.cache/minimax-preview-*` 构建并验收，保留 AGY/Cursor preview、tgz 和 rollback。完成时交接所有改动及实际命令/结果；本轮不触碰已安装插件、全局 profile、版本或 Git index。部署/回滚由父会话另按已有授权及无活动任务条件处理，可继续使用原 Cursor/AGY 隔离产物，不需要重写原生数据。
