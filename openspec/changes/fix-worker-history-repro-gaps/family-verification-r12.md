# 其他失败家族关联验证（Round12）

## 范围与证据分层

本轮继续原采样截止的96失败call和53非成功run；此前全保留日志/原始call-result/job/插件raw扫描不重计成新案例。父为唯一写者，两位原审查Agent只读分工覆盖余89call的13+73+3明确集合，结论按精确case另挂私有台账，不从taxonomy批量推出历史根因。原status、正文、绑定和归档均不改，无法保留的原生exit、取消来源、source/scope与cleanup继续unknown。

279项家族验证阶段的生产源码相对当时已部署898af0ad候选没有变化；随后独审复现的小修单列在下文。该阶段仅给现有[原生Runtime回归](../../../tests/native-runtime.test.ts)增加2个精确case：同Worker先真实合成ERROR或UNCERTAIN，随后新run在queued时清error/lastResult/observedModel；新成功仅展示新正文，旧run按runId仍保留旧正文/错误/cleanup及原事件，原账号/Native会话/Worker数量不变。两例在当前实现直接通过，属于已实现行为的覆盖补齐，不把测试新增叫生产缺陷修复。

父独立[关联组](../../../.cache/worker-history-audit-20261025/family-green-r1.json)：12文件279PASS/0FAIL/0SKIP，Host/Client types、strict/diff及810输入核对通过。补充[精确来源组](../../../.cache/worker-history-audit-20261025/family-supplement-green-r1.json)：6文件214PASS/0FAIL/0SKIP；AGY catalog11、MiniMax native77、Codex account9、runtime account-isolation32、OpenCode v2 81、ACP permission4。分组与前1364项有重叠，不能相加；补充组不再冒称已包含于原1364报告。

## 当前家族处理结论

| 家族 | 当前处理及覆盖 | 历史/实际执行边界 |
|---|---|---|
| Host active-child容量 | 精确SDK类型、队列保留原Task/Worker/run、事件风暴合并、迟到提示/取消/权限/关闭门禁已验证；不重复施工 | 3个旧failed仍原样failed，不升级Hostpolicy、不等同vendor quota；模拟不冒真实12个并行Native |
| 插件运行预算/同目录写串行 | default8、本机明确12持久配置、提高drain/降低不杀、各父FIFO与公平、目录屏障已有回归 | 不从global12推同root可派12；不为盘点停止其他会话 |
| metadata hang/cancel/cleanup | 阶段安全诊断、真实caller原因、清理失败优先、取消不污染后续准入；AGY单独60s目录预算、其他默认15s已补专门回归 | 旧TIMEOUT/tool deadline缺具体阶段者留unknown；无receipt不等于0Worker/0prompt，无raw不由cleanup推exit0 |
| 新run清旧error | 同Worker ERROR/UNCERTAIN→新queued→completed，旧run正文和error不变、新run绝不借旧lastResult，两例生产Runtime合成已补 | 无生产代码修改；历史串轮次具体原因未留存时不称已唯一定位 |
| 原生非0/缺终态/EOF/真实quota | primary runner与AGY历史夹具坚持失败；本轮error_message/工具ERROR不被DONE或最终SUCCESS洗白；正文与错误分开 | 34份完整raw仅显式模拟0/3回放，历史exit仍unknown；已核产物不被叫论文失败，但也不抹掉真实工具失败 |
| expected-model/effort/foreign/权限 | exact precondition、父归属、planning/readonly、冷保存/绑定复核、投递未确认均保留，未扩大授权 | 预期拒绝不是需要绕过的bug；无权收养其他父会话或借当前账号给旧任务 |
| Cursor负向工具probe | 2个shell权限拒绝、1个缺rawOutput read的UNKNOWN逐run复读；旧completed工具投影与deny冲突已有修复，不重写原turn | 不由模型说EXECUTED/文件未找到推工具结果；SDK红Failed兼容标题仍保留，新的独立码/说明已另有AGY实机+Cursor合成 |
| MiniMax权限拒绝 | 原生read/write明确outside-workspace要求确认后被默认拒绝，保留FAILED/ERROR与已公开正文 | 不是quota/auth失效，也未证明真人点拒绝；正确project/正规builtin once approval与原总目标继续，不能称所有原生工具已通 |
| OpenCode版本/服务 | 已核固定原生branded-v合同的最窄解析修复及正式models进入service gate；无旧auth/DB fallback，81项补充验证 | 原第一次generic error未留stdout时不猜同因；service未运行不等于登出，真正v2服务/模型/GUI仍待原change验收 |
| Kimi原生auth | 原run3条raw证握手AgentInfo2.3.0后RPC -32000 Authentication required，未观察模型，保留失败及cleanup原证 | 2.2公开源码readiness研究不是2.3.0一致性或原default/source根因证明；相关兼容待实施，不让用户清配置重登 |

## 不夸大已处理含义

每个case的“已审阅/当前合同已验证/已有修复”与历史根因是否明确、vendor错误是否仍存在、原业务是否成功分开。原始raw的43份当前可读、10份缺失均明确留存；34份既有回放raw摘要再次核对相同。父随后已核13+73+3集合、原callId和row/seq全部相等，并发布私有failure-ledger-r6：96/96 call、53/53非成功run都有逐例contextReview，原历史字段对比不变、pending_case_verification为0。allRetainedCasesContextReviewed=true不等于allIssuesResolved=true；73例有35项当前合同与38项历史阶段/清理仍缺证的分层，其余独审与父审也分别留leaf/source未知。13例审查转录保留asmgr lossy警告，只消费确切job_output的机器正文，不冒所有事件无损投影。原总目标鉴权15项、Kimi/OpenCode Native、审批链和最终Git动作不记作完成。

## 合并审查后新增的确定性反例

- MiniMax identity内部固定安全DOMException与原signal.reason不同，正式start实际assert/request两例先红，误投影为opaque一般失败。保持下层对象，用module-owned WeakSet witness做最终安全取消说明；同文案假AbortError/Proxy不获此语义，内部deadline仍身份unavailable，cleanup/投递未确认优先。窄组326PASS及独立只读复核通过，后续新deadline反例与最终冻结另记，不补旧case的取消owner。
- 扩大后的47文件冻结1680PASS/1FAIL/1既有SKIP暴露strict auth helper的stdin fallback与真实source-error帧竞态（始终fail-closed）。父真实helper确定性红例再现，独审要求区分transport/helper/protocol/explicit/cleanup origin、wakeup固定身份、终态后坏帧poison及actual-close后最终归因。C/ABI未改，不弱化源拒绝或增加sleep/retry；新增EPIPE-only/未知CHECK写异常不猜SOURCE_CHANGED，以及取消/协议/cleanup与callback错误优先反例。5文件123PASS及types/strict通过；取消的中间r6集成不算通过。独审随后提供同步callback与EPIPE微任务窗口，父2真红后只在内层catch补同一wakeup/真实callback区分，保留既有优先规则。最终47文件1697PASS/0FAIL/1既有SKIP、types/5change strict/diff及810输入冻结通过，kernel59项；实际包21ec205a已备份安装、现GUI刷新独立读图完成，见[最终实施日志](../../../doc/tasks.md)。

部署边界同样不美化：r2在其他Worker启动后被第二次idle检查拦住，正式命令前退出；空闲恢复后新r3安装时854份历史0变化。激活前快照后peer又接纳新run，故激活后的全历史零delta检查实际失败，不能改写为绿；另行精确证明该peer的8176行原事件前缀完整、其他852原文件不变，只有合法新run的latest Worker/追加events/raw。没有跨父续聊、stop或借它当本父Native验收，也不承诺整个激活区间持续空闲。图中CLI_RESULT_UNCERTAIN/SDK兼容提示与quota非当前余额说明可见，但红Failed仍存在；这是当前边界，不是已移除红标题。
