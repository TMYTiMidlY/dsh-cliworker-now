# Spec Delta

## Purpose

让主 Agent 在用户已经确认首次选型后，对自己创建的 CLI Worker 查询原生模型目录并显式改变后续轮次的模型，保证配置、派遣与实际原生模型证据可以分别核对，不再依赖提示词里的模型名称推测已经完成切换。

## ADDED Requirements

### Requirement: 主 Agent 查询所属 Worker 的精确模型目录
系统 SHALL 提供只读模型目录工具，以 Worker ID 或所属父会话内的精确名称定位 Worker；返回其 CLI、账号范围内可选的精确模型标识与实际强度，不返回凭据或跨父会话数据。查询 MUST 不创建模型任务或改变任何偏好。

#### Scenario: 查询已有 AGY Worker
- **WHEN** 父 Agent 查询自己的 AGY Worker
- **THEN** 返回其账号范围内的模型和强度，允许从目录中识别 Opus 的准确标识；不以家族名猜测不存在的标识。

#### Scenario: 跨会话或无目录
- **WHEN** Worker 属于其他父会话、历史账号绑定缺失或目录无法验证
- **THEN** 明确拒绝或返回不可用原因，不借其他 CLI、账号或全局模型目录补齐。

### Requirement: 新 Worker 首轮前的本父会话确认设定配置
系统 SHALL 允许显式 CLI 查询当前父会话自己的账号范围模型目录，无需先创建 Worker；查询不能建立首次确认设定。系统 SHALL 提供独立本会话配置工具，仅对已完成原生模型/强度/角色确认的 parent/project/CLI setup 精确重配模型/强度，保留角色，且不得修改项目默认、其他父会话或已有 Worker。首次确认缺失 MUST 返回 FIRST_SELECTION_REQUIRED，不能暗填角色或绕过 start 问答。普通 start 的首个实际 prompt 使用重配后模型，不得先创建 Argon 空任务再切模型。start SHALL 支持可选 expected_model（仅精确前置条件，不是选型参数）；取确认快照后、异步授权后及最终同步准入前必须匹配配置回执的实际 configuredModel，配置与 start 之间若被并发改回其他模型 MUST 零 Worker/零 prompt 拒绝。

#### Scenario: 已确认 Argon 后新建 Opus
- **WHEN** 本父会话已完整确认 Argon 与角色，显式查询目录并配置本会话 Opus，再普通 start
- **THEN** 新 Worker 首个原生 prompt 即精确 Opus，保留角色；项目 Argon 默认、其他 parent setup 和已有 Worker 均不变

#### Scenario: 首次选择、账号变化或并发冲突
- **WHEN** 没有完整确认 setup、选择卡仍待决、查询取消、账号/权限/project 变化或 setup 并发更新
- **THEN** 共用首次选型串行锁与最后授权复核；未获完整确认时零 Worker/零 prompt，不代答原生选择卡，不隐式回退模型

### Requirement: 已确认 Worker 的显式模型配置
系统 SHALL 提供独立配置工具，只接受既有 Worker、其目录内精确模型标识及有效强度。配置 MUST 保留 Worker、原生会话、角色与权限，并仅作用于该 Worker；不得顺手启动任务、改变项目默认或代答首次选型。

#### Scenario: Argon 后配置 Opus
- **WHEN** Argon 轮已结束且用户要求后续使用目录中存在的 Opus
- **THEN** 只保存该 Worker 的 Opus 配置，返回明确的配置回执；不把旧 Argon 的观察模型或结果改写为 Opus。

#### Scenario: 不支持的模型或强度
- **WHEN** 传入模糊家族名、目录外模型或不受支持的强度
- **THEN** 拒绝保存并保留原偏好，不静默降级到 Argon、默认模型或其他强度。

### Requirement: 模型配置服从串行与能力边界
模型配置 MUST 拒绝运行、准备、清理未确认、原生子会话繁忙或存在待发消息的 Worker；拒绝子 Agent、宿主不允许的写入和固定模型 transport。取消、权限变化和并发提交不得造成半配置或跨 CLI 切换。

#### Scenario: 正在生成或有暂停队列
- **WHEN** Worker 尚在生成，或仍有普通/暂停待发消息
- **THEN** 配置被拒绝且原任务、消息和模型保持不变，不自动停止、取消队列或新建 Worker。

#### Scenario: OpenCode v2 固定模型
- **WHEN** 对固定模型的 OpenCode v2 纯文本会话请求更换模型
- **THEN** 明确说明需要新建任务，不通过新工具绕过现有 transport 限制。

### Requirement: 原生子会话只准入明确提交的正文
系统 MUST 根据输入 provenance 区分真实 user/Tool 提交与 runtime 工作目录或指令通知；在异步 pre-step 中间件之前捕获本步 claimed 输入。working-directory/runtime-context 来源不得单独触发 CLI 轮次或混入任务正文，不得按文本内容猜测来源。

#### Scenario: 工作目录通知没有用户请求
- **WHEN** 原生 child 仅收到 working-directory/runtime-context 消息，或中间件异步追加指令通知
- **THEN** 消费通知但零新增 CLI run/prompt，不覆盖既有结果，不让空步持续唤醒

#### Scenario: 用户同文或混合上下文
- **WHEN** 真实 user/Tool 消息与目录通知同文或同时存在
- **THEN** 按真实提交身份只准入用户正文一次，不吞掉用户请求，也不发送上下文通知正文

### Requirement: 续聊的预期模型与轮次前置条件
续聊工具 SHALL 支持可选的精确预期模型与前序运行身份校验；条件不满足时 MUST 在新运行准入和正文投递前拒绝。条件通过不代替执行时的账号、目录和原生模型一致性核验。

#### Scenario: Opus 提示词但仍是 Argon 配置
- **WHEN** 调用方声明预期 Opus，而 Worker 实际仍配置 Argon
- **THEN** 零新增原生 prompt，返回模型不匹配；不因为标题或正文出现 Opus 而派遣或暗中修改模型。

#### Scenario: 配置后按同一原生会话继续
- **WHEN** 空闲 Worker 已配置精确 Opus 且前序运行身份仍匹配
- **THEN** 仅准入一个新的 runId，保留原生 conversationId；实际模型以新轮原生初始化证据判断。

#### Scenario: 并发状态已经改变
- **WHEN** 预期前序 runId 已过期或配置与续聊之间出现另一项提交
- **THEN** 明确拒绝过期请求，不把旧操作套用到新的运行或重放正文。
