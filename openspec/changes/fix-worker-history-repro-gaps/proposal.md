# Proposal

## Why

用户要求同时审查归档及未归档 DSH 的 CLI Worker 使用历史，只修复在当前实现可复现、尚未解决的问题。现已定位 AGY 原生终态 ERROR 与已核产物并存的原案，以及新建任务准入失败被泛称“历史缺账号”的诊断候选；不能将这些现象直接归因于新连接故障或论文未通过。

## What Changes

- 固定完整失败台账：先前758份保留日志与归档86份全部发现、14家族为初查，不作为全覆盖完成。按采样截止清单读取全部保留原始tool/call/result及job状态，并与全部插件Worker/run原始终态交叉核对；包括本父、无Worker回执失败和orphan记录。逐例保留来源并给处理结论，fork同callId/Worker/run去重；无法读取/解释者显式留缺口，不能靠关键词上限、最新error或抽样家族声称所有失败已解决。
- AGY只针对已核原生 `system_message` 消息/上下文类型补足步骤识别；保留全部状态、身份、错误和终态校验。满足原有续聊、真实exit0、DONE回复、无本轮错误及清理条件才允许 uncertain，绝不升为成功。`error_message`及未知类型不因此豁免。
- 最小复现新建任务准备失败后缺绑定的诊断：区分仍在排队、已失败的首次准入和真正旧历史缺绑定；仍拒绝账号未确认的目录/续聊/配置，不借当前账号、不自动重试或新建。
- 对“本轮已有结果但结尾误报无额度”单列核验：对照本轮原生quota证据、账号/模型、旧latest/累计错误与Host容量门禁；有字不等于后续请求必无真实quota错误，用户报告有额度也不被伪造成余额数字。仅修已复现的误归因/串轮次，不增Hub/额度API或自动换号重试。
- 对Codex先有目录后启动为空、Host容量排队、metadata超时、旧run错误残留等去重家族先跑隔离回归；只有当前代码的真实反例成立才修改。真实配额、上游EOF、合法权限/expected-model/父会话隔离拒绝不被当作需要绕过的缺陷。
- 使用脱敏结构夹具与当前生产入口复测；真实AGY只在本父会话新建最小验收，不重跑或续写原论文任务。历史缺原生退出码的事实保持可见，不改历史终态。
- 公开工具/Remote最终展示边界安全归一结构化取消和不透明异常，不直接String未知对象，不修改内部abort identity；真实signal和已证typed清理/投递状态优先，不猜quota/auth。
- Native流对uncertain使用独立CLI_RESULT_UNCERTAIN说明，不再统称CLI_RUN_FAILED；保持保守error finish和完整正文。SDK内置Failed标题的兼容限制明确告知，不将uncertain伪装成功、不改DSH Core。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `worker-run-outcomes`：明确已识别AGY信息步骤参与覆盖、错误步骤不被DONE洗白，继续区分产物、正文和原生汇总冲突。
- `cli-account-isolation`：增加未完成首次准入与旧历史缺绑定的安全诊断边界，不改变账号准入权限。
- `worker-dispatch`：公开异常边界只对已核取消/清理类型给安全说明，不将结构化控制原因或私有cause交给默认字符串转换。
- `cli-model-discovery`：Codex同来源连续查询区分未知scope、未分类拒绝、空目录/能力交集及已确认拒绝，不以旧显示目录授权；正常token刷新与真正source变化分开。

## Impact

- Host：[AGY runner](../../../src/host/native-agy.mjs)、[Worker模型/续聊门禁](../../../src/host/index.ts)、[状态常量](../../../src/shared/types.ts)及必要的持久准入证据；Codex目录只在复现后按最小范围调整。
- Tests：生产runner夹具、Worker control/runtime、目录scope及既有容量/结果隔离回归。原始个人日志不入仓库，不复制论文内容。
- Docs：本change保存案例矩阵、分层证据、复测及未复现边界；必要时同步说明。既有鉴权、Cursor和其他dirty成果保留。
- 不改CLI账号/模型选择规则、Native保护、DSH Core、包名或0.8.2，不自动发布/迁移历史/解归档。部署仍先隔离验包、空闲备份热更新。
