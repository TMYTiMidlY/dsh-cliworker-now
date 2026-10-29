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

MiniMax 目录、选型和任务 SHALL 绑定当前来源及稳定原生账号身份。主体只能来自与当前 access token 指纹、env、region 精确匹配且 verified 的原生身份缓存，或本规格的受限固定 userinfo 验证得到的字符串 realUserID。未核实的 credential.subject/accountId、legacy profile、token 本身、token 哈希、generation、显示名和独立缓存 MUST 不作为稳定主体；身份无法证明时保留已配置状态并拒绝绑定。

#### Scenario: 同账号续期
- **WHEN** 同一账号更新令牌或 generation，且当前来源仍能证明相同稳定身份
- **THEN** 稳定账号绑定不因令牌轮换而改变，但后续操作仍重新核对当前认证。

#### Scenario: 缓存陈旧或身份缺失
- **WHEN** 只有身份缓存、缓存指纹与当前令牌不同，或凭据没有可核对主体
- **THEN** 不把陈旧缓存或未核实字段当作当前身份；本地摘要保持已配置，正式准入必须先按受限 userinfo 规则独立核对，未验证成功前不发布可执行目录。

#### Scenario: 换号、换区域或换目录
- **WHEN** 保存选型、出队、启动或续聊时检测到账号来源改变
- **THEN** 原选择失效，不继续原会话，也不静默切换账号、模型或 CLI。

### Requirement: 模型前受限自身身份验证

正式目录/绑定 SHALL 在已验证且未过期的当前标准 prod OAuth proof 上，以固定区域原生 userinfo GET 验证缺失的稳定身份，且完成后重读并核对完整来源/认证快照；确认字符串 realUserID 前 MUST 不启动模型进程、原生会话或 prompt。普通本地账号摘要 MUST 不因轮询隐式请求网络。原生 CLI 能生成不等于 userinfo 成功，不得要求用户盲目清除配置或重新登录。

#### Scenario: 有效 OAuth 但原生身份缓存缺失
- **WHEN** 当前来源和 OAuth 范围/有效期合格，但默认 native shared-core 未持久化 verified cache
- **THEN** 只向该区域固定 prod 身份 host 的 /v1/api/user/info 请求一次，按原生签名/query合同和当前 Bearer 验证，成功且前后 proof 不变才建立 realUserID 主体并进入模型目录。

#### Scenario: 身份验证失败或不可用
- **WHEN** HTTP/业务状态拒绝、响应缺少字符串 ID、网络超时/取消、redirect、畸形或超过64KiB
- **THEN** 保留 configured 与准确的固定验证说明，不调用模型、不改写登录/凭据、不自动刷新/重试，不公开原始 key/URL/query/header/error/body 或 PII。

#### Scenario: 身份请求期间来源变化
- **WHEN** config/root/env/region、当前状态、generation/loginEpoch/scopes/expiry/token 或文件 stamp 在请求前后变化（包括 A→B→A）
- **THEN** 丢弃响应/缓存，不用旧 proof 授权新来源；同一真实 UID 正常续期后重新验证可保持稳定主体。

#### Scenario: 任一身份准入阶段取消
- **WHEN** 调用方在本地摘要/初始 proof 读取、网络等待、成功后的 proof 重读或正式账号 binding 前后取消
- **THEN** MiniMax 边界只返回固定 AbortError，不保留原 reason/cause 或私人标记，不启动模型，不因 generic binding catch 恢复原始异常；其他 CLI 的取消行为不改变。

#### Scenario: 短期内存缓存与并发
- **WHEN** 相同来源/token-epoch 的身份验证并发或短期重复
- **THEN** 可复用有界内存 pending/cache，但每个调用者都重新核对自身快照、取消隔离，来源或 token 更新不得沿用旧缓存，缓存不落盘或保存 token。

### Requirement: 原生模型与强度回执

可选模型 SHALL 来自当前自身认证通过的零 prompt ACP 会话的实际 model 选项；选项值保持原样不透明标识。强度 SHALL 以设置该模型之后回执的 thinkingEffort 为准，仅开放可以准确映射的实际选项。公共配置、默认 OAuth provider 行、SDK 未实现方法或未知强度 MUST 不作为执行证据。

#### Scenario: 不同模型具有不同强度
- **WHEN** 选择模型后原生返回新的 thinkingEffort 选项
- **THEN** 仅显示这些实际强度，提交 prompt 前应用选择并确认当前值，不沿用前一模型的强度。

#### Scenario: 没有独立强度
- **WHEN** 所选模型没有 thinkingEffort 控件
- **THEN** 只提供 default，不生成 high 等猜测参数。

#### Scenario: 当前 API 或自定义来源与旧 OAuth 并存
- **WHEN** 当前默认来源已切换 API/custom，或模型/提供商配置包含未支持的认证、请求头、非原生托管服务覆盖，而旧 OAuth 文件仍然存在
- **THEN** 首阶段明确拒绝该尚未支持的来源，不用旧 OAuth 主体授权其他路由；目录期间in-place A→B→A或已被观测到的配置内容/路由变化必须失效。

### Requirement: 标准托管显式配置不是 API 身份

Host SHALL 依照原生有效认证路由先检查显式 authMode、再判定已知 managed HTTPS origin，并同时核对 token_plan、默认 minimax 提供商及原生 Anthropic npm。原生托管显式 endpoint 与字面量 sk-xxx 或缺省 key SHALL 不因字段存在而被误拒，但 MUST 不作为登录或稳定身份；OAuth 私有读取、主体、scope、有效期与配置来源一致性仍须满足。原始 key、URL 和异常载荷 MUST 不公开。

#### Scenario: 合法 managed 显式 endpoint 与占位 key
- **WHEN** token_plan、minimax、Anthropic npm 一致，authMode 为 managed-login 或省略且由原生三个精确 HTTPS origin 推断，端点无 URL 用户凭据，key 为 sk-xxx 或缺省
- **THEN** 允许进入原有自身 OAuth 检查，不要求清除配置、不把占位 key 当 API 认证，不直接发布目录或启动 prompt。

#### Scenario: 显式 API、真实 key 或未知服务
- **WHEN** 显式 authMode 为 api-key/oauth、存在真实或未知 key，或 endpoint 非 HTTPS、含 URL 用户凭据、畸形或不在原生托管集合
- **THEN** 保留固定的暂不支持路由提示；token_plan、占位或旧 OAuth 均不得覆盖此判别，不展开普通 provider key 的环境变量表达式。

#### Scenario: 占位配置没有当前自身 OAuth
- **WHEN** 托管配置合法但当前原生 OAuth 不存在、未就绪、过期或无法证明稳定主体
- **THEN** 保留准确的未配置/待续期/身份不可确认状态，拒绝可执行目录及派遣，不将配置兼容修复冒充真实认证成功。

#### Scenario: 原生要求登录
- **WHEN** initialize 成功但 session/new 或 session/load 返回原生登录要求
- **THEN** 明确说明当前原生来源需登录，不发布目录，不将错误包装成单纯的插件识别失败。

### Requirement: 稳定配置绑定与操作内版本

配置source/Binding route SHALL 使用安全读取并通过原route检查的完整raw fingerprint，不以同内容原子替换的inode变化更换账号。Host SHALL 私有维护source配置版本和≤64每root registry：同raw同stamp或同raw且新inode、相同dev/size/mode/nlink/uid/gid且安全检查通过的原子替换可继承版本；其它变化、缺失/不安全读取或淘汰导致旧操作失效。readOwn前后及proof epoch MUST 纳入私有配置版本，userinfo clone须继承；不得归一化state/credential/cache戳，不输出版本值或内容。

#### Scenario: Native安全同内容原子保存
- **WHEN** 原子替换前后raw字节完全相同、安全owner/属性条件满足且只变inode/时间
- **THEN** 稳定binding和本操作config版本相同，允许继续原身份/模型/清理校验，不因该保存声称用户换号。

#### Scenario: 原地触碰或已观测内容路由变化
- **WHEN** 同inode戳变，或实际raw/route改变后被观测（包括A恢复A），或文件缺失/不安全读取/ledger淘汰
- **THEN** 操作版本改变或无法沿用，跨该变化的元数据拒绝；相同A恢复A的稳定binding仍相同，不把操作版本持久成账号ID。

#### Scenario: 未观测原子ABA的快照边界
- **WHEN** 有目录写权限的对抗者在两次观测间完成atomic A→B→A且最终同raw/安全属性
- **THEN** 文档必须说明快照无法证明写入者或完整发现此事件，不声称所有配置ABA检测；完整凭据/state/cache戳与其它门禁不变。

### Requirement: 元数据生命周期和零 prompt

目录查询 SHALL 有界且可取消，不发送模型 prompt、附件或 MCP，不写入用户配置、复制认证或删除历史。查询完成后必须确认本次进程范围退出并重新核对来源；清理或账号一致性失败 MUST 丢弃目录。原生 session/new 可能留下空会话的事实必须在文档中说明。

#### Scenario: 来源后验检查未通过
- **WHEN** 已验证目录的账号前后快照比较失败
- **THEN** 保留拒绝结果，只返回固定差异类别帮助区分主体/来源/版本或认证未就绪，不公开路径、凭据、原始身份或指纹，不将未证实的差异泛称为用户换号。

#### Scenario: 后端扩展子进程环境
- **WHEN** metadata进程后端给传入env附加自身字段
- **THEN** 仅修改启动环境副本，不改变已核账号来源快照；保留原epoch/来源/凭据/ABA后验，真实来源变化仍拒绝。

#### Scenario: 查询完成但清理失败
- **WHEN** 已读取目录但本次进程范围退出无法确认
- **THEN** 不发布结果，按该 CLI 元数据保护机制拒绝后续冲突操作。

#### Scenario: 查询期间换号或取消
- **WHEN** 用户取消查询或自身账号在查询期间变化
- **THEN** 停止受管请求并等待范围退出，旧结果不可选择，不发送探测性生成任务。

### Requirement: ACP 目录安全失败诊断

目录失败 SHALL 保留首次失败的固定阶段/原因与安全布尔检查，RPC/退出/信号只使用固定白名单投影；清理状态独立，不能覆盖首错或放宽ProcessCleanupUnconfirmed门禁。诊断 MUST 不携带原始wire、错误正文/stack/cause/cancel reason、凭据、URL/header/PII、模型/账号/会话标识或私人路径，不新增持久日志或Remote字段。

#### Scenario: 稀疏控件或阶段合同失败
- **WHEN** session/new成功但缺model/permission，或初始化/选择模型/帧/时限等阶段不满足现有严格合同
- **THEN** 返回固定安全phase/reason及必要bool，不补控件、不猜模型、不改变时限或登录状态，不报告目录成功。

#### Scenario: 首错后退出与清理异常
- **WHEN** reader/RPC先失败，随后取消、退出或finally再失败
- **THEN** 首错phase/reason保持不变，退出值及cleanup独立投影；清理未知仍抛原typed cleanup error，禁止发布目录。

#### Scenario: 选择模型返回内部错误
- **WHEN** phase为select_model且RPC严格为数值-32603
- **THEN** 只将已核Native固定data.details literal或结构化直接code/key/message映射native_error与envelope_kind枚举，精确匹配且冻结首错；未知/矛盾为other，不凭泛VALIDATION_ERROR推断参数，不输出任何原文/未知字段/长度/hash/stack/URL，不改变wire、身份、effort、时限或清理门禁。

#### Scenario: 其他阶段或非内部错误
- **WHEN** phase不是select_model或RPC不是数值-32603，包括timeout/cancel
- **THEN** 不提取或附加Native内部错误分类，保持既有诊断和成功目录不变。

### Requirement: 仅发布已验证配置子集

Host SHALL 仅在model setter的pending方法/configId/原始广告值/当前owned session及row均匹配，phase为select_model、数值RPC=-32603且exact native_error为param_reasoning时局部隔离该配置拒绝。拒绝 MUST 不触发全局fail或污染后续首fatal；其它错误仍整份拒绝。下一tuple前 SHALL 在原15秒预算、同owned进程/source新建干净空session，strict核原完整广告ID集合，不重试或偷偷加入新配置。仅实际确认的exact model和该model真实effort可发布，至少一项，并通过现有notice明确广告/verified/rejected配置数量；不得把某配置拒绝称整模型不可用。

#### Scenario: 一配置被明确拒绝后其它配置通过
- **WHEN** 一初始广告tuple收到作用域准确的param_reasoning拒绝
- **THEN** 只记录该tuple一次，下一tuple先验证干净session及原广告集合，再逐项确认，发布明确标记的验证子集；同model另一variant不被连带删除。

#### Scenario: 子集期间发生fatal或全部未验证
- **WHEN** 新/后态不符、late/未知RPC、广告漂移、取消/限额、来源变化/清理未知，或没有任何实际验证项
- **THEN** 整份结果作废，保留首fatal及清理优先级，不造default-only或复制别的model effort。

#### Scenario: 精确当前选择不必重复设置
- **WHEN** strict Native state确认目标model已广告且exact current value相同，或该model的非default requested effort已支持且exact current相同
- **THEN** 专用catalog/run不发冗余setter，使用真实当前回执；不同选择仍set并strict确认，最后fresh Ask/default与model/effort漂移检查不得跳过。

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
