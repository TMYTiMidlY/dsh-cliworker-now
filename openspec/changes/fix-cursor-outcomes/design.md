# Design

## Context

动机见 proposal。静态源 6136.index.js 的 processPrompt catch（UTF16 14900 附近）将四种固定诊断、精确 unauthenticated 文案或 '\n\nError: '+String(error) 作为 agent_message_chunk，handlePrompt 仍返回 end_turn。toolCallCompleted（77606）始终 completed；extractToolCallOutput（96320）独占返回 error/rejected/permissionDenied 或 shell exitCode。read 非文本 success 与失败都可能没有 rawOutput，ls timeout 被折为 success=true，无法在此层还原。

## Goals / Non-Goals

**Goals:** 只改 Cursor 投影，保留真实正文、原成功工具内容及生命周期优先级。已核实负向形状要求同 session、本轮、关联 ID 与严格值类型；未知形状不当作确定失败。

**Non-Goals:** 不扩展其他 ACP 默认、不解析 opaque 模型、不开放新能力、不读取持久历史推断请求成败，不把未知原生分支伪称完全覆盖。

## Decisions

- 新建 cursor-outcome.mjs：按调用生命周期跟踪已关联工具，观察 active 同 session 的更新；保留重复 ID/重放/孤立更新歧义，不用 title 或任意模型 JSON 认定来源。
- Cursor-only `fencePromptResult` 用本地 JSON-RPC request ID 在同 buffer 的 prompt result 被同步接收时就置 ended，避免 await 续体前漏收后续通知；不是 provider response ID。其他 ACP 不开启。对于 LinePeer 以 `!method` 视作 response 候选的本次 owned prompt ID，若出现自有 method 属性（即使空串/null/false/0）、result/error 不严格互斥或 error 对象缺合法 code/message，Cursor opt-in 必须同步固定安全 fail 并 ended=true，而非仅忽略或当正常终态。旧/无关ID与preprompt不封口，合法RPC error仍硬失败，不修改全局LinePeer规则。post-result客户端权限请求仍拒绝，但不再记本轮权限失败；回复发送/清理若产生传输错误仍按硬失败处理，不能用 fence 掩盖。
- common ACP 新增可选 acceptedUpdate 钩子：只在 active、同 session、合法 update 且 eventId 去重之后触发；保留 Grok 的原 receive 扩展轨与其他 ACP 默认行为。Cursor 使用该钩子观察，再用 projectTool 钩子仅替换公开投影，不把可撤销 raw 推断写入 common sticky failure；原生 failed/权限拒绝仍按原硬失败处理。
- native-cursor 仅包装 io.result，在每 run 独立 tracker 中最终修正原 SUCCESS；不从 openStdio 的原始消息入口准入重放。工具省略 kind/status/rawOutput 的合法 metadata 更新继承已有证据；冲突开卡、kind 漂移、互相矛盾终态和孤立更新只让该工具歧义，不抹掉另一工具确定失败。
- 文本匹配四个 action literal 和 '\n\nError: '+非空后缀五诊断族；每次先扫描完整当前 chunk 与有限 prefix carry，再保存 carry，覆盖跨 chunk 与大 chunk 前部。无 origin 标签，同文引用仅 UNCERTAIN；普通错误词和 JSON 不触发。
- 工具严格形状按 source-contract 的 typed kind 约束。execute 不等于 shell：shell 必须继承合法 `{command}` 输入，完整 int32 exitCode/stdout/stderr 才能识别非零；stdin 子型仅认可补证的 uint32 number shellId 与 string chars，不猜双类型；零只表示无可见负证据。error 可为空，多行 reason 合法但安全限长。未知类型/超界/混合键只待核实；正常 read.content、所有已知成功 object、edit/delete diff 与 watch 保留。错误和未知负向的 rawOutput/content/整 update 不公开，仅给固定摘要。
- 所有可撤销 raw 推断终态在整轮收尾前只公开 state=UNKNOWN 与固定待核验摘要，避免原生工具 promise 提前消费成功/失败后无法撤销；保留可展示的正常成功内容与 diff。Cursor 在完整 onResult 后、io.result 前重投每工具最终 COMPLETED/FAILED/UNKNOWN；该阶段不再接受本轮 update。已有 Host 原生回执在 run settled 后对 UNKNOWN 返回 TOOL_OUTCOME_UNKNOWN，不新增核心状态类型。run 只根据最终工具证据降级，临时 UNKNOWN 不使正常结果待核实；原生 failed 等硬失败不被降级。
- content-only 工具单独冻结不可变终态快照：非终态进度可替换；首次有效 terminal 使用本次 content，省略时继承最近 content 并冻结。后续 terminal（包括省略 status、继承 terminal）的 content 用结构值比较，对象键重排幂等，数组顺序及真实 diff/text 变化视为该工具矛盾；省略 content 不清快照，公开 output 取快照的独立副本，输入/公开引用复用不能改变冻结证据或最终输出。只比较内容而非 title/locations/整 update，不解析内部 error/JSON，rawOutput 轨保持原规则。矛盾仍只在整轮收尾发布 UNKNOWN，native failed/独立确定失败优先不变。
- 2026-10-25父正式run 94472825的权限拒绝是已知Host origin，不是文本推测；新增Cursor-only可选permissionDenied观察点，仅在common active&&!ended且exact session的实际拒绝/取消回执分支触发，先保留原权限runERROR，再同步只传sessionId/toolCallId固定事实，不传reason/title/raw。没有新批准桥/grant/force/配置/MCP/RPC。
- tracker仅对本run已有有效唯一opening的opaque ID设localDenied；它在该身份仍有效时压过native completed、空/exit0及普通output矛盾，固定安全摘要说明未重新执行。不改原生status。因后续ID复用仍会撤销关联，localDenied的FAILED也延至finalEvents发布，之前保持未结算，不能让官方工具promise先消费再撤回。单独记identityAmbiguous（orphan/重复opening/kind或输入子型漂移），不是output冲突；后续复用该ID即撤去localDenied对合并卡的确定性，使其UNKNOWN而非假FAILED，独立native failed硬失败仍胜出。unknown/foreign/preprompt/late/orphan/复用不可信请求不造FAILED卡，其他ACP默认及正常MCP allow_once不受钩子影响。
- 只有原状态 SUCCESS 才按本轮观察改为 ERROR 或 UNCERTAIN；原 ERROR、取消、传输/清理错误不降级。结果正文仍由公共 ACP 聚合，已有 Host 对 uncertain 的队列暂停规则复用。

- 父run871202a9仅read且原生completed但rawOutput/output都省略，Host独立路径不存在；不把这项手工事实放进分类器。固定extractToolCallContent只有edit/delete，无read/image分支，read非文本success与error都可能无raw。故仅对read在整轮缺已核raw正证据、又无确定negative/硬失败时最终UNKNOWN，原SUCCESS降UNCERTAIN；可见raw文本（含空）/readLints计数保留，严格负向/localDenied/native failed及别的工具硬失败仍优先。不扩大到其他kind，不猜unsupported image/content、不解析内容或Host重读，初始RUNNING与终态延迟保持。

## Risks / Trade-offs

- [同文不可区分来源] → 保守待核实；不自动重试，不断言用户引用为原生错误。
- [工具 ID 重用/孤立更新] → 关联有歧义不判确定失败，给待核实结果。
- [无 rawOutput 或原生已丢失错误信息] → 不编造失败，明确 ls timeout/read 分支局限。
- [上游新错误样式] → 不泛化词语检测；未知覆盖范围如实记载，后续以新证据迭代。

## Migration Plan

无存储/认证/transport 迁移，不修改新旧 Worker。新增 helper 必须进入构建清单。父会话后续统一构建/部署；本任务只做源码和合成验证，保留其他 dirty 与已 freeze candidate。
