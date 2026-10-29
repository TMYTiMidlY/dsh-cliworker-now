# Spec Delta

## MODIFIED Requirements

### Requirement: 自身账号来源
Host SHALL 仅识别各 CLI 自身原生账号目录、插件内该 CLI 登录目录、自己配置的 API Key、私有环境文件，以及经用户明确授权并按原生白名单登记的同 CLI 独立导入 profile。Host 凭据引用、继承的通用密钥及其他 CLI 账号 MUST 不成为本 CLI 登录证据或由插件注入执行。原生登录同一服务商属于本 CLI 自身来源，不按服务商名称误判跨 CLI；插件不额外提供操作系统级文件禁读隔离。

#### Scenario: 只有其他账号
- **WHEN** 仅 Harness 或其他 CLI 有账号
- **THEN** 本 CLI 无可用模型，任何入口均不能启动模型任务

#### Scenario: 自身 API 配置
- **WHEN** 用户在该 CLI 自身配置中设置 API Key 或私有环境引用
- **THEN** 只允许当前账号确认支持且 CLI 能执行的模型；Claude 自身显式网关配置按其专门目录规则处理。通用环境及其他 CLI 文件引用无效

#### Scenario: Claude 自身配置与继承路由环境
- **WHEN** CC Switch 在 Claude 自身 settings 中写入路由，同时宿主继承了旧的凭据或模型变量
- **THEN** 当前自身 settings 决定查询及执行来源；继承变量被该进程覆盖，不单独作为账号证据，不影响其他 CLI 或改写原生配置

#### Scenario: 用户授权的原生独立导入
- **WHEN** 用户将支持的同 CLI 原生鉴权登记为独立 profile
- **THEN** 该私有版本成为明确的自身来源；不能从服务商同名、目录名或其他工具现有凭据推断出额外导入授权

### Requirement: 账号绑定和执行重检
Host SHALL 以不含秘密的账号来源版本绑定目录与任务，在保存选型、启动、出队及续聊重新检查。账号改变、退出、模型或强度失效 MUST 阻止任务，不能静默换号、换模型或 CLI。续期须满足所选来源的固定身份合同；导入的 oauth-credential refresh-backed 模式仅在 R0 不变且其他原生检查通过时允许合同内正常 access/expiry 更新；该 kind 的原生 access-only 模式固定 A0，不跨模式替换。native-principal 与 API 来源仍按各自已证合同。已登记 profile 的当前来源是其固定私有版本而非最初导出目录，不得回借来源或另一 profile；legacy 来源保留既有合同，不自动迁移。

#### Scenario: 选型与排队期间换号
- **WHEN** 用户回答选型期间或任务排队期间退出、换号或切换来源
- **THEN** 原选择不能自动用于新账号，提示重新选择或派遣

#### Scenario: 续聊与旧快照
- **WHEN** 所选当前来源的原账号已经退出或换号，旧 Worker 中仍有凭据
- **THEN** 不恢复旧账号或覆盖当前来源；历史可查看，换号后要求新建任务

#### Scenario: 历史任务没有账号绑定
- **WHEN** 升级前的历史任务没有可核验的原账号绑定
- **THEN** 保留历史并要求新建任务，不把当前账号自动绑定到旧原生会话

#### Scenario: 权限与强度撤销
- **WHEN** 账号未变但所选模型或强度不再可用
- **THEN** 启动前拒绝，不发送 prompt，不选择替代项

#### Scenario: 原生续期无法保护当前账号
- **WHEN** OpenCode OAuth 等原生续期缺少版本条件写回，无法阻止退出或换号后恢复旧凭据
- **THEN** 保留真实登录状态，该模式返回空目录并拒绝执行；同一 CLI 自身 API 配置仍可按当前账号范围开放

#### Scenario: 导出目录变化与独立来源
- **WHEN** 已明确导入的原目录后来退出或更换，而独立 profile 自身未变
- **THEN** 只核验该 profile 的固定身份合同和原生能力，不把本地导出目录变化当作它已退出；供应商撤销或 profile 自身 pin/授权失效仍阻止任务，不把 pin 连续性称为远端账号证明

#### Scenario: 导入 OAuth 自身正常续期
- **WHEN** profile 私有根的固定 R0 未变且 Native 合同允许的 access/expiry 更新及其余检查均通过
- **THEN** 旧 Worker 仍可用原私有根，不把所有 token 更新都当换号，也不要求新材料版本

#### Scenario: 固定凭据改变但旧绑定未变
- **WHEN** 相同私有根/材料版本的固定 pin 或模式已经改变，即使 legacy binding、邮箱或 JWT 显示仍相同
- **THEN** 阻止新准入，不以 legacy 的 token-independent binding 替代目标 pin 前后重读，不重新固定最新凭据，不猜已换远端账号或当前额度

#### Scenario: 失配发生在 Native 已执行之后
- **WHEN** 操作执行后重检发现固定 pin 失配
- **THEN** 继续阻止后续 prompt，但保留实际当轮正文/产物、原生退出和清理证据，不回写历史成功或失败，不自动换号重发；停止仍控制已拥有的进程

### Requirement: 安全迁移及生命周期
升级 SHALL 停用旧 Host 路由和未经明确原生导入登记的派生认证快照，只清理可确定由插件生成且不再使用的配置；原生账号、插件登录账号、已登记独立 profiles、会话和偏好 MUST 保留。凭据不得返回客户端或入日志，清理未确认退出的进程前不能删除快照或放行后续任务。

#### Scenario: 旧配置升级
- **WHEN** 旧部署保留 Host 引用、自动生成 provider 或未登记凭据快照
- **THEN** 引用不生效，派生状态按本 CLI 当前账号重建，旧偏好不静默转换；不把这种缓存自动登记为用户导入 profile

#### Scenario: 清理失败
- **WHEN** 元数据或模型进程范围退出无法确认
- **THEN** 保留相关私有状态并阻止后续任务，不报告停止成功

#### Scenario: 已有独立 profile 升级
- **WHEN** 插件热更新或重启且已有合法登记的私有版本及其 Worker
- **THEN** 保留该版本和原生数据，不重新复制来源、不改写已绑定会话，不因版本升级恢复被停用的 profile
