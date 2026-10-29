# Design

## Context

动机及范围见[proposal](proposal.md)。现[AGY helper](../../../src/host/agy-account.ts)只允许default/lxy HOME；[MiniMax reader](../../../src/host/minimax-accounts.ts)已支持scoped minimaxHome，但原生record索引依赖root；[Codex reader](../../../src/host/cli-account-binding.ts#L201-L278)直接读父环境且[app-server目录](../../../src/host/codex-models.ts#L38-L44)不传显式env。[完整设定](../../../src/host/storage.ts#L590-L633)当前只按parent/project/CLI分桶，不能仅加一个启动环境参数。

现有[隔离主规格](../../specs/cli-account-isolation/spec.md)拒绝未经登记的派生快照；本变更按用户明确授权增加独立导入，不恢复旧Worker缓存。[参数化派遣增量](../parameterize-worker-dispatch/specs/worker-dispatch/spec.md)已经实施，但主派遣规格仍有旧问卡文字；本变更以已实施增量为基线，不恢复提问，最终文档同步需消除这种差异。

## Goals / Non-Goals

**Goals:** 私有保存与来源脱钩；一次解析的profile/版本贯通所有实际读取和子进程；已有Native conversation不换来源；严格拒绝隐式fallback；能够核验源文件不变及未复制历史。

**Non-Goals:** 不导入Host或其他CLI凭据，不执行账号wrapper，不复制整个HOME；不接Hub/额度，不自动按限流换号；不改Native权限、不实现Cursor builtin批准桥，不以Auth工作掩盖Kimi/OpenCode尚未完成的原生执行问题。首批外的CLI/平台不自动宣称可导入。

## Decisions

### 1. 私有registry与不可变身份版本

新增Host私有store，默认位于现有stateDirectory之下，不在仓库或profile包。公开descriptor仅含opaque ID、CLI、标签、revision、enabled及安全可用性；私有manifest保存来源种类、原生根、版本化身份依据及必要lineage。身份依据不一律称远端principal：本轮新增的OAuth凭据固定模式只证明所选secret字段的连续性，不证明远端账号或grant。没有凭据或托管根进入Worker公共DTO。标签可叫mcode-agony，但标签不是CLI命令、模型或身份依据。

材料版本materialRevision/nativeRoot只由成功导入新建；管理版本recordRevision用于label/enabled及CAS，两者不得混同。改label不使旧Worker材料过期；reimport把新选择指向新材料，但旧Worker已钉住的合法旧材料仍可在enabled状态下续聊，只有被明确撤销/损坏/身份失配才拒绝。停用阻止所有新prompt，不阻止原进程停止。Native可更新该材料根的令牌，但能否继续使用取决于所选版本化身份合同，不能统一按“同账号续期”放行。重新导入同ID必须expected_record_revision匹配且同一合同下的身份依据相同；不同kind、mode、route域或固定凭据要求新ID及明确的新Worker，不把旧conversation搬到新材料。显式import request ID去重，响应不确定时先查已提交结果，不重复制造副本。失败不覆盖registry/旧版本；未完成私有材料不自动发现为可用项，不删除原生或历史。

私有身份分为不可互换的三类：`native-principal`只用于确有已证稳定Native身份合同的来源；`api-credential`固定没有稳定账号ID的API凭据；新增`oauth-credential`用于本轮AGY的OAuth凭据固定。不能把OAuth塞进API类别或把其摘要冒充Native principal；provider、邮箱、未验证JWT声明、显示标签、路径均不批准换凭据。API key变化且不能证明原身份时仍拒绝原ID替换。不新增userinfo、whoami或额度接口，不发明原生身份命令。

用户已确认AGY首版采用下列OAuth合同，而非承诺透明续期：

| 原生来源模式 | 固定依据 | 合同内可接受的变化 | 必须拒绝的变化 |
| --- | --- | --- | --- |
| 已证合法refresh-backed格式 | 精确refresh-token R0 | R0不变且其余独立Native检查通过时，允许已证正常access-token/expiry更新 | R0变为R1、丢失、为空或无效，或转为access-only；即使access未变或邮箱相同也拒绝 |
| 来源本来就是已证access-only格式 | 独立域中的精确access-token A0 | 仅已证原生合同允许且不改变mode/pin的更新 | A0改变、失效或引入refresh-backed模式；不能降级/升级后沿用原ID |

模式由已授权的严格源样本确定；不能删refresh、改expiry、造token字段或强迫刷新来制造另一种原生格式。仅当前显示reader能读文件不等于完整原生serde/读取/刷新/写回合同已证。所选secret按精确值处理，不trim/casefold或解JWT后替换；私有版本化编码明确包括kind、策略版本、CLI、已证consumer认证模式、固定Native路由域及refresh/access模式，使用store私有HMAC。root、label、profile ID、expiry或邮箱不代替pin。相同字符串作为API/refresh/access凭据也不成为同一身份。

store已实现第三种OAuth kind及可冷恢复的私有policy，旧manifest仍只按原opaque摘要合同读取。纯legacy树保持schema1；首次成功发布OAuth才原子升级registry为schema2，旧材料/manifest1/身份摘要和原import/manage回执不重写，内存显式legacy-v1不是从摘要推断native/API kind。新OAuth使用manifest2且与registry的kind/mode/策略版本/CLI/路由域一致；不能对可变文件试kind、缺字段补默认、单侧降级或将旧摘要猜成OAuth。prepare仍无policy，verify/resolve接收已验证且冻结的policy，原始pin在Native验证前固定。未知或失配拒绝、不修复、不回默认；legacy default/lxy不迁移。该私有store切片53项新合成、关联7文件211PASS及ES2023 scoped/Host/Client noEmit已通过；其中cleanup优先级、移交buffer擦除及detached导致遗留lease均先红后修，详情见[store合同](../../../doc/native-auth-store.md)。这不是供应商原生导入/实际身份验证，2.1仍未完成，不能套用1.1历史勾选作为新功能验收。

R0相同仅证明该refresh字段相同，**不独立证明当前access-token的远端主体，也不证明A/R同属一个grant**；物理同窗快照、JSON/schema通过或Native models成功同样不能补出该证明。文件安全/物理一致性、完整原生格式与读取优先级/材料逻辑合同、固定凭据比较、fresh Native能力及必要保护是分别核验的层次。未知/矛盾字段、route、保护或原生合同未证的来源仍拒绝。无法识别混合A/R时如实保留能力边界，不伪造检测器、字段或远端账号一致保证。

原始pin来自source样本并在prepare确定，不能在Native verify后把“最新值”重新接纳为基线。先核投影至最终nativeRoot的mode/pin，再执行有界Native verify并确认其owned进程清理，随后重读目标mode/pin、格式和保护配置；最后await source guard.seal()，成功后verify才可返回给store发布。首次verify若R0轮换也可能零可用profile；未发布材料不复活，不把目标令牌写回旧值、回借来源或重放业务prompt。即使失败，Native验证也可能已刷新远端grant，不能承诺撤销副作用或恢复原授权。request重放只返回原提交回执，不代表当前pin/授权仍有效，也不能借旧request重新核验并接纳R1。

发布后的resolve、保存设定、出队、续聊、换模、fork与冷恢复均按固定合同重读自己的当前私有根；相同materialRevision/root不豁免检查。Native操作后的pin漂移使后续准入失效；若操作已经执行，保留该run的正文、产物、原生退出和cleanup独立证据，不倒填“零执行”、未知exit0、当前quota或任务必然失败。停止使用已有handle，不依赖换号或重新取得有效凭据。

不采用引用原来源或凭据symlink，因为它们不满足独立保存。默认原生来源仍是live reference，必须与imported snapshot在呈现及绑定上区分。

### 2. 白名单快照及原生差异

共同流程是：限定原生来源描述或明确绝对目录；FD no-follow/owner/nlink/size/路径前后identity检查；所有必需文件的前后快照一致；最小投影写入0700/0600新根；在目标根走现有原生身份/目录核验；最后原子发布manifest。错误只有固定code/摘要，不保留raw cause、配置或输出。鉴权文件不接受链接；非秘密共享settings仅允许已有确证例外，复制结果必须regular file。

- **AGY**：以已证文件来源和必要consumer认证/固定原生路由为首批，使用上述新增OAuth凭据固定合同，不把现有邮箱/未验证JWT或legacy binding提升为稳定远端principal。完整独立child HOME，Native自行新建的sessions/cache/locks自然落到该HOME；不复制来源历史。lxy共享settings例外不推广给凭据或任意链接。未知API/custom route及无法确认的keychain来源拒绝，不借原HOME验证目标成功。Native serde、token读取/刷新/写回优先级、完整settings及保护投影仍须固定版本静态证据和独立合成验证，当前reader字段不是完整白名单。
- **MiniMax**：标准prod、明确cn/en、已核schema的state/token/generation/scopes/expiry一致，credential的可选loginEpoch跨读一致；state没有loginEpoch字段。必需材料是同一`auth/prod/{region}/mcode-public`下的auth-state与auth envelope。新root的record索引是原生`com.minimax.mcode.oauth.prod.{region}\0base64url(sha256(join(root,'auth')+'\0mcode-public'))`；只重键所选record，token/state内容不造新值，其他record/锁/刷新中状态不复制。身份cache不冒充新根远程认证；目标用现ensure流程核对。
- **Codex**：首批仅已证file auth与默认原生路由。复制白名单auth字段，最小native config明确file store，必要安全策略等价保留，sessions/SQLite/锁不得指回原根。原生keyring/auto、未知provider/祖先项目路由继续拒绝，不能导入一份陈旧auth文件便放开。需新增scoped codexHome并贯通source/catalog/app-server/model/fork/terminal。

MiniMax的厂商材料证明与通用文件观察分开：`withNativeAuthSnapshot`仅在受管Linux/x64 helper及FS/ABI全部核验时支持，其余情况明确不支持；`observeNativeAuthFiles`的verified:false不是发布授权。首个厂商合同仅覆盖已核0.6.12标准prod/file namespace的原生协同写者：auth/state写入均wx临时文件、fsync后rename，持有所有旧FD至目标核验/最终源复核结束，原生同字节写回仍换inode，不能用粗粒度时间戳或watch队列代替它。先核state/auth/state/auth完整选中材料及namespace/client/audience/generation/scopes/expiry；loginEpoch只在credential中，要求credential跨读一致，不虚构state字段。原生login取消rollback或失败refresh说明generation不是无条件全局单调，不能把principal相同或单一计数当快照证明。已核原生只有nativeNamespace/credentialKey等本地材料寻址，没有名为sourceBinding的原生字段；插件自己的fingerprint/epoch不是原生提交ID或远程grant。

该限定不承诺检测无界手工原地修改/旧inode恢复的所有事件，也不使不一致材料可发布；未知写者、schema、keyring/迁移、过渡状态和未证配置保护继续拒绝。已进一步静态发现0.6.12 config.yaml有O_WRONLY/truncate原地写路径，故auth/state限定证明不能覆盖必要配置。

通用严格1.2改由可选、受管的Linux native companion验证：自有可审查C源在构建时生成对应平台产物，不增加Python/第三方运行库，不在用户运行时编译或执行来源代码。Node只传已no-follow打开并核验的文件/祖先FD及有界watch规格，helper不接任意路径、不读写鉴权字节；独立重开文件description后取F_RDLCK，避免继承共享description导致异常退出还遗留lease。raw inotify非阻塞同步read至EAGAIN、明确拒overflow/ignored/unknown事件，配合FD/path/owner/nlink核对；原地写请求的SIGIO及lease丢失即时失败并释放，不写source lock/config，不自动重试。观察不依赖Node事件队列或sleep。必须单独验证已有write FD/mmap、原子替换/粗时钟ABA、父死/EOF/取消/超时与不遗留阻塞。最初Linux synthetic probe仅证明F_RDLCK、冲突通知/释放与原始modify事件，不能单独证明完整快照；后续受管实现与109项合成反例已完成且经父独立复验，供应商adapter与完整包仍分别验收；未核文件系统/网络或FUSE/缺helper/平台都UNSUPPORTED。helper与IPC的路径权限/退出范围及包内ABI、来源SHA和构建输入均纳入关联验证。非模型OS沙箱，也不改变原生CLI保护；读租约可能短暂协调冲突写者，导入应立即中止释放而非延长阻塞，不承诺控制外部刷新。SEALED所确认的是源采样/源最后复核的线性化点，不宣称与另一root的registry rename组成跨目录事务；该点之后的源变化仍属独立副本/服务端grant风险，不能借ACK伪造排他期。helper须在目标验证期间持续监控，异常退出/未知回执/取消均零发布且等真实退出；F_GETLEASE在break发起时即会报目标类型，不能只等异步signal。只有完整实现及反例通过后才替换现严格拒绝并勾1.2。config/region/安全配置不自动继承auth generation证明，必须分别核writer/路径和完整必要保护，不能删除未知deny或可执行依赖换默认。目标root仅重键选中record并用现有有界身份核验，目标同principal只证明身份，不能代替源多文件一致性。目标核验后再次检查持有FD/路径和同一材料；失败零registry发布、不修复/上锁/写来源。任务1.2的受管Linux后端实现、显式seal-before-publish编排和合成证据见[独立实施记录](implementation-1.2-linux.md)与[API/支持矩阵](../../../doc/native-auth-snapshot.md)；缺helper/未知FS/平台仍拒绝。厂商2.2仅在其全部合同实现和合成证据成立后单独勾选，不以文件guard或watcher变绿冒充原生导入已通。

必要配置包括原生保护。不能证明安全等价时拒绝该来源模式，而不是删掉deny/team设置换成宽松默认；MCP/hooks等可执行配置不随鉴权导入。未知顶层/嵌套设置、规则顺序、false/default语义、HOME相对路径、include/env/`~`或外部执行依赖必须有已证投影合同，不能静默丢弃。目标初始化/验证后重读保护配置，身份或pin通过不替代保护等价。

#### 2.1a. 受限元数据依赖（通用守卫已实现合成切片，adapter尚未实现）

上一轮合成能力探针确认：现严格API只接受已存在regular文件；未选择settings的auth-only样本不会证明settings缺失，选择缺失或symlink文件则拒绝。既有严格后端及109项历史证据不覆盖以下扩展。

可信adapter可声明有界的expected-absent或settings-only symlink元数据依赖，与regular内容文件共同检查路径重复/前缀冲突/数量/长度；进入异步前复制输入选择，调用方不得中途弱化期望。absent仅指已no-follow打开并核验的现存安全parent FD下leaf ENOENT，不把EACCES、ENOTDIR、缺祖先或悬空链接当缺失。只允许已证lxy settings别名到已选中的canonical regular settings；目标必须在同一严格guard中持FD/0600/nlink1/owner/read lease，别名自身owner/nlink/type、原始readlink文本及全部祖先/相关子名也被守护。只接受准确的已证绝对目标或唯一规范相对拼写，初次和后续均按readlink原始bytes比较，不经有损UTF8解码；不泛化多跳、任意`..`解析或credential链接。symlink的0777不放宽regular的0600要求；输出仍是新regular settings。

lxy选择集合只含其自身token、canonical settings及settings别名元数据；可用共同授权祖先锚定，但绝不因此读取默认token或扫描HOME。READY/读窗/CHECK/SEAL前后核元数据，并在同一raw inotify相关名集合中sticky拒绝创建删除、链接/祖先移走再移回同inode、同目标替换等ABA；最终lstat/readlink相同不足以通过。未知/overflow/guard退出仍失败关闭；现有C的有界FD/watch过滤协议可复用，不为此改C/ABI。Node输入、检查与定向反例已实现通用基础：33项metadata合成，连同旧基础6文件158PASS及scoped/Host/Client types通过，8个明确列出的切片输入前后hash一致；不是全仓冻结或完整导入验收。独审所指UTF8字节混同先1真红后改为buffer精确比较，合法Unicode正例保留；C/ABI/store未改。具体lxy别名授权、Native投影及目标验证仍须adapter实现，metadata+vendor进程清理也不是这些测试证明。诊断observation有非空metadata明确UNSUPPORTED，不静默忽略。API、证据与未覆盖边界见[守卫说明](../../../doc/native-auth-snapshot.md)及[实际记录](../../../doc/tasks.md)。

guard期间的目标Native工作须受剩余期限与guard.signal约束，并由adapter拥有、结束且join其真实进程范围；helper退出不代表Native已清理。实际AUTH_CLEANUP_UNCONFIRMED不能被store取消/通用callback包装抹掉，可信adapter外层须保留其优先级。源seal仍只是源采样线性化点，不承诺之后源永久不变或与registry rename组成跨目录事务。

### 3. 单一解析上下文，不改父环境

内部resolver返回一次冻结的CLI/profile/revision/nativeRoot/identity及child-only env配置；只从registry或已核legacy来源生成，不接受Agent直接设置执行HOME。统一替代零散AGY-only准备分支，legacy helper委托新resolver。账号、目录、两侧绑定核验、排队与执行全部用同一对象。

读取器须使用与子进程一致的有效环境，不能继续读父CODEX_HOME或父通用key造成查甲跑乙；需要抑制的ambient变量只在child context处理，不能修改process.env或把Host key填入profile。现有未知覆盖/路由保护不得为“切换可用”而删除。

完整设定/cache按profile和revision隔离；当前parent及项目默认只指向各自明确完整设定，不从registry随便挑账号。选择版本过期或停用时给错误；显式指定新profile但未给model且没有同域完整设定，仍返回MODEL_REQUIRED。其他parent和旧Worker不受未来设定影响。

### 4. 工具与UI的同一服务边界

拟增只读`cliworker_auth_profiles`列caps/已核来源描述/安全profiles；`cliworker_import_auth`接收CLI、source_id或source_home、label、request ID及可选同身份替换CAS；`cliworker_manage_auth`仅做带版本检查的label/enabled管理，不销毁历史。导入/管理必须先过main/writable/not-plan门禁，公共Gateway复用同一服务。

models/start/configure_conversation增加auth_profile；Worker selector/followup/configureWorker/fork从固定版本读取，没有换号参数。agy_account只保留legacy用法，与auth_profile双选拒绝。不存在的wrapper映射不解析为可执行程序，Canonical CLI executable仍单独验证。

UI遵循[规范](../../../doc/settings-ui-design.md)，不新增自绘层级。来源切换清空旧目录证明/草稿，忽略旧异步回执；保存的是完整有效组合。导入源目录是宿主路径输入，不上传秘密文件内容；公共回执不显示托管私有根。已有会话显示只读来源信息，换号引导明确新建Worker，不自动克隆。

### 5. OAuth及并发生命周期

每个profile本地独立不代表新grant。导入回执、UI和说明给固定的凭据固定/轮换风险提示。按已证身份合同建立插件内刷新组：native-principal使用其已证稳定身份；OAuth使用相同CLI、版本化consumer/固定route域、mode与精确R0（refresh-backed）或A0（原生access-only），API保持自身合同，三类不混用。相同R0即使A不同、profile/root不同也须同组；不按label/root拆锁，也不按邮箱猜合并。覆盖导入目标验证、只读metadata及任务等可能Native refresh的操作，先定一致锁序，拿锁后重检pin，持锁至owned进程真实cleanup完成；store写lease不是此刷新组锁。

不同pin仍可能同账号或同refresh family，不能声称全部同账号/grant已串行；原生原目录或外部CLI的刷新也不受插件控制。Native只写目标私有根不代表轮换后的pin获准继续使用；失配不重新pin、不跨profile同步、不回写来源或恢复旧token。本模式不承诺消除token-family轮换、远端副作用或额外额度。

忙碌版本不可破坏性管理，只返回安全busy原因，不泄露foreign Worker。停止依赖已拥有的process handle/transport，不依赖重新取得可用鉴权。dispose撤销临时通道/订阅并确认进程，不删除private roots；重启只从合法manifest恢复，停用不自动启用。

## Risks / Trade-offs

- [副本刷新可能影响原服务端grant] → 明确警告、可证同principal或同pin域的插件内串行、不自动借号；不同pin及外部刷新不在此保证内，真正独立grant需各自原生授权，不代用户登录。
- [固定R0被误称远端账号证明] → 明示不证明当前A主体/A与R配对；独立核原生合同及能力，不能用目录成功补证。未证能力不宣称支持。
- [合法轮换也使导入或续聊失败] → 首次verify和发布后都核原始mode/pin，不接纳R1、不恢复旧token；新pin须明确新profile及新Worker，旧历史/产物和停止能力保留。
- [隔离根仍借原config/SQLite/keyring] → source与child env纵向测试，目标无外链、无历史与外置可写路径；未经证实模式拒绝。
- [文件ABI/region/recordkey变化] → 固定schema矩阵及MiniMax重键正反测试，真实Native metadata/执行另验，未知不兼容不重登。
- [私有失败载荷泄漏或半导入复活] → hostile marker/ABA/崩溃恢复测试，原子manifest与固定错误，未发布目录不作为来源。
- [自动复用跨账户] → ID/revision/所选身份合同三层绑定及queue/恢复/fork测试；显示标签不是authority。
- [平台状态被过度宣称] → POSIX file模式先证，Windows ACL/Native keychain未核则明确不支持本模式，保留原默认账号。

## Migration Plan

加法schema读取旧记录为原native来源，legacy AGY两路不自动复制。先安全store/import及context的合成红绿，再工具/UI/完整setup与跨源隔离，随后全新隔离包。空闲备份热装时纳入registry及旧版本的保留核对；新功能可停止新准入回退代码，但不擦除profile/Native历史或恢复旧token到来源。真实导入必须核源文件未变、目标root/private权限、所选身份合同及Native模型/实际任务回执，不将OAuth凭据连续性冒充远端账号证明；最后按实际支持矩阵更新文档，代码/合成/实机三个阶段分别记录。2026-10-26先按用户确认更新规划，再实施上述受限metadata通用基础切片；随后Round15的新增OAuth kind及版本化私有格式已完成store合成切片（53项及关联211项），AGY adapter与其Native验证仍未完成；按最新人工收口指令暂停扩展供应商导入，2.1保持未勾选，不改变1.1/1.2历史完成范围或legacy default/lxy行为。
