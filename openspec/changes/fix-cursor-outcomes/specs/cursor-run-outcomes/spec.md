# Spec Delta

## Purpose

为 Cursor ACP 结果提供保守且可核对的判定：区分明确工具失败、普通正文与来源不明诊断，不把 end_turn 当作成功证明，同时保留本轮原文和既有停止/清理边界，避免自动重试产生重复副作用。

## ADDED Requirements

### Requirement: 来源不明诊断保留未知
系统 SHALL 仅把已核实 source-shaped 诊断当作疑似异常，将原 SUCCESS 降为 UNCERTAIN 并保留正文；同文合法引用也不得据此判确定错误。普通错误词和 JSON 不触发此规则。

#### Scenario: 部分回复后附诊断
- **WHEN** 本轮正文含已知原生诊断形状而协议仍返回 end_turn
- **THEN** 结果待核实，保留所有本轮正文，不自动重试

#### Scenario: 合法引用与普通错误词
- **WHEN** 用户合法引用相同诊断或正文仅含普通 error/JSON
- **THEN** 相同 wire 只能待核实；普通错误词和 JSON 不改变成功状态

### Requirement: 只认已关联的严格工具失败
系统 MUST 仅从本轮同 session 已关联 toolCallId 的原生工具更新识别严格、独占已知负向形状，或从Host对该唯一有效opening的确定本地权限拒绝识别工具失败；标记工具失败且保留本轮 ERROR，不得解析 assistant JSON、read.content 或 shell stdout 为状态。

#### Scenario: 严格负向结果
- **WHEN** 已关联 typed kind 工具返回源合同允许的独占 error 字符串（允许空）、rejected=true、permissionDenied=true 或已核 command 输入及完整 int32 非零 shell 结果
- **THEN** 工具为失败且本轮 ERROR；公开诊断使用固定安全摘要，不泄漏私密错误详情

#### Scenario: 未知或冲突格式
- **WHEN** 负向字段值类型未知、超界、混有 success/content 或工具身份关联不完整
- **THEN** 不断言工具确定失败；公开 UNKNOWN 和固定安全摘要，本轮待核实，不以键存在代替证据；另一独立确定失败仍为 ERROR

#### Scenario: 合法省略与关联冲突
- **WHEN** 已关联工具收到省略 kind/status/rawOutput 的 metadata 更新或冲突开卡、kind 漂移、矛盾终态
- **THEN** 合法省略保留已有证据，冲突只使该工具歧义；不得提前把可撤销 raw 推断记为不可撤销硬失败

#### Scenario: 无 rawOutput 的内容终态
- **WHEN** edit/delete diff 或 content-only 工具在完成后收到不同内容、等价重放或省略 content 的 metadata
- **THEN** 冻结首次有效终态内容，等价结构值和缺 content 保留证据，矛盾仅使该工具 UNKNOWN、本轮 UNCERTAIN；合法非终态内容进度不误判冲突，所有可撤销终态仍延至整轮后发布

#### Scenario: 已关联工具权限被本地拒绝
- **WHEN** common ACP 在active且未ended、精确当前session，对本run已有唯一有效opening的opaque toolCallId实际选择拒绝或取消权限
- **THEN** Cursor-only钩子只传安全ID和固定拒绝事实，该工具后续completed/空输出/可见exit0或普通内容冲突仍为FAILED，公开固定安全摘要且不重新执行；本轮原权限ERROR不被覆盖，不改原生raw status或批准权限

#### Scenario: 拒绝的身份隔离与复用
- **WHEN** 权限请求的session/ID无关、发生在preprompt/ended、opening孤立/重复或拒绝后该ID被复用
- **THEN** 不凭本地拒绝造FAILED卡，不污染其他工具；identity歧义与普通output歧义分开，复用ID合并卡为UNKNOWN而非虚假FAILED，另一独立native failed硬失败保持

#### Scenario: 正常内容
- **WHEN** read.content 或 exitCode=0 的 stdout 含错误 JSON/词语
- **THEN** 保持正常内容和已核实结果，不把其作为失败凭据

### Requirement: Read缺有效正证据不得默认为成功
系统 SHALL 仅对kind read，在本轮最终没有已核实原生正证据且无确定负向/原硬失败时投影UNKNOWN与run UNCERTAIN，不以原生completed或空输出替代成功证据。不得解析错误正文/文件名或由Host重新读路径猜测ERROR，也不泛改其他kind。

#### Scenario: Read原生结果不可区分
- **WHEN** read completed省略rawOutput或只有无证据的content，原生错误与非文本成功都可能不产输出
- **THEN** 工具最终UNKNOWN、原SUCCESS降UNCERTAIN；正常raw文本content（包括空串）及已核readLints计数保留成功；当前固定presenter没有read/image content分支，不把合成image/text content猜成原生正证据

#### Scenario: Read未知不盖过确定失败
- **WHEN** 缺证据read同时有已关联localDenied/native failed、另一工具严格失败或取消/传输/cleanup错误
- **THEN** 不降级原失败优先级，缺证据不扩散到其他工具，也不自动重试或发下一条

### Requirement: 生命周期优先级不变
系统 MUST 保持原 ERROR、取消、非零退出、缺终态和清理失败的优先级；UNCERTAIN 不自动执行下一条消息，不伪造用量或 provider response ID。

#### Scenario: 畸形 owned prompt response
- **WHEN** 本次 active prompt 的 response 候选含自有 falsy method、result/error 混合或缺失、非法 error 对象
- **THEN** Cursor 同步安全失败关闭并封口，保留此前正文且排除随后同 buffer 通知；不得返回 SUCCESS 或泄漏原始错误。旧ID、preprompt和其他ACP默认不受此规则影响，合法RPC error与清理失败仍是硬失败

#### Scenario: 待核实后停止或清理失败
- **WHEN** 疑似诊断伴随停止、传输错误或清理失败
- **THEN** 不降级覆盖原失败/中断边界，正文仍保留且后续自动执行暂停
