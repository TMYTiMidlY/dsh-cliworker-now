# Spec Delta

## ADDED Requirements

### Requirement: 显式鉴权 profile 派遣
按 CLI 查询目录、新建 Worker 及设置未来新任务 SHALL 接受明确的 auth_profile ID；所选来源必须属于该 CLI 且处于可用版本。Worker selector 查询、续聊和已有 Worker 换模 MUST 从该 Worker 的固定来源解析，不接受 auth_profile 覆盖。CLI 每次新派遣仍必填，不从 profile 标签、任务文字或模型名猜 CLI。

#### Scenario: MiniMax显式回原生来源
- **WHEN** 新选择明确提供MiniMax `auth_profile: native`
- **THEN** 只读取该parent/project的原生来源完整设定或原生规则，不借当前导入profile的模型、强度、角色或目录证明；仍不改已有Worker

#### Scenario: 指定 profile 首轮
- **WHEN** Agent 查询一个 profile 的真实目录后显式提供 CLI、auth_profile、model、支持的effort和可选role
- **THEN** 校验同一来源后首个prompt直接使用该配置，不弹选型卡，不先派默认账号空任务再修改

#### Scenario: profile 与 legacy 账号参数冲突
- **WHEN** 同时提供 auth_profile 与 agy_account，或 profile 属于另一CLI
- **THEN** 启动前返回明确冲突，不选择优先级、不保存半套设定、不创建Worker

#### Scenario: 已有 Worker 覆盖来源
- **WHEN** 以Worker ID/名称续聊、查询模型或配置模型时尝试另指定auth_profile
- **THEN** 拒绝覆盖，原账号、原生会话、角色和run不变，不暗中创建替代Worker

#### Scenario: 同 profile 但固定凭据失效
- **WHEN** Worker 的固定 profile/材料版本未变，但当前 pin 或模式在排队、续聊、换模、fork 或恢复准入时失配
- **THEN** 不发送新 prompt，不接纳最新 pin 或改用新材料；保留原 Worker/conversation/角色和历史，不自动克隆或重发，停止仍使用既有进程 handle

#### Scenario: Native 探测后的失配
- **WHEN** 模型目录正文已经返回，但目标重读发现固定 pin 失配
- **THEN** 不将该回执保存为有效目录证明，不据此启动模型任务；已实际执行的探测和清理按事实记录，不冒称当前账号或余额已证

### Requirement: 完整设定按 profile 隔离
完整选型、目录证明与缓存 SHALL 至少按主会话、项目、CLI、profile及版本隔离，并受该版本固定身份合同及其中适用的当前 pin 重检约束。省略 auth_profile 只可沿用明确有效的当前完整设定或原生默认规则；被选profile失效 MUST 返回错误而不是回落原生默认。显式切到没有完整设定的 profile 时继续由Agent提供精确参数，不生成用户问题卡。

#### Scenario: 切来源但模型名相同
- **WHEN** 新profile恰好也提供旧模型ID，但它尚无当前作用域的有效完整设定
- **THEN** 不拿旧profile权限证明或角色设定冒充新来源，实时目录和参数校验完成前不准入

#### Scenario: 原生默认偏好入口不能接纳profile
- **WHEN** 调用仅保存原生项目默认的入口却在Preference中提供authProfile
- **THEN** MUST在profile探测和持久化之前拒绝，不合并旧native binding/role，不把完整profile偏好写入legacy默认桶

#### Scenario: 缺省与失效
- **WHEN** 当前完整设定绑定的profile已停用、版本不再可选或身份不符
- **THEN** 返回实际来源错误，不自动选默认账号；无模型参数和有效完整设定时返回MODEL_REQUIRED

#### Scenario: 未来设定与现有会话
- **WHEN** Agent为当前主会话配置另一profile的未来完整设定
- **THEN** 仅影响其之后新建Worker，不改其他主会话/项目默认或已有Worker/native conversation

#### Scenario: UI目录与完整来源组合
- **WHEN** 用户显式为当前主会话设置新任务账号
- **THEN** Gateway MUST先读取明确来源的fresh目录及精确材料pin，再对显式完整组合重检绑定和模型；取消/关闭不保存半组合，同域角色才可保留，不调用原生项目默认setter

#### Scenario: 排队期间项目变化
- **WHEN** 新任务账号完整组合排队等待期间parent的项目变更
- **THEN** MUST在任何新的credential-bearing metadata或Native准备之前拒绝旧项目选择，不以最后未写设定声称旧项目零I/O

#### Scenario: 所属主会话实例已结束
- **WHEN** catalog或apply等待期间原parent Agent移除或由同ID新实例替代
- **THEN** MUST在目录proof发布或完整设定写前拒绝旧请求，放锁准备前同样核对同一live owner；不据同ID自动接续旧请求，不删除已有合法持久设定或历史
