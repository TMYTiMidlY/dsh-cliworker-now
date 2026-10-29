# Spec Delta

## MODIFIED Requirements

### Requirement: 选型和宿主权限保持
派遣 SHALL 接受 Agent 提供的精确模型、支持的思考强度和可选角色参数，不向用户生成选型问题卡。模型与角色缺省 SHALL 仅按明确规则复用有效完整设定；无可用模型输入 MUST 返回 MODEL_REQUIRED。子 Agent、宿主规划或整体只读状态 MUST 拒绝外部执行。输入不完整、取消或授权失败 MUST 不创建任务或保存部分设定；复用仍核验当前账号、模型与强度。

#### Scenario: 首次使用与取消
- **WHEN** 首次调用未保存完整设定且未传 model，或授权检查期间调用被取消
- **THEN** 返回缺参或取消错误，不提问、不产生 Worker、不保存半套设定

#### Scenario: 宿主拒绝执行
- **WHEN** 主会话处于规划模式或整体只读状态，或调用来自子 Agent
- **THEN** 返回原有权限拒绝，显式选型参数和名称别名不得绕过边界

#### Scenario: 旧版偏好
- **WHEN** 项目只有旧版模型和强度偏好，尚无完整角色设定且调用未传 model
- **THEN** 返回 MODEL_REQUIRED，不从历史任务猜角色、不弹问题卡

### Requirement: 项目设定与主对话确认
首次显式 model 派遣 SHALL 经实时目录校验建立完整设定。省略 role 且没有有效完整设定 SHALL 表示不使用角色预设；role=none SHALL 明确选择无角色，其他 role SHALL 为有效预设 ID。相同项目和 CLI 的新主对话 SHALL 自动复用当前有效完整项目设定，不询问沿用；同一主对话后续使用自身设定。已有 Worker 角色快照 MUST 不被修改。

#### Scenario: 新对话沿用
- **WHEN** 项目和 CLI 已有有效完整设定，新主对话未显式覆盖
- **THEN** 实时核验后直接使用既有模型、强度与角色，无沿用询问

#### Scenario: 新对话重新选择
- **WHEN** Agent 在新对话显式提供 model、effort 或 role
- **THEN** 校验后以明确参数覆盖本次新派遣相应字段并保存完整设定

#### Scenario: 同一对话继续派遣
- **WHEN** 已有设定的主对话再次派遣相同 CLI
- **THEN** 不提问，其他对话修改项目默认不改变该对话已建立设定

#### Scenario: 项目或 CLI 不同
- **WHEN** 请求切换项目或 CLI
- **THEN** 只读取对应作用域设定，不跨项目、CLI 或主对话借用账号或未完成输入

#### Scenario: 账号或模型变化
- **WHEN** 拟复用设定的账号绑定或模型、强度已失效
- **THEN** 返回明确错误且不启动，不静默替换模型或弹出重选卡

#### Scenario: 设置页更新默认
- **WHEN** 用户在设置页更改项目模型和强度
- **THEN** 后续新主对话仅在完整设定仍有效时复用，已有对话和 Worker 快照不变

### Requirement: 仅两类简洁派遣询问
插件派遣 MUST 不生成模型、思考强度、角色、项目沿用或 Qoder 版本问题卡。模型目录和角色目录 SHALL 可只读查询，参数无效 SHALL 返回指导补参的错误。effort 缺省 SHALL 优先复用相同模型的有效强度，否则仅取实际支持的 default 或唯一强度；没有可确定值时返回 EFFORT_REQUIRED，不猜强度。

#### Scenario: 选择问题卡
- **WHEN** Agent 显式提供 model、effort 与 role
- **THEN** 直接校验，不生成任何选型问题卡，只有校验成功才派遣

#### Scenario: 强度随模型
- **WHEN** 选择模型支持多个强度且不支持 default，也没有可复用强度
- **THEN** 返回 EFFORT_REQUIRED，由 Agent 查询目录并补充精确 effort

#### Scenario: 沿用问题卡
- **WHEN** 新主对话有有效完整项目设定，或泛称 Qoder 在双版本均安装时有歧义
- **THEN** 前者直接复用，后者返回 qoder国际版/qodercn 候选；均不向用户提问

### Requirement: 询问并发和取消隔离
相同主对话、项目和 CLI 的并发派遣 SHALL 在选型作用域锁内依次校验、保存完整结果；不同主对话保持独立设定。等待者取消 MUST 及时结束且不取消其他调用；发起者取消后后续调用 SHALL 能继续。插件关闭 MUST 清理等待状态，未完成设定不得写入。

#### Scenario: 同对话并发
- **WHEN** 同一对话同时提交相同 CLI 的参数化派遣
- **THEN** 校验顺序串行，后续调用可复用已保存完整设定，没有重复问题卡

#### Scenario: 不同对话并发
- **WHEN** 不同主对话同时为同一 CLI 提交不同精确参数
- **THEN** 各自保存对应设定，不共享未验证输入

#### Scenario: 等待或选择取消
- **WHEN** 等待者或当前授权检查发起者取消
- **THEN** 对应调用结束且无部分设定，其他调用可继续，等待状态最终清理

### Requirement: 同次请求的派遣入口指引
插件 SHALL 在明确派遣请求的同次模型输入中说明 cliworker_start 通过参数指定模型、强度和角色，不直接向用户提问。缺少信息时 SHALL 指引 Agent 使用只读目录补参或复用有效设定。指引 MUST 与原始人类消息区分，尊重已准入消息、取消、子 Agent 和工具作用域，不拦截通用提问工具。

#### Scenario: 原生组装顺序
- **WHEN** 用户本次请求明确调用 AGY，Harness 先组装 system prompt
- **THEN** 同次模型请求已包含 cli=antigravity 和参数化派遣指引

#### Scenario: 无新增派遣或入口不可见
- **WHEN** 没有明确人类派遣、步骤取消、当前为子 Agent 或工具不可见
- **THEN** 不新增派遣指引、不改原始消息或通用提问工具

#### Scenario: 内部选型不变
- **WHEN** Agent 仅提供 CLI、标题和任务
- **THEN** Host 仅在完整设定有效时复用；否则返回 MODEL_REQUIRED，既有权限检查保持，不弹问题卡
