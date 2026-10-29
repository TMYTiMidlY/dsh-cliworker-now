# Design

## Context

动机见 proposal.md。当前工具注册只暴露 resolve/start/status/followup/stop；`catalogForWorker` 和 `configureWorker` 已服务于界面，却没有主 Agent 的对应入口。`runtime.configureWorker` 已拒绝 busy、待发消息、跨 CLI 及 OpenCode v2 变更；`native-agy.mjs` 已验证 init.model 与本轮 preference.model 一致。应补齐控制面而非另写 AGY 启动器。

已回读的真实使用记录表明：标题为 Opus 的任务回执仍配置 Argon，并被及时停止；后续存在同模型重复审阅、启动前无 Worker 的超时，以及有正文但 stream interrupted 的失败。转录工具对附件和部分 job 事件有损，故这些记录不能单独定位超时底层原因。私有会话证据保留在忽略目录，不将原始题目、会话日志或个人运行标识写入新公开规格。

## Goals / Non-Goals

**Goals:**
- 用最小 Host 工具控制面实现“首次原生选型 → Argon → 空闲时切 Opus → 同会话续聊 → 按 runId 取回并核验”。
- 复用 UI 与后台一致的账号、队列、生命周期及 transport 能力门禁；把已配置和已观察严格分开。
- 限定关系为当前父 Agent 自己的 Worker，不修改正在审阅的其他主会话或其题目状态。

**Non-Goals:**
- 不增加 start 的绕过首次模型/强度/角色问答参数，不自动回答选择卡。
- 不做生成过程中的热替换，不自动 stop/clone/retry，不设计通用批量学术审题状态机。
- 不开放已关闭的 CLI 工具/附件/fork 能力，不假定 Opus 配额存在；不因本次改动宣布四个新适配均已实机成熟。
- 不重启 DSH、不改核心或现有 skill、不变包名/0.8.2，不自动 commit/push/PR。

## Decisions

### 1. 独立且有界的模型控制工具

拟新增 `cliworker_models` 和 `cliworker_configure`，都使用与其他工具一致的 worker_id/worker_name 解析。models 返回目录中的准确 id、label、efforts；configure 只接受目录给出的准确 id 与有效 effort。复用并适度提取现有 `catalogForWorker`/`configureWorker` 核心校验，避免工具通过公开 Remote 伪造调用身份，亦不让 UI 与工具分别实现安全边界。

配置仅保存 Worker.preference，保留创建时角色/权限及原生 conversationId，不改项目默认或同主对话已确认的后续新 Worker 设定。因此每题可以仍从 Argon 默认新建，该题结束后只切其自身到 Opus。拒绝“从提示词提取模型名”方案：它不具备可靠的选择和授权语义。

用户补充的新任务首轮选型要求采用独立 `cliworker_configure_conversation`：`cliworker_models` 支持互斥的明确 cli 查询，不需 Worker 但不建立 setup；仅当前 parent/project/CLI 已有完整原生确认 setup 才能精确换模型/强度，保留 role，缺失为 FIRST_SELECTION_REQUIRED。与 chooseDispatch 共享同一 selection 锁，异步目录和授权后重检 setup/source/权限/project，再仅 setConversationSetup；不写 project default、其他父会话或已有 Worker。普通 start 不新增选型 model 参数、不绕首次问答；仅新增 expected_model 前置条件，对配置回执实际 configuredModel 复核，防止两个工具调用之间并发改回旧设定。确认快照/异步授权/最终同步准入均检查，不匹配零 Worker/零 prompt。配置后新 Worker 第一条实际 prompt 就是新模型，禁止先派旧模型空任务再配置。

配置工具执行前应用父 Agent/宿主权限检查，必要时复核账号；在真正原生执行前仍强制现有 live authorization。legacy 绑定缺失、查询取消及不支持的 transport 继续失败关闭。目录不是远端 entitlement 保证。

### 2. 校验与派遣保持原子边界

拟在 followup 增加可选 expected_model 与 expected_run_id，分别是前置条件而非隐式配置参数。校验必须放进现有准备/准入串行区，并在异步准备后复查，不能只在工具入口取一次快照。运行、清理、队列和原生 inbox 竞争沿用已有锁；拒绝时不创建 run、不提交正文。

配置不声称在途模型已切换。AGY 下一轮仍通过现有原生 argv/conversation 和 init.model 一致性检查取证，不读取正文里的“我是 Opus”作为证明；任何 native mismatch 不计为目标模型完成。

匿名化运行证据另外确认原生 child 将 source.kind=working-directory 的系统通知当成同一外壳 turn 的第二次 CLI 请求，覆盖最新 run；真实用户则为 source.kind=user（可含 rpcId），runtime-context 有独立 source/sections。最小扩展是在 await next 前复制 claimed 输入，并按 typed provenance 消费 working-directory/runtime-context；后续中间件追加的指令不成为任务正文。首次挂接/投影 sentinel、真实 user/Tool、同文用户请求与混合批次必须继续正确准入；不按通知正文匹配，不读写真实个人会话。

### 3. 按 runId 读取，而非只扩大 status

拟新增只读 `cliworker_result`。status 保持兼容，result 返回 workerId/runId、运行状态、公开正文、错误/部分性、该轮 configuredModel 与 observedModel，以及有界分页游标。指定轮不存在不退回最新；不依赖内存 job 仍存在，也不靠固定子会话 entry 序号。

优先复用本轮历史与安全公开投影；如现有历史不足以保留该轮配置，新增最小的每轮摘要，按既有私有目录/原子写规则持久化。旧记录缺证据时返回未知，不迁写原文。分页绑定确定的 worker/run/公开事件水位，增长中的运行明确快照边界，避免多页重复和漏字；不把公开思考、工具载荷或 native raw-wire 混入最终正文。

### 4. 不把超时猜测当作已修根因

现有证据只能区分“无 Worker 回执的失败”和“有 run 的失败”，无法确认每次超时是目录、问答、网络还是 native 生命周期原因。本阶段优先补明确配置回执、预期模型前置条件和结果入口；若实现中补错误阶段信息，只给已证明阶段及是否建立 Worker，不引入盲重试或假定未执行。

### 5. 只热更插件，不重启宿主

新隔离预览生成 Remote 后执行 Host/Client 构建与 typecheck，保留旧包和回退配置。部署前核对全部活动 Worker；若有其他会话忙碌则不热卸载或停止它们。使用现有 profile 插件热加载流程，核验原 DSH PID 和 URL 保持；页面端需要刷新时如实告知，不把 HMR receiver 当作 dev:web watcher 存在。Gateway 返回401不读取凭据绕过。

待实测候选基于当前分支，也可能同时包含此前尚未在线安装的 Kimi/OpenCode v2 等代码，不能假称其安装影响只有 AGY。在 apply 时核对包变化，向用户说明实际候选范围并取得对应热替换授权；对AGY实测的许可不等于四CLI整合候选已获验收。所有历史和账号保持不变。

## Risks / Trade-offs

- [目录显示 Opus 但账号无调用额度] → 原生错误如实返回，仅该项实测未通过，不借其他账号或再跑 Argon充数。
- [同一 Worker 被 UI/Agent 并发修改] → 共用空闲/队列/准备门禁，预期 run/model 在准入时复核，冲突返回明确原因。
- [旧轮缺配置模型或模型观察] → 返回未知而不是读取当前 preference，新增字段只保证新轮可核查。
- [长回复读取内存膨胀或跨轮污染] → 页大小和游标均有界，绑定 worker/run/水位，测试完整拼接与并发追加。
- [热卸载中断其他真实任务] → 忙碌检查，推迟热替换而非强停；保留旧包，整个过程中不重启 DSH。
- [PR把实验支持说成全面成熟] → 支持矩阵、测试证据及未完成清单同时更新，明确旧在线包与新源码/候选的差异。

## Migration Plan

1. 增加 Host 工具和可兼容的可选参数/每轮摘要，旧工具调用不受影响；不更改原历史布局或清除数据。
2. 通过协议、权限、模型混淆、父会话隔离、长回复和真实 Host/bridge 夹具，构建独立候选。
3. 在已有授权和全局空闲条件下热加载，保留同一 DSH 进程，先检查新工具 schema，再做最小只读 canary。
4. 仅新建本父会话自己的测试 Worker；Argon 记忆 nonce后，配置目录里的精确Opus，同原生 conversationId 回复nonce并核验 init模型；读取两轮结果，确认互不污染。
5. 回退只替换本插件候选并保留新写的兼容元数据；不删账号、原会话、失败正文或其他用户工作材料。
