# Spec Delta

## Purpose

使 OpenCode v2 的原生账号与模型元数据可被安全识别，区分服务不可用、来源未支持与未连接账号，保留准确原生模型和变体标识，同时防止将 v2 凭据布局套入 v1 适配或将只读诊断信息误用作可执行授权。

## ADDED Requirements

### Requirement: 原生版本分流
系统 SHALL 在 OpenCode 账号、目录与任务准备前核验原生版本，只对明确 v1 使用旧适配；明确 v2 和未知版本 MUST 不读取 v1 凭据快照或创建 v1 隔离数据库。自动发现 SHALL 支持官方安装路径但不覆盖手动选择。

#### Scenario: 原生 v2 已安装但没有旧文件
- **WHEN** 原生版本为 2.x 且没有 auth.json
- **THEN** 使用原生服务元数据路径，不将旧文件缺失解释为已登出

#### Scenario: 默认 PATH 未包含官方入口
- **WHEN** 默认 PATH 查询找不到 OpenCode 且官方原生入口存在
- **THEN** 仅使用该官方入口；手动路径缺失时不静默替换

### Requirement: 受信原生服务元数据
系统 SHALL 仅连接已存在的受信 Linux 原生服务，私有 registry 采用有界 no-follow 一致性读取，并核对原生进程、UID、版本、PID 和固定回环地址。元数据查询 MUST 仅使用固定 GET 接口；自有会话通路只使用下述受限 owned-session 接口，不输出密码、原始 provider/settings/headers 或错误载荷，不启动、重配或终止共享服务。

#### Scenario: 服务缺失或身份不匹配
- **WHEN** registry 不存在，或路径、私有性、版本、PID、地址、响应来源无法确认
- **THEN** 报告原生服务不可用或未支持；不报告用户已登出，不读取数据库或导出凭据补证

#### Scenario: 查询期间来源变化或取消
- **WHEN** registry、原生进程或当前 connection/provider 来源变化，或查询取消、超时、格式损坏
- **THEN** 丢弃结果并结束请求，不返回旧候选、不改动原生数据、不发送 prompt

### Requirement: 原生诊断候选与权限边界
系统 SHALL 从相同项目的 integration/provider/model 包装响应关联当前首个 credential connection，只保留支持的 key/oauth 记录；环境、未知外部来源、needs_auth 或认证路由覆盖不得作为有效来源。模型与数组 variants 的精确标识 SHALL 保留，费用和调用权益未知时不得虚报。

#### Scenario: 原生数组变体
- **WHEN** 元数据包含已连接 provider 的 enabled 模型和数组 variants
- **THEN** 诊断投影保留 provider、模型和每个变体的精确标识，不猜测强度、不泄漏源对象

#### Scenario: 仅诊断阶段
- **WHEN** 原生元数据读取成功但执行的账号固定与远端停止契约尚未实现
- **THEN** 账号显示已配置及证据范围，可执行模型选项为空，说明执行尚未支持；record ID 不被描述为稳定用户 principal 或远端授权成功

### Requirement: v2 执行和账号操作明确拒绝
系统 MUST 在生成 prompt、v1 快照、临时数据库、工具注入或旧会话续接前拒绝尚未支持的 v2 执行。账号入口 SHALL 只提供用户主动打开原生终端，不注入 login/logout 或修改原生环境。

#### Scenario: 新建或续接 v2 任务
- **WHEN** 用户尝试尚未实现的 v2 能力或用升级后的 CLI 续接 v1 Worker
- **THEN** 明确说明该能力／v1续接未支持，不为此创建远端任务，不重解释旧 session ID

### Requirement: 自有纯文本会话与精确选型
系统 SHALL 在实际实现的v2通路只开放显式只读纯文本，按原生选定默认agent、精确provider/id/variant及最后全工具DENY规则建立owned session。编辑、工具、MCP、附件、分支和实时steer MUST 不开放，v1能力不受v2限制影响。持久来源与每轮服务 epoch MUST 分离，opaque 模型身份不得 case-fold 或按 route 合并；会话模型固定，修改需新任务。真实 DSH child 仍须创建、设只读并投影正文，但不分配 tool/MCP lease，公开 model/steer/attachments/fork 能力必须与 backend 拒绝一致。

#### Scenario: 精确模型及碰撞
- **WHEN** 用户选择v2模型或续接既有owned会话
- **THEN** 在prompt前核对真实会话marker/project/source/agent/model/deny规则；碰撞、外来会话、legacy v1会话或不匹配均拒绝，不删除历史

#### Scenario: 编辑或未知能力
- **WHEN** 用户尝试v2允许编辑、工具、附件、分支或实时引导
- **THEN** 在picker/persist/prompt前明确拒绝，纯文本会话不通过snapshotALLOW覆盖当前原生DENY

### Requirement: 耐久输入与有界事件恢复
系统 SHALL 以源证据支持的唯一 input ID 和不可变正文摘要持久记录准入，只读取 owned session 耐久日志；ACK 不是完成。未知准入 MUST 按精确 inbox/user-message/log 核对，不重发，取消后也不重用 ID。原生过滤行允许 seq 不连续，但水位缺失、倒序、重复冲突、错误会话及模型/来源/策略变化不得静默采纳。原始私密载荷和其他会话内容不得返回 Gateway 或持久化；只投影有精确实际模型 step 的最终文本分段，不虚构 delta 或 usage。

#### Scenario: ACK丢失及日志重连
- **WHEN** prompt请求超时或耐久流重连
- **THEN** 用同 input ID、exclusive seq 与 log.synced 水位核对，text.ended 按 assistant/ordinal 去重；成功还需关联本轮的真实 terminal、最后精确模型 step 与非空最终正文，缺失时模型结果保持不确定

#### Scenario: 两轮间出现外来已完成输入
- **WHEN** owned 会话在已签水位后出现未知 user/synthetic 输入或历史变更，即使当前 idle、inbox 为空且 marker/model/权限一致
- **THEN** 拒绝续聊并 invalid 该记录，零新 prompt，不删除外来历史；baseline 不得跳过这些事件

#### Scenario: 原生工具活动不符合纯文本范围
- **WHEN** 出现 tool.called/success/failed 或 shell/skill 活动，包括 executed:false
- **THEN** 停止并保留不确定策略隔离，不把 providerExecuted:false 解释为本地工具未运行

### Requirement: 远端停止证据及持久隔离
系统 MUST 独立于本地桥生命周期确认清理：在本次清理周期前正向证明精确不可变 own input 已准入，仅取消 own pending input，interrupt(resume=false)，同 PID wait 后核验 active/inbox/log。无正向准入证据时，cancel204、interrupt false 与暂时 idle 不能阻止异步准备晚到，SHALL 保持 quarantine。已知准入且前台清理有证据时，缺业务 terminal/正文可单独保留模型结果不确定；不得伪造完成。桥被 kill、PID 替换、断连或缺清理证据 MUST 持久隔离 worker/CLI/source，不能因 local range 退出释放 prompt。秘密只经 Host-private env；每轮 fresh-key HMAC 私有 ledger 绑定精确 run/input/payload/source/epoch/状态，原始 SSE/result 不得提供或伪造 proof。

#### Scenario: 桥死亡或停止未确认
- **WHEN** 本地进程退出而远端停止证据未满足
- **THEN** 保留UNCERTAIN/quarantine，禁止新prompt或自动重播，不杀共享服务、不删除原生历史

#### Scenario: 异步准入晚于一次空闲检查
- **WHEN** POST 超时或被停止时尚无 own input 的正向准入证据，而原生异步准备仍可能继续
- **THEN** 即使取消/wait 返回暂时空闲也不签 settled；晚到后仅明确 cleanup-only 在先证明已准入再停止的周期中解除隔离，不重发业务

#### Scenario: 本地启动失败与无远端会话
- **WHEN** pending 已保存后启动抛错或桥死亡，且原服务没有可核对会话或 GET 返回404
- **THEN** 保持隔离，不以404或替换服务的空 active map 自动恢复，保留当前保守恢复限制

#### Scenario: 仅清理恢复
- **WHEN** 用户停止已隔离owned session且原生账号已改变
- **THEN** 只允许在原服务/marker范围核实并清理自身输入及执行，不要求借新账号派遣，缺乏同服务证据继续隔离

#### Scenario: 用户打开账号终端
- **WHEN** 用户主动选择 v2 账号终端
- **THEN** 打开原生 OpenCode 入口供用户管理，不使用 v1 隔离认证目录，不自动执行认证变更
