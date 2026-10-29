# Spec Delta

## MODIFIED Requirements

### Requirement: AGY 续聊汇总冲突终态
AGY 续聊 SHALL 仅在会话身份一致、退出码为零、无取消/解析/清理错误、本轮可识别步骤均 DONE、至少有非空 DONE 回复且无本轮错误证据时，将最终 ERROR 标为 uncertain（结果待核实）。已核的原生信息/上下文步骤 SHALL 按自身生命周期纳入覆盖，不作为工具执行成功或错误的替代证明。该状态 MUST NOT 宣称成功或已证实历史错误；其他不充分证据仍保留失败。宿主 job 不支持此终态时 SHALL 保守映射 failed，并在结构化结果和说明中保留 uncertain 与禁止自动重试提示。

#### Scenario: DONE 回复与 ERROR 冲突
- **WHEN** 满足上述前提但续聊汇总仍报告 EOF
- **THEN** 展示本轮回复及结果待核实，保留原始汇总错误，提示先核查实际产物，不自动重跑

#### Scenario: 真实失败或部分执行
- **WHEN** 本轮报告错误、仅有工具 DONE、回复未 DONE、缺失结果、非零退出或进程清理失败
- **THEN** 不转为 uncertain 或成功，保留失败及已有结果；取消与超时保留中断

#### Scenario: 持久化与后续操作
- **WHEN** uncertain 记录被重启恢复、筛选、展开过程或再次续聊
- **THEN** 终态可恢复并归入异常，过程用本轮时间结束；续聊仍受原有账号、互斥和清理边界约束

#### Scenario: 已核原生系统消息完成
- **WHEN** 本轮包含无结构化错误的原生 system_message DONE，且其他全部冲突判定前提成立
- **THEN** 不因该消息类型漏识别而破坏步骤覆盖，最终ERROR仍仅为uncertain，不宣称任务成功或系统消息执行了工具

#### Scenario: 错误记录处理完不表示错误消失
- **WHEN** 本轮包含error_message DONE、未识别步骤、未完成系统消息、非法身份/index/state或明确error/is_error
- **THEN** 不将其豁免以凑齐all-DONE，不升为成功或声称已证明历史错误残留

#### Scenario: 历史退出码未保留
- **WHEN** 历史只保留原生ERROR、DONE步骤与cleanup confirmed，却没有可核验的原生退出码
- **THEN** 退出码保持未知，不由清理完成推成exit0，不改写原历史终态；受控回放须标注其模拟退出条件

## ADDED Requirements

### Requirement: Native侧栏的待核实结果分类
Native流 SHALL 对已确认的Worker uncertain终态使用独立CLI_RESULT_UNCERTAIN与结果待核实说明，保留本轮正文、原错误及不可自动重试提示。Pinned SDK无法表示该枚举时 MUST 明确其原生turn可能以Failed兼容显示；不得以成功/取消或修改Core/历史记录掩盖限制。真正失败继续使用原失败分类，清理未确认不因该投影被豁免。

#### Scenario: AGY或Cursor结果待核实
- **WHEN** 同run清理完成后Worker终态为uncertain且本轮正文已收到
- **THEN** 原生流保守error finish使用独立code和明确兼容说明，保留正文，不宣称业务失败已证或任务成功

#### Scenario: 真正失败和取消
- **WHEN** Worker真实failed、timeout或用户停止
- **THEN** 保持原失败/取消边界，不将它们误标为uncertain或修改已记录turn

### Requirement: 额度错误与本轮来源证据对应
额度相关结论 SHALL 对应同一CLI、账号来源、模型及run的实际证据。Host容量、其他run错误、累计汇总或未知额度 MUST NOT 被表述成当前账号余额为零。已收到正文或产物也 MUST NOT 自动抹掉真实后续额度失败；无当前额度数据不伪造余额、不自动换号或重试。

#### Scenario: 有本轮结果但汇总声称额度不足
- **WHEN** 本轮存在已观察结果，原生汇总又报告quota错误而其归属或累计性质尚未证实
- **THEN** 独立保留结果与原始错误，按实际终态证据分类；不直接声称本轮没有干活、无任何额度或已证旧错误

#### Scenario: 厂商实际拒绝后续请求
- **WHEN** 同run当前请求或步骤有可核验的额度拒绝
- **THEN** 保留真实错误和部分结果，不因为前面已有字或文件就升级为成功

#### Scenario: 仅主机容量或旧轮次错误
- **WHEN** 准入因Host active-child容量等待，或所读quota错误属于另一个run
- **THEN** 明确区分资源层与轮次，不冒充厂商quota，不把旧错误污染新run

#### Scenario: 非零退出和原生汇总错误并存
- **WHEN** 已观察到真实原生进程退出及CLI汇总额度错误
- **THEN** 保留两者的来源及退出证据，不以通用exit错误吞掉原生声明，也不把该汇总表述成已查询当前余额；没有退出证据时保持未知
