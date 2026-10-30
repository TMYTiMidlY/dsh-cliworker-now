# Spec Delta

## Purpose

定义多个 CLI 原生鉴权的独立导入、私有持久保存及显式选择合同，使 Agent 能在不同账号来源之间建立新任务，同时保证查询与执行使用同一来源、已有会话不串号、秘密不进入公共回执，并清楚区分本地副本与独立服务端授权。

## ADDED Requirements

### Requirement: 原生鉴权白名单导入
Host SHALL 仅从用户明确授权的同 CLI 原生文件来源导入白名单鉴权及必要路由和保护配置。首批支持已核文件模式的 AGY、MiniMax 标准 prod、Codex file auth；不支持的格式、平台或保护策略 MUST 明确拒绝。账号命令别名不是可执行导入入口，不执行 wrapper、shell source 或任意脚本。

#### Scenario: 已识别来源与显式目录
- **WHEN** 用户选择已识别原生来源或提供明确原生目录并导入
- **THEN** 校验该 CLI 的格式和来源后创建私有 profile，来源文件不被改写，返回非秘密 ID、标签、CLI、版本及安全状态

#### Scenario: 别名没有来源证据
- **WHEN** 只给 mcode-agony 或 codex-ljy 等名称而没有已登记来源或可确认目录
- **THEN** 返回缺少来源的短错误，不猜路径、不执行命令、不创建可用 profile

#### Scenario: 未核格式或危险文件身份
- **WHEN** 来源为未知 schema、keyring/auto 的未证文件、鉴权符号链接、多硬链接、非普通文件、权限不安全或读取期间发生替换
- **THEN** 导入失败且不发布半成品，不返回文件内容或底层私密异常，不修改原账号

#### Scenario: 设置缺失必须被守护
- **WHEN** 支持的来源将必要设置声明为缺失
- **THEN** 只接受已核现存安全父目录下的叶项 ENOENT；缺祖先、权限错误、非目录或悬空链接不当作空配置，读取及目标验证窗口内创建再删除也须拒绝发布

#### Scenario: 已证 lxy 共享设置
- **WHEN** 导入已证 lxy 的 settings-only 链接来源
- **THEN** 同时守护链接文本/身份/祖先和已选择的 canonical 普通设置文件，只复制该账号鉴权和必要设置，不读取默认 token，不放行鉴权链接、多跳或任意目标；输出设置是私有普通文件

#### Scenario: 设置别名或祖先恢复原样
- **WHEN** 相关链接、目标或祖先在守护窗口内被替换或移走再恢复，即使最终路径、目标文本或 inode 相同
- **THEN** 拒绝发布，不能仅以前后最终值相同证明无变化；未知观察事件或溢出同样不能放行

### Requirement: OAuth 凭据固定身份
Host SHALL 将 OAuth 凭据固定与已证 Native principal、API credential 区分。AGY 已证 refresh-backed 来源固定精确 R0，仅在 R0 不变且独立原生检查通过时允许正常 access-token/expiry 更新；原生已证 access-only 来源在独立域固定 A0。固定依据 MUST 不被改变、重新接纳或跨模式降级，亦不构成远端账号、grant 或有效授权证明。

#### Scenario: 相同 R0 的正常续期
- **WHEN** 当前 profile 的 R0、模式和原生路由域不变，只有合同内正常 access-token/expiry 更新且其他原生检查通过
- **THEN** 仍允许使用原私有根和固定 Worker，不仅因 access 更新要求新 profile、材料版本或 Worker

#### Scenario: R0 轮换或消失
- **WHEN** 当前私有根中的 R0 改变、消失、为空或无效，即使 access-token、邮箱、JWT 声明、标签或根未变
- **THEN** 原绑定不再准入新 prompt，不接纳新 R、不转为 access-only；明确切换须新 profile 和新 Worker，不恢复旧凭据或回借来源

#### Scenario: 真实 access-only 模式
- **WHEN** 来源本来就是有格式证据的原生 access-only 材料
- **THEN** 固定精确 A0；A0 变化或引入 refresh-backed 模式不能沿用原绑定，不删除 refresh 或改造字段制造这种来源

#### Scenario: 模式或证据种类不同
- **WHEN** 相同 secret 字符串分别用于 refresh、access、API 或其他身份 kind/路由域
- **THEN** 不认作同一身份，不通过 trim、邮箱或路径归一化合并，不跨 kind 或模式接受旧绑定

#### Scenario: 物理一致不等于令牌配对证明
- **WHEN** 文件快照、格式、R0 比较或目录查询成功，但没有当前 access-token 主体及其与 R0 同 grant 的原生证明
- **THEN** 不宣称这些结果证明账号或 A/R 配对一致，不伪造检测器、JWT 证明、强制刷新或新身份接口补证；所需原生来源合同未证的模式仍不开放

#### Scenario: 相同 pin 但授权失效
- **WHEN** pin 未变，但原生校验发现过期、撤销、不可用或其他必要合同失败
- **THEN** 按实际原因拒绝，不以 pin 相同报告已登录、目录或任务成功，不回退其他来源

### Requirement: OAuth 原始期望与核验时点
OAuth 模式与 pin SHALL 来自已授权源样本，在目标原生核验前后和后续准入时重新比较同一原始期望。首次核验轮换、目标保护变化、取消或源守护失败 MUST 不发布可用材料。已提交回执不替代当前有效性核验；实际运行后发生的失配不得改写已有执行、退出或清理证据。

#### Scenario: 首次目标核验轮换
- **WHEN** 目标 Native 核验将原始 R0 变为 R1 或改变模式
- **THEN** 首次导入可失败且零可用 profile，不把 R1 当基线发布；不回滚目标到旧 token，不回借源或重放业务 prompt，亦不承诺该次远端刷新没有副作用

#### Scenario: 目录探测后 pin 漂移
- **WHEN** Native 目录探测返回后重读的 pin 不匹配原始期望
- **THEN** 不保存该目录证明或准入后续 prompt，不以探测返回正文冒充来源仍有效，先确认其真实进程清理

#### Scenario: 核验之后保护改变
- **WHEN** 目标初始化或 Native 核验改变必要保护配置，即使 pin 相同
- **THEN** 重新核对等价保护；无法确认则不发布，不把身份通过当作保护通过

#### Scenario: 重放已提交请求
- **WHEN** 同一 request ID 精确重放已有成功导入的请求
- **THEN** 只返回原提交回执，不再次导入或接纳新 pin；实际选择该材料时仍须核验当前 pin 和授权

#### Scenario: Native 已运行后失配
- **WHEN** Native 请求已经执行，之后才发现 pin 失配
- **THEN** 阻止后续准入并保留本 run 的正文、产物、原生退出与 cleanup 各自证据，不倒填零执行、未知 exit0、当前额度或业务必然失败，不自动重发

#### Scenario: 取消与清理未确认
- **WHEN** source guard 已退出或请求取消，但目标 Native 的进程范围尚未确认退出
- **THEN** 不以 helper 退出宣称目标清理成功，保留实际清理未确认状态且零发布，不被通用取消或验证错误掩盖

### Requirement: 版本化私有身份恢复
已登记 OAuth 材料 SHALL 使用可辨别身份 kind、模式、策略版本、CLI 及原生路由域的私有合同恢复。未知或缺失的必要身份信息 MUST 拒绝，不试多个身份类型、重新固定当前文件或回退默认。旧格式仅按其原有合同读取，不将旧摘要自动解释为新 OAuth 模式。

#### Scenario: 冷恢复当前材料
- **WHEN** Host 重开并恢复一个已登记 OAuth 材料或旧 Worker
- **THEN** 按原固定版本合同重读该材料自己的当前私有根；同 materialRevision 或路径不豁免 pin 核验，不回读原导出目录

#### Scenario: 未知 kind 或模式
- **WHEN** 已登记材料的必要 kind、mode、策略版本或路由域缺失、不受支持或无法核验
- **THEN** 拒绝来源，不补 native-principal/default、不覆盖旧签名记录、不自动迁移 legacy default/lxy

### Requirement: MiniMax固定Native上下文
MiniMax标准prod文件导入 SHALL 保留其已证native-principal身份，并用已签名的私有版本化policy固定cn/en、文件合同、保护模式及opaque刷新组。冷恢复 MUST 在任何携带凭据的UID或Native I/O之前验证policy并固定域，不从可变布局、marker、部署默认或环境回退选择端点。

#### Scenario: 修改布局试图换区域
- **WHEN** 已登记cn材料的可变文件被重键或改成en布局，即使格式有效且只有一个区域
- **THEN** 原签名policy仍固定cn，失配MUST在另一域消费凭据前拒绝，不以稍后的principal摘要失败补证

#### Scenario: 缺失和显式空配置
- **WHEN** 支持的0.6.12来源config为缺失或显式空mapping
- **THEN** 二者MUST保持不同的已证原生默认语义；native-default policy可接受原生初始化后的已证六字段形状，empty不得变成该另一模式
- **AND** 未知provider/全局保护字段、已有未支持permission文件/plugin-hook-permissions不得静默丢弃；未选择account-only的原strict-source切片仍须证明agents真实absent

#### Scenario: 用户明确只导入账号而非业务环境
- **WHEN** 用户明确选择MiniMax account-only，来源含业务agents或其目录链接
- **THEN** 不读取、跟随或复制业务定义/提示/工作目录/历史，不把新独立原生档案说成原业务行为的完整克隆
- **AND** 仍核验必要连接、全局权限及隐私设置；未知保护或不能安全保留时明确拒绝，不把不迁业务当作忽略全局保护的理由

#### Scenario: 账号-only保护漂移
- **WHEN** 已登记的account-only目标配置改变dataContribution/memory、Ask模式、hard safety flags或加入未知保护
- **THEN** 按原signed configDigest及严格目标schema拒绝，不能重新投影或normalize坏目标来匹配旧期望，亦不重设原身份合同

#### Scenario: 原始期望贯通真正metadata和Native门口
- **WHEN** 目标初次verifier已通过，但后续普通metadata或任务将携带凭据启动Native
- **THEN** MUST按原signed保护摘要检查同次raw设置及当前private root/global保护，不信可变prepared env，Native bridge核真正继承和覆盖后的有效root/region/prod环境；不将早先成功替代当前门口

#### Scenario: 收尾持久化错误与清理证据
- **WHEN** Native已执行且scope关闭前后发生诊断或状态写入错误
- **THEN** MUST仍join owning scope且保持实际confirmed或unconfirmed清理；真实cleanup品牌不得被普通EIO/取消掩盖，未确认组继续隔离，已确认不伪造清理未知

#### Scenario: 私有policy与旧格式兼容
- **WHEN** 新MiniMax policy发布并与旧legacy或OAuth材料共存
- **THEN** 旧摘要算法、schema1/manifest1及旧回执MUST保持字节合同，新policy采用独立域且不自动升级旧MiniMax材料

### Requirement: 独立私有版本存储
导入 SHALL 存入独立私有版本，不依赖回读原来源、凭据链接或共享历史；POSIX 目录0700、文件0600，Windows 必须有相应 ACL 证据。导入 MUST 不复制历史、会话数据库、锁、缓存、MCP、hooks 或外部可写路径；无法等价保留原生保护策略时拒绝，不以导入隔离为由放宽保护。

#### Scenario: 导入后来源本地文件变化
- **WHEN** 已成功登记的 profile 来源后来被移动、更换或退出
- **THEN** profile 仅按自己的当前来源版本、固定身份合同及原生能力核验，不恢复或回借来源；OAuth pin 不是远端账号证明，供应商已撤销授权时仍拒绝任务

#### Scenario: 导入失败与重开
- **WHEN** 多文件快照不一致或写入/核验被取消，随后 Host 重开
- **THEN** 原 profile/版本和来源保持不变，不把未完成材料识别为可用来源，不删除账号或历史

### Requirement: 固定来源贯通查询与执行
Host SHALL 一次解析 profile 及版本，并将同一上下文用于身份、模型目录、绑定、排队准入、执行及原生账号终端。父进程环境 MUST 不被修改。模型缓存与完整设定不得跨 profile/版本复用，来源失效时不回退其他账号或 CLI。

#### Scenario: 同模型名的两个 profile
- **WHEN** 两个 profile 都包含相同模型 ID，分别查询和启动任务
- **THEN** 各自核验对应来源、版本和权限，查询甲不能执行乙，其他父会话与 CLI 环境不受影响

#### Scenario: 排队期间版本变化
- **WHEN** 已排队任务选定的 profile 被停用或其固定版本无法确认
- **THEN** 原任务不发送 prompt、不切换到新版本或默认来源，返回实际失效原因并保留任务历史

### Requirement: 已有会话保持原鉴权
Worker SHALL 固定创建时的 profile、版本及原生账号绑定；续聊、换模型、fork 和重启恢复 MUST 不静默换号。切换鉴权用于明确的新 Worker；停止与清理不因当前鉴权失效而失去能力。

#### Scenario: 闲置会话改用另一账号
- **WHEN** 已有原生 conversation 的 Worker 被要求覆盖 auth_profile
- **THEN** 拒绝覆盖，原会话及角色/模型快照不变；不自动克隆任务、复制历史或重发 prompt

#### Scenario: 停用后停止在途进程
- **WHEN** profile 失效且原任务仍需停止或清理
- **THEN** 仍控制该任务已拥有的进程范围，只有清理确认后报告停止，不用另一账号重连或释放未确认保护

### Requirement: 版本管理和授权边界
profile 管理 SHALL 仅由可写非规划主会话执行，子 Agent 不得管理或递归派遣。重新导入 MUST 通过管理 CAS 并产生新版本，不覆盖旧 Worker 的原生根；同一逻辑 profile 仅接受原固定身份合同一致的材料，不跨 kind、模式、路由域或固定凭据替换。忙碌来源的破坏性管理须拒绝，失败不暴露其他父会话的任务信息。

#### Scenario: 同身份合同重新导入
- **WHEN** 对当前版本明确重新导入、管理 CAS 匹配，且所选身份合同仍相同
- **THEN** 原子发布新版本供新选择使用，旧 Worker 保留旧根；没有静默复活或跨版本继承目录证明，OAuth 材料仍须同 kind/mode/route 域和精确 pin

#### Scenario: 同邮箱的新 OAuth 凭据
- **WHEN** 新材料的 pin 或模式已经改变，即使原生显示相同邮箱或账号
- **THEN** 不覆盖原 ID 或借新材料版本迁移旧 conversation；要求明确新 profile 和新 Worker，原 root/历史保持不变

#### Scenario: 管理版本不替代材料版本
- **WHEN** profile被改名或按同一固定身份合同重新导入新材料，而旧Worker固定的材料仍合法
- **THEN** 改名不使材料过期，旧Worker仍用旧根；停用阻止新prompt但不妨碍已拥有进程的停止，不把管理CAS revision当作材料版本

#### Scenario: API来源没有稳定账号ID
- **WHEN** 重新导入的API key发生变化且原生没有可验证的稳定principal
- **THEN** 不以provider/标签/路径相同认作同账号，拒绝覆盖原ID或要求新profile，不新增身份/额度探测接口或公开credential指纹

#### Scenario: 换号或权限不足
- **WHEN** 新材料属于不同账号，或管理调用来自子 Agent、规划/整体只读会话
- **THEN** 拒绝替换或写入，零任务/零部分偏好；不同账号需创建不同 profile

### Requirement: OAuth 和额度能力的真实边界
profile 的独立保存 MUST 不被描述为独立 OAuth grant、不同账号或额外额度。原生续期只允许写自己的 profile，但新 pin 不因此获准使用；不恢复旧 token、不回写来源、不跨 profile 同步或救援认证。本轮 SHALL 不提供 Hub 导入、余额数字或额度查询，不以缺失数据返回0。

#### Scenario: 相同 grant 的副本
- **WHEN** 导入材料可能与其他本地副本共享 refresh-token family
- **THEN** 明确本地独立不保证服务端刷新互不影响，失败导入也可能产生远端刷新副作用；只对已证同身份或同固定 pin 域的插件内操作承诺串行，不承诺识别全部同账号/family 或控制外部 CLI 续期

#### Scenario: 相同 R0 的两个私有根
- **WHEN** 两个 profile/root 的已证 CLI、策略/路由域、模式及 R0 相同，即使 access-token 或标签不同
- **THEN** 导入目标验证、只读探测与模型任务等可能刷新的操作共享串行组，拿锁后重检且持锁至 owned 进程清理确认；原生 access-only 的相同 A0 仅按其独立域处理，不按 root/标签拆锁

#### Scenario: 不同 pin 可能共享授权
- **WHEN** 两份材料的 pin 不同，但其远端账号或 refresh family 关系没有证据
- **THEN** 不推断独立 grant/账号或额外额度，也不宣称它们已按同账号串行；保持目标本地写隔离和固定风险提示

#### Scenario: Hub 缺失或未接入
- **WHEN** 机器没有 Hub，或当前版本尚未接入 Hub
- **THEN** 多份原生鉴权仍可保存/选择，额度能力明确不可用，不调用未实现接口、不伪造余额、不自动按额度换号重试

### Requirement: 安全呈现与普通切换
设置和工具 SHALL 只返回 profile 的非秘密描述，区分原生当前来源、独立导入及未验证/不可用状态。Client 通过原生 Gateway 操作并复用统一设置控件；现有原生会话只呈现其固定来源，不因设置页草稿改号。

#### Scenario: 刷新和快速切换
- **WHEN** 用户切换账号页的来源或重新打开设置
- **THEN** 旧请求不覆盖新来源草稿，模型按当前来源重新读取；不显示 token、原始配置、私有托管根、指纹或假额度

#### Scenario: 关闭后重试未确认导入
- **WHEN** 导入响应未确认且用户关闭/重开同一主会话设置并以原输入重试
- **THEN** Client MUST复用尚未确认的request ID，不因组件卸载或旧组件迟到成功而清除活实例仍需的重放标识；合法回执只在当前实例消费后确认，不将对话级内存说成整页重载恢复

#### Scenario: 外围来源失效及组合回执
- **WHEN** 读取目录期间外围连接/权限状态变blocked，或应用响应与提交source/pin/model/effort不同
- **THEN** MUST取消旧请求并使目录/完整草稿失效，解除blocked后重新询Host；不同组合不显示已保存，合法Native variant按原映射核对，不以旧UI可写状态替代Host实时权限门禁
