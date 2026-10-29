# OpenCode 2.0.31服务与私有ACP只读研究（2026-10-25，未实施）

## 来源与当前边界

原只读Agent524续接固定本机已核OpenCode程序的ELF静态审查，SHA256 `2df936a20cf74af5706020342164628f9a31978c50c2b0ad306b42b614fe245d`；下列为该二进制内字节偏移，不是实机启动证明。此轮没有启动/停止服务、调用模型、读写凭据/DB或修改原生配置。

当前正式工具已通过修好的版本gate，随后报告原生服务未运行或未登记；这不是已登出，也不能独自证明registry文件缺失。现[设计](./design.md)的shared HTTP显式纯文本deny-all范围没有因研究而扩大；真实服务/完整工具/GUI/platform待办保持。

## 公开原生生命周期

- 默认TUI root@136767600走Ba `{server,standalone,mismatch:'replace'}`，常规Ba→qu@133212580→vt.ensure；qu构造 `serve --service`。服务是detached/unref，通常不因TUI正常退出停止；但DSH管理范围是否仍会杀其后代没有动态核对，不改SDK或用nohup绕开。
- `opencode service start`为公开root命令@131942561，handler@133268728执行ensure后仅打印endpoint.url。ensure可能在多次超时后恢复/停止现有不响应服务；TUI的mismatch replace也可能替换。因此不能仅凭笼统缺服务消息就自动启动，更不能停止其他人的共享进程。
- `serve --service`前台登记，registry@133224000以0600原子记录id/version/url/pid/password，并定期核所有权；裸serve可能打印密码且不登记，不当作安全替代。
- `serve --stdio --port 0`对应私有zQ@133261700，不依赖默认registry，stdin EOF约束生命周期。stdout握手含私有endpoint，不应进入公开日志。它是合法原生进程接口，不是自行克隆账号或数据库。

## 公开ACP值得验证的后续路线

- root@131935300注册 `opencode acp`；handler@133829700直接使用上述zQ私有stdio服务，因此“没有默认shared registry”不等于原生ACP无法运行。
- config@133784462的model wire是 `providerID/id`，不是现HTTP opaque tuple；effort variants原样，不能凭别名换算。mode选择native agentID，不是Host整体read-only权限开关。
- permission桥@133797249带原生toolCall.name/rawInput及once/always/reject，new/load/fork携mcpServers。完整接入仍须保持Host模式、原生来源、MCP/工具授权与模型echo，不以选plan agent替代权限强拒绝。
- cancel@133825300会interrupt并等待有界event fiber，但不能据此声称所有owned service/tool后代已退出；仍须SDK真实范围清理及同会话恢复验收。

## 不能跳过的下一阶段检查

先更新独立能力设计，再决定private ACP或私有HTTP的实现；不把此研究直接改为“支持”。必须验证自己的home/credential-record来源、动态配置/账号变更、OAuth并行刷新锁、完整tool/approval语义、只读与写入、session恢复、取消/崩溃/晚事件、敏感握手不泄及私有服务所有后代退出。保留现v1与shared HTTP子集的回归和历史，不自动重解释旧Worker的transport/model ID，也不清理原生会话补证。

## Round7新增静态合同与严格只读断点（仍未实施）

原OpenCode研究Agent再核同一ELF SHA，仅静态读取；没有启动服务、模型、原生CLI或读真实账号/DB。下列仍是byte offset，不是实机验收。

- 私有zQ @133262014用同exe `serve --stdio --port 0`、stdin pipe、32byte随机密码仅private env，读首条私有stdout `{url}`后构SDK；不调用vt.ensure。ACP @133829700固定走zQ，公开root不接受自定义server/standalone参数。私有serve仅mode=service才读incumbent/登记；stdio EOF处理Pe @133227154监听end/close。仍需ManagedProcess范围退出/后代动态证据，不能假定静态scope=已清理。
- initialize @1338106xx没有模型目录。catalog @133782115先private plugin.list，再model.list/default/agent.list/command.list；session/new @133811407真正create/attach session才返回configOptions，所以ACP目录会有原生空session/DB留痕，不能宣称纯GET/零副作用。configOptions不暴露provider/integration/credential-record身份；不能从另起的server拿proof来冒充ACP同instance绑定。
- model wire sn @133786651是精确providerID+'/'+id，variant/effort options为原生ID及literal default；set_config_option @133813523只支持model/effort/mode，模型切换可能保留旧variant，须精确echo effort，不把缺字段猜default/高强度。mode是agentID。旧HTTP `opencode-v2:base64url([providerID,id,variant|null])`和旧ledger/transport保留，新路径须独立新Worker/model-domain，不能覆写旧记录或把选型echo冒实际生成证据。
- 全固定程序未找到OPENCODE_PERMISSION literal/静态消费者，不以旧v1环境变量声称v2保护已生效。确有OPENCODE_CONFIG_CONTENT进入private serve @133225472及config loader @1403910xx，只在child环境提供inline JSONC、不改原用户文件；但**全局deny不是权限上限**。
- ConfigAgentPlugin @140625106–1406267xx先加document全局permissions，再把每agent permissions追加到末尾。resolver jC @1402657xx为findLast匹配；最终rules @1402663xx是agent.permissions+session.permissions。用户agent级ALLOW可以覆盖inline global deny，更晚system/managed文档及动态reload也存在。Plan plugin @1408925xx还允许plan目录写入，不ban shell/unknown工具。因此不能用plan或一次读取agentIDs后的静态补丁冒严格readonly。
- 已证强deny seam是owned **session.permissions末尾deny**：Permission K @140266604先拒deny、再saved allows/hooks；SessionContext @140333982按最终rules构tools/skills/MCP。既有HTTP owned session DENY_ALL使用该类接口。可是ACP session/new只给location/additional-directory allow，setter没有permissions，纯公开ACP尚无已证严格readonly上限；空mcpServers/additionalDirectories及拒绝未知client能力也不能替代它。

下一独立实现可选择自己拥有`serve --stdio`握手的private HTTP（同instance身份/目录、owned session.permissions及cleanup），或在纯ACP只做初始化/空session选型证明且执行failclosed直到有强权限证据。不能自动启动/替换shared服务、把private HTTP偷称private ACP，或以Host代执行工具/force来补Native授权。AGY/MiniMax/Codex profiles第一批范围不因该研究扩大，现有待办和真实OpenCode闭环缺口继续保留。
