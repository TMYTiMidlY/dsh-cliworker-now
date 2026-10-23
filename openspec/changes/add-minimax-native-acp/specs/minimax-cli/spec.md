# Spec Delta

## Purpose

将 MiniMax Code 作为独立 CLI 接入现有多智能体插件，提供符合其原生账号命名空间、动态模型配置和权限语义的会话协作。明确区分已安装、已保存认证、稳定账号可绑定、模型元数据可读及真实任务成功，避免通过猜测目录、默认 OAuth 条目或其他 CLI 的能力扩大权限。

## ADDED Requirements

### Requirement: 独立 CLI 与明确来源

插件 SHALL 使用规范 ID minimax，接受 minimax、minimax code、mmx、mcode 别名，并与 MiMo 的配置、偏好、账号和会话独立。可执行文件默认使用稳定 mcode 入口，数据目录 SHALL 采用用户显式配置、当前原生环境或原生默认目录，不扫描或自动切换其他账号目录。

#### Scenario: 别名派遣
- **WHEN** 用户明确指定 mmx 或 mcode
- **THEN** 打开 MiniMax Code 自身选型流程，不派往 MiMo、Cursor 或其他 CLI。

#### Scenario: 其他账号目录存在
- **WHEN** 默认来源没有登录，但磁盘或 shell 包装器中存在其他 MiniMax 账号目录
- **THEN** 保留当前来源的登录要求，不自动搜索、借用或切换账号。

### Requirement: 当前原生认证与私有读取

Host SHALL 仅以当前选定 prod/cn 或 prod/en 原生认证为依据，有界核对普通私有文件及读取前后身份。认证状态、凭据记录、generation、client、audience、scope 和 region/env 必须一致；链接、多硬链接、超限、损坏、并发替换或不明确路由 MUST 拒绝，不暴露凭据和原始错误载荷。

#### Scenario: 匹配的当前文件认证
- **WHEN** 当前来源的认证状态及凭据均有效、范围匹配且读取稳定
- **THEN** 返回允许字段组成的本地状态，不将其称为模型权益或远端调用成功。

#### Scenario: 退出、过期或升级范围
- **WHEN** 当前原生状态为退出中、已退出、过期或 scope_upgrade_required
- **THEN** 保留该实际状态并阻止模型查询及任务，不从其他目录或旧快照恢复登录。

#### Scenario: 读取不安全或路由有歧义
- **WHEN** 文件不安全、文件在读取中改变、两个区域竞争且没有明确选择，或原生范围不支持
- **THEN** 返回固定的不可用或尚不支持提示，不读取目标外的账号，不回退另一来源。

### Requirement: 稳定账号绑定与重检

MiniMax 目录、选型和任务 SHALL 绑定当前来源及稳定原生账号身份。可采用当前凭据的 subject/accountId，或与当前 access token 指纹、env、region 精确匹配且 verified 的原生身份缓存。token 本身、token 哈希、generation、显示名和独立缓存 MUST 不作为稳定主体；身份无法证明时保留已配置状态并拒绝绑定。

#### Scenario: 同账号续期
- **WHEN** 同一账号更新令牌或 generation，且当前来源仍能证明相同稳定身份
- **THEN** 稳定账号绑定不因令牌轮换而改变，但后续操作仍重新核对当前认证。

#### Scenario: 缓存陈旧或身份缺失
- **WHEN** 只有身份缓存、缓存指纹与当前令牌不同，或凭据没有可核对主体
- **THEN** 不把缓存当作登录或当前身份；提示已保存认证但当前身份不可确认，不发布可执行目录。

#### Scenario: 换号、换区域或换目录
- **WHEN** 保存选型、出队、启动或续聊时检测到账号来源改变
- **THEN** 原选择失效，不继续原会话，也不静默切换账号、模型或 CLI。

### Requirement: 原生模型与强度回执

可选模型 SHALL 来自当前自身认证通过的零 prompt ACP 会话的实际 model 选项；选项值保持原样不透明标识。强度 SHALL 以设置该模型之后回执的 thinkingEffort 为准，仅开放可以准确映射的实际选项。公共配置、默认 OAuth provider 行、SDK 未实现方法或未知强度 MUST 不作为执行证据。

#### Scenario: 不同模型具有不同强度
- **WHEN** 选择模型后原生返回新的 thinkingEffort 选项
- **THEN** 仅显示这些实际强度，提交 prompt 前应用选择并确认当前值，不沿用前一模型的强度。

#### Scenario: 没有独立强度
- **WHEN** 所选模型没有 thinkingEffort 控件
- **THEN** 只提供 default，不生成 high 等猜测参数。

#### Scenario: 当前 API 或自定义来源与旧 OAuth 并存
- **WHEN** 当前默认来源已切换 API/custom，或模型/提供商配置覆盖认证、请求头、服务地址，而旧 OAuth 文件仍然存在
- **THEN** 首阶段明确拒绝该尚未支持的来源，不用旧 OAuth 主体授权其他路由；目录期间配置 A→B→A 也必须失效。

#### Scenario: 原生要求登录
- **WHEN** initialize 成功但 session/new 或 session/load 返回原生登录要求
- **THEN** 明确说明当前原生来源需登录，不发布目录，不将错误包装成单纯的插件识别失败。

### Requirement: 元数据生命周期和零 prompt

目录查询 SHALL 有界且可取消，不发送模型 prompt、附件或 MCP，不写入用户配置、复制认证或删除历史。查询完成后必须确认本次进程范围退出并重新核对来源；清理或账号一致性失败 MUST 丢弃目录。原生 session/new 可能留下空会话的事实必须在文档中说明。

#### Scenario: 查询完成但清理失败
- **WHEN** 已读取目录但本次进程范围退出无法确认
- **THEN** 不发布结果，按该 CLI 元数据保护机制拒绝后续冲突操作。

#### Scenario: 查询期间换号或取消
- **WHEN** 用户取消查询或自身账号在查询期间变化
- **THEN** 停止受管请求并等待范围退出，旧结果不可选择，不发送探测性生成任务。

### Requirement: 原生权限与能力门禁

MiniMax SHALL 在 prompt 前通过原生 select 配置确认进程级 permissionMode=default（Ask），并确认会话处于 default 模式。Plan 由于延迟转移语义暂不开放；auto、bypassPermissions、附件、工具/MCP 注入、fork 和实时 steer MUST 拒绝。非预期文件、终端、权限和问题请求不得自动批准。

#### Scenario: 当前权限是自动或绕过
- **WHEN** 原生会话报告 auto 或 bypassPermissions
- **THEN** 只请求切换为 default 并检查完整回执，无法确认时不提交 prompt。

#### Scenario: Plan 或额外能力被请求
- **WHEN** 用户或协议请求尚未开放的能力
- **THEN** 给出具体不支持原因；Plan 在启动模型进程前拒绝，其他额外权限按拒绝结果处理，不误报成功。

### Requirement: 精确恢复与真实终态

任务 SHALL 使用独立 minimax-acp-v1，核验 ACP v1 与 minimax-code 原生身份。恢复必须保留同一 cwd、账号与精确会话 ID，加载历史不计入本轮输出。成功只接受有匹配身份的 end_turn 和可核查本轮正文；错误、取消、限额、缺失终态或未完成工具 MUST 不报告成功。

#### Scenario: 恢复已有任务
- **WHEN** 结束后的 Worker 继续执行
- **THEN** 加载保存会话和原 cwd，不新建替代会话，加载阶段的历史重放被抑制。

#### Scenario: 返回错误身份或不完整结果
- **WHEN** CLI 身份、协议、会话、cwd、模型不符，或终态缺失/为 cancelled/max_turn_requests
- **THEN** 拒绝 prompt 或报告本轮失败/中断，保留已有正文及准确诊断，不补造完成。

### Requirement: 取消与持久数据保护

停止 SHALL 先发送本轮 session/cancel 通知，再等待受管进程范围静默和退出确认。清理失败不得报告停止成功或删除仍在使用的状态；原生账号、配置、历史和其他 CLI 产物 MUST 保持不变。

#### Scenario: 用户停止正在运行的任务
- **WHEN** 用户取消当前 MiniMax 轮次
- **THEN** 通知原生取消并等待范围退出，不仅凭取消发送成功就解锁后续写任务。

### Requirement: 可观察性与验证诚实

界面 SHALL 复用现有主题、状态和 Gateway，仅展示允许的账号摘要、确切模型与真实公开过程。未知用量保持未知；文档 MUST 区分静态源码、模拟回归、零 prompt 初始化、已认证目录、真实模型和 Windows 验收。

#### Scenario: 只有模拟测试和登录拒绝证据
- **WHEN** 自动回归通过但当前默认来源原生仍要求登录
- **THEN** 报告实现和模拟覆盖范围及真实阻塞，不宣称账号可用、模型成功或 Windows 已验收。
