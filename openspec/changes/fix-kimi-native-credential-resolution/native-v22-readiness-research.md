# Kimi 2.2 readiness只读研究（2026-10-25，未实施）

## 已核事实与证据来源

原只读Agent b865续接固定本机程序的静态审查；父随后独立读取官方2.2 tag所指commit `472192c34c1efad89a369870eff0da0b708ce9bb` 的下列公开源码。未执行新的Kimi命令、模型、登录或配置改写；不能从机制反推本机失败的唯一根因。

- [provider CLI](https://github.com/MoonshotAI/kimi-code/blob/472192c34c1efad89a369870eff0da0b708ce9bb/apps/kimi-code/src/cli/sub/provider.ts)：正规 `kimi provider list`（无json）末尾可打印 `Default model: <alias>`；`--json`只有providers/models，没有default。两者均先ensureConfigFile，故不能承诺缺配置时零写。普通行的apiJson source URL不得整份公开；后续只能私有提取单一、字符/长度受限且与同快照models精确对应的default，未知保留unknown。尚未实际核本机default与所选alias是否不同；即使不同，也不等于已证明认证失败原因。
- [同代SDK清单](https://github.com/MoonshotAI/kimi-code/blob/472192c34c1efad89a369870eff0da0b708ce9bb/packages/node-sdk/package.json)：`@moonshot-ai/kimi-code-sdk@0.21.0`明确private:true，依赖workspace包。公开registry的404为子Agent本次只读观察。源码API存在不等于正式可安装；不装另一套旧Wire SDK替代，不抽二进制内部runner或改用户default来绕过门禁。

## 公开env窄候选，不是现成修复

[configSection](https://github.com/MoonshotAI/kimi-code/blob/472192c34c1efad89a369870eff0da0b708ce9bb/packages/agent-core-v2/src/app/kosongConfig/configSection.ts)正式定义 `KIMI_MODEL_API_KEY`、`KIMI_MODEL_PROVIDER_TYPE`、`KIMI_MODEL_BASE_URL` 的provider绑定；[envOverlay](https://github.com/MoonshotAI/kimi-code/blob/472192c34c1efad89a369870eff0da0b708ce9bb/packages/agent-core-v2/src/app/kosongConfig/envOverlay.ts)以 `KIMI_MODEL_NAME`（远端model名，不是原alias）追加 `__kimi_env_model__`，保留原models/providers，只在effective配置改default。strip会移除合成model/provider并恢复raw default；这不证明CLI整个生命周期绝无配置初始化/迁移写入。

静态源码允许一个待验证组合：仅对唯一、已授权的同一原生API-key源，用上述四项创建进程私有readiness模型，随后在任何业务prompt前通过原生config setter切回原alias并核currentValue。不能把合成alias自称为原alias；`session/set_model`返回空对象本身不是echo。new/load默认门禁、setter和prompt顺序的二进制静态偏移由原审查记录：ensureReady@135202096、setSessionModel@137547252、AcpSession.setModel@137528301、AgentProfileService.setModel@136138274。

## 实施前必须补足的约束

1. 不使用OAuth token冒充API key、不借其他provider；remote model/base/key及**原生provider type**必须来自同一prepared source。现DTO不能凭apiType猜原生type；model级protocol/认证覆盖不被分类器支持则拒绝。
2. Host环境现有任意KIMI_MODEL_*拒绝仍保留。候选只进入该次子进程的私有env，绝不回流Host目录/账号绑定、argv、请求JSON或全局默认。已有保留合成名称或未知来源不能混用。
3. 不附加temperature/topP/thinkingKeep/max等推理覆盖。合成model的默认capabilities不是原模型能力；切回后必须检查真实thinking语义。[thinking实现](https://github.com/MoonshotAI/kimi-code/blob/472192c34c1efad89a369870eff0da0b708ce9bb/packages/agent-core-v2/src/llm-adapter/model/thinking.ts)按模型能力、declared/supportEfforts及原生defaults解析；不能以alias echo代替effort正确性。
4. 完整原alias和模式回执确认后才公开io.session/模型已确认、才发prompt；拒绝/不同值/未知响应/取消均零prompt。config binding及prepared/current来源前后复核，不弱化A→B→A门禁。
5. fresh session可能短暂持久绑定合成profile，再被setter更新；失败可能留下owned准备记录，不能说session历史零写或删除历史补救。成功实际推理和最终profile必须为原alias。
6. 先有明确合成反例及最小类型/关联验证，再按正式插件入口做单次真实核对，包括config内容未改、真实原alias、工具/权限、续聊及停止。此前Kimi认证失败run不因方案成立而改成功；本研究不勾选原任务的实机验收。

## Round7补充：公开ACP的稳定私有home候选（未实施）

原只读研究Agent再次核固定公开commit；父独立fetch下列关键入口与AuthSummaryService。没有新的Kimi命令、模型、真实配置/凭据/history/DB读写。该候选不是前三CLI原生鉴权profiles产品的Kimi扩容，也不证明此前失败唯一原因。

- [公开ACP入口](https://raw.githubusercontent.com/MoonshotAI/kimi-code/472192c34c1efad89a369870eff0da0b708ce9bb/apps/kimi-code/src/cli/sub/acp.ts)正常`kimi acp`直接runAcpServer({homeDir:getDataDir()})；[CLI path](https://raw.githubusercontent.com/MoonshotAI/kimi-code/472192c34c1efad89a369870eff0da0b708ce9bb/apps/kimi-code/src/utils/paths.ts)非空KIMI_CODE_HOME优先。[bootstrap](https://raw.githubusercontent.com/MoonshotAI/kimi-code/472192c34c1efad89a369870eff0da0b708ce9bb/packages/agent-core-v2/src/app/bootstrap/bootstrap.ts)将config定位为home/config.toml，sessions/blobs/store/cache/logs/credentials同home，0700/0600。可用checked非空绝对KIMI_CODE_HOME，不改整个OS HOME，不传不存在的CLI configPath flag，也不加载不可安装的私有SDK。
- [AuthSummaryService.ensureReady](https://raw.githubusercontent.com/MoonshotAI/kimi-code/472192c34c1efad89a369870eff0da0b708ce9bb/packages/agent-core-v2/src/app/auth/authService.ts)先reload，用modelOverride或真实default模型解析provider及实际auth。故在bootstrap前，令**私有**native config的default_model为本次已选真实alias，具有满足原生gate的技术路径；仍按真实API来源/ref/conflict校验，不用skipAuthCheck或四env合成alias，不将alias变成remoteID。当前用户default是否导致此前失败尚未验证。
- 不能只投影provider/model/default三个字段便宣称等价：[原生schema](https://raw.githubusercontent.com/MoonshotAI/kimi-code/472192c34c1efad89a369870eff0da0b708ce9bb/packages/agent-core-v2/src/app/kosongConfig/configSection.ts)与[thinking](https://raw.githubusercontent.com/MoonshotAI/kimi-code/472192c34c1efad89a369870eff0da0b708ce9bb/packages/agent-core-v2/src/llm-adapter/model/thinking.ts)要求保留selected真实模型完整capabilities/overrides/protocol/defaultEffort/supportEfforts等、provider原字典键及global thinking.enabled/effort/keep/forced_effort；默认effort不额外reset on/off。Native bind选中模型时解析thinking，与先合成再set_model沿用旧thinking不同，但仍需合成及实际engine证据。
- 保护策略同样必须保留：permission/deny、禁用tools、plan/loop/background等不能省略成宽松默认。依赖hooks/plugins/相对agent或profile/skill路径、未知跨模型引用的来源，若不能证明语义不变则拒绝；不复制可执行MCP/hooks，也不能以“不复制”偷换成保护等价。TOML用已核schema序列化，点号alias表键须quote，原生env引用只传精确已授权变量，现KIMI_MODEL_*全局拒绝仍有效。
- 私有home必须worker级稳定，不是每run创建后删除。原生load依赖当前home的index/journal，同worker同root/sid/project才能续聊；只让Kimi自己新建owned历史，不复制或链接原用户history/DB/locks，旧默认home会话不收养。同一source仍须原绑定在准入前后核验，不能冻结旧key绕过退出/换号；usage reader/allowRoot只授权该worker精确owned root。

后续先更新现有fix的规格/设计，再验证synthetic new/load零prompt、默认missing/wrong/OAuth但selected API有效、缺ref/conflict/来源变化零prompt、thinking和保护负例、同root/sid两轮与取消/cleanup；再正式入口单次实机。公开源码与已安装2.2二进制一致性也待核，不把源码可行或config echo冒称模型闭环。本轮只保存研究，不勾Kimi实机待办。

## 后续有限 static-API / home-delta 合同（只读研究，未实施）

下列约束仍固定同一公开commit，不冒称与已装2.2二进制完整一致或已定位Authentication required的唯一原因。首模式仅为worker-owned `kimi-native-static-api-v1`：单一已授权静态API provider/显式key或声明env引用，完整原生模型/安全记录保留，唯一有意变化为私有default_model。OAuth/keyring/发现型secondary/custom路由、未知字段或overlay拒绝，不以删除deny换默认。Host-only DTO不可由现FirstPartyModelSource重建原始完整配置，该DTO目前会丢override/安全信息，不能直接用来投影。

必须保留并逐schema核验十组：providers、models、default_model、thinking（enabled/effort/forced_effort/keep）、default_permission_mode、default_plan_mode、permission（有序rules/dangerous_command_guard）、tools（enabled/disabled）、loop_control、mcp（仅支持已核timeout，无可执行来源）。不按别CLI或模型名补字段，不统一禁用所有实验功能。

稳定私有KIMI_CODE_HOME不得复制或链接原历史/DB/锁。OS HOME、cwd/gitroot及原生安装保持，原来源绑定每轮复核；旧sid不迁移。相对OS-home/项目收集器不应被重定向或关闭。精确home-delta首模式要求原来源下这五处不存在：`H/skills`、`H/agents`、`H/SYSTEM.md`、`H/plugins/installed.json`、`H/mcp.json`。存在时先拒绝，不能偷偷复制可执行依赖或静默丢其保护。

公开源码核对入口：
- skillRoots、userFileSkillSource、builtinSkillSource及builtin：用户home collector与未改变的OS/project collector分开；agentRoots/systemFile/userAgentProfileLoader同理。
- externalHooksRunnerService只从config hooks和enabled plugin hooks加载，没有推测的H/hooks扫描；plugin manager以installed registry为入口，MCP configLoader含user/root/cwd来源。
- flagService/flagRegistryService/flagRegistry没有H持久flag文件：显式env布尔（false有效）优先于config override，再master实验开关true，再compiled默认；wait_for默认true，notify/tool-select/subagent_fork/tower默认false。不能为私有home统一禁实验；首模式不支持的experimental段/未知override明确拒绝。
- configService只从bootstrap configPath/configKey加载config.toml，其memory为进程内；没有推测的H/settings或permissions overlay。额外真实env入口包括KIMI_MODEL_*，以及web search/fetch的BASE_URL/API_KEY，不能继承成未授权provider。
- projectLocalConfigService从gitroot的`.kimi-code/local.toml`解析workspace.additional_dir，在同OS HOME/cwd下不因H改Hp而自行改语义。

这些是后续最小实现的有限合同，不是当前runtime已具备这些保护，也没有新增Kimi配置/登录/模型运行。优先补同home两轮、完整安全字段、五处delta/env/未知schema反例和真实默认门禁，再按正式CLI入口验收。
