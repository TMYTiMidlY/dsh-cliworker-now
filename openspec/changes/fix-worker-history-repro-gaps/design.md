# Design

## Context

动机与边界见[proposal](proposal.md)。现[AGY runner](../../../src/host/native-agy.mjs#L45-L124)已有严格续聊汇总冲突分支；known类型只有user_input/agent_response/tool/checkpoint，system_message会使覆盖标记失效。[Worker目录](../../../src/host/index.ts#L2108-L2119)只有pending与legacy缺绑定两路，[续聊](../../../src/host/index.ts#L1005-L1011)也把多数未绑定失败归入legacy。[模型控制测试](../../../tests/worker-model-control.test.ts#L97-L105)已覆盖pending，尚不能据此声称failed-before-binding覆盖。

规划初始阶段只完成只读历史发现及当时runner的内存回放，尚未修改生产源码或真实复测；后续实施/已安装与实机证据分别见tasks及doc/tasks，不能把本段初始基线当当前状态。个人历史详细索引存忽略的repo-local证据，不复制论文、原始对话、凭据或完整wire进入Git。新方案与鉴权1.2独立；该基础的父独验109项通过，不等于本方案已实现。

## Goals / Non-Goals

**Goals:** 把已核原生类型与生命周期证据接入现有保守分类；从真实历史提取最小无隐私夹具，只对当前红例修复，保证零账号借用/零隐式重发。

**Non-Goals:** 不修订论文、不重新执行原业务任务、不修改或解归档其他父会话、改历史终态或账号；不发明quota余额、不接Hub/额度API、不把每个vendor错误当插件缺陷；不扩CLI原生权限，不借本轮更改绕过身份或清理门禁。

## Decisions

### 1. 覆盖与保真度分别记账

asmgr0.6递归所有保留DSH最高代日志，不按GUI归档集合过滤。初查758份与workspace归档86个ID逐项核对无缺失，但关键词+14家族不是所有失败台账。按采样截止固定发现清单，逐ZSTD frame读原始tool/call/result与job/registered/settled，再交叉全部插件events/per-run raw；包含本父及没有Worker回执的失败，orphan另列。不把Node一次只解首frame误当全日志。真实tool name、callId及Worker/run去噪，fork复制保留多个origin而不重复事故。每例有处理状态及缺证，不把正常门禁隐藏、vendor错误全叫bug或仅看latest。详细show有未解释job/目录/image事件警告，原始扫描补齐job层而其余缺口仍保留；不能把发现头部lossy:false冒称投影无损。

案例状态至少包括：历史已核、当前结构回放、合成红/绿、真实新任务验收、已修无需改、未复现及缺证。完整正文、产物检查、Native终态、进程退出、cleanup和当前额度是不同证据列。

### 2. 信息步骤只补覆盖，不授予成功

已核本机AGY ELF内原生enum/实际DeriveStepType映射及proto结构：system_message是独立消息/上下文类型；error_message是错误载体，DONE表示该记录处理完成，并不证明无错。公开[headless文档](https://antigravity.google/docs/cli/headless.md)没有逐一列这两个type；不夸为公开文档逐type保证。本机版本hash及偏移仅记私有证据，不能倒推历史当时程序hash。

方案仅把system_message纳入已识别、无执行效果的步骤；仍完整检查conversation/index/type一致性/state/error/is_error，未完成或错误均阻断冲突分支。error_message和其他未知类型继续不能凑齐all-DONE；不按消息文字“已完成”判成功。保留原有真正exit0、resume同ID、本轮DONE回复、无取消/清理错误条件。没有历史exit码就保持未知。

父已用两份真实末轮native records经过当前生产runner与内存peer回放：在显式模拟exit0时仍得到ERROR及未知类型诊断；模拟exit3时正确非零失败。只有peer退出条件为模拟，未调用CLI、不执行工具或文件写。该结果证明当前覆盖分支形态，**不证明历史实际exit0，也不证明native stream错误根因**。实现阶段补脱敏结构夹具和控制反例后再决定修复。

### 3. 准入失败分层，不推断身份

先让现有Service/Runtime夹具真实产生准备失败、未落accountBinding的Worker，再调用models/configure/followup；不通过手工塞假binding让测试绿。实现复用同run的runConfiguration与任务spawnAttempted/native会话身份，不新增账号状态或从createdAt/标签猜新旧。已活动的Native会话缺绑定用中性活动态说明，不能因tasks存在一律称首次排队。现代无Native身份文案为“本次准入未完成或证据不可用”，不据此宣称从未启动；其余缺证保持中性，不倒灌为完成准入。Tool与Remote共用分类，身份门禁和停止所有权不变。

### 4. 目录及额度候选先验证证据边界

Codex两次目录差异用同source、native列表和account/scope可控序列验证：同一有效source连续四次fresh查询均返回精确7项，未复现“第二次必空”；scope合法变化按本次精确模型/能力发布，unknown仍拒绝准入，不能伪装成已知无额度。历史两次调用只证明曾显示7项、五分钟后不可用，未保留当时source/scope/cwd/native版本，具体根因仍未知。

当前可复现的是诊断折叠与source竞态：unknown、未分类denied、supported空和能力交集空原都返回[]；Native前后OAuth→API等真实来源变化也先混合两份metadata。现以private sourceIdentity绑定原生root、provider、已确认默认route及稳定principal，不含access/refresh/expiry/mtime，不改变已保存binding格式或公开目录。同principal正常token轮换使用刷新后凭据；真正来源变化在scope探测前拒绝。固定CodexCatalogError仅保留封闭reason/文案，不带HTTP/native cause或私有身份；已确认quota/auth仍独立，不扩大额度探测范围。

外层authorizedCatalog原只在成功后复核binding，因此catalog先抛错会遮住真实来源变化。现在仅对已证CodexCatalogError且Native已确认清理（或尚未spawn）重读binding；证实A→B优先ACCOUNT_CHANGED，来源不变则保留原reason。真实caller取消先检查，cleanup未确认、未知错误/Proxy及其他CLI不增加查询；重读binding本身失败则保留该真实绑定错误，不伪称ACCOUNT_CHANGED或沿用旧quota归因，不读第三次。不自动retry、fallback缓存或借号。正式models→start的三处fresh准入分别变unknown时均须零Worker/零job/零业务prompt，不能只用目录函数测试冒执行闭环。

额度误报按同CLI/来源/模型/run对应原始request/step/result及父侧总结；已经生成文字后真实后续请求仍可能额度失败。若原生累计ERROR与当前全部可核步骤冲突，只按同一uncertain规则处理，不断言当前余额或历史错误已证。当前反例另暴露非零exit通用文案会吞掉原生quota声明；因此错误/冲突路径增加来自process-supervisor的安全退出码/信号诊断，并同时保留退出与CLI汇总错误，明确quota只是CLI汇总、并非当前模型余额查询。这不倒填历史，也不把exit0当cleanup已确认。Host active-child和插件budget单列，不能等同供应商quota。真实额度拒绝、EOF与权限门禁作为不回退/不重试的负向控制，不为“通过率”抹除。

### 5. 公开错误与Native待核实展示

原MiniMax对象错误的原始turn/end只证明user-kind取消，具体历史serializer未留存；当前外围throwIfAborted/等待锁可把plain object交给宿主，不属于Native身份失败的已证根因。保持底层signal.reason身份，在工具/Remote最终边界投影：真实signal取消使用固定错误；未知非Error/getter对象不字符串化，普通Error仅取自身data message并复制到安全Error，不调用自定义toString/cause。已证MetadataCaptureError、ProcessCleanupUnconfirmedError与STEER_UNKNOWN投递未确认语义保持；后者和清理不被caller取消盖过。不把取消说明成零派遣或可重试。

Round12另经独审指出并真实复现MiniMax identity内部取消路径：它故意新建不含私有reason的DOMException，因此与原signal.reason不同；公开边界若只认同一reason会降成opaque一般失败。保持原下层对象/控制身份，用该module-private WeakSet记录真正取消factory产物，公开边界仅认此witness，不凭AbortError/name/message或cause猜取消。普通同文案DOMException/Proxy不命中，cleanup仍优先；private controller的3秒deadline在原request catch中仍转MiniMaxIdentityError unavailable，不因新mark变成caller取消。正式start实际assert/request两红后修，追加假品牌、Proxy及内部deadline反例，不倒填原历史取消owner。

Native侧栏首批已实机显示待核实banner和新正文，但SDK内层turn仍红Failed且插件给通用CLI_RUN_FAILED。仅为uncertain增加CLI_RESULT_UNCERTAIN和SDK兼容说明，保持error finish，不能用stop/abort或CSS假装成功，也不改Core枚举。真实failed/timeout/user stop不变；旧Native turn不追改。UI完整语义验收仍须新流和实际截图，源码或banner存在不算全过。

### 6. 复测与落地单写者

先无模型结构回放/Service合成，已有修复只执行最小对应回归、不重复施工。后续AGY canary通过正式CLI Worker入口，在本父新Worker/隔离产物中验证完整回复、原生模型/退出/工具事件和cleanup；不续写原档会话，不复用其native ID或论文命令。测试不自动造成commit、部署或变更并发策略。

## Risks / Trade-offs

- [只靠有输出就把失败洗成成功] → 原始错误、unknown exit及partial始终保留，完整产物另列核验。
- [system消息可携错误内容] → 识别类型不豁免状态/结构错误；不把其本身算tool完成。
- [准入新旧误判使绑定被收养] → 仅分类诊断，未知采用中性描述，实际准入始终要求原binding。
- [用户说有额度但native说quota] → 记录矛盾与确切scope，最小新调用只证明其时点可执行，不推全局余额。
- [个人历史进入分发包] → 原始记录保持只读；证据在忽略目录，仓库仅合成结构/聚合说明。
- [缺少历史exit或底层job事件] → 不补造，不追改旧结果，不把当前 canary 代替历史事实。

## Migration Plan

加法或诊断级调整，不自动迁移旧Worker身份/状态。先完成红绿与关联类型检查，再从冻结输入构建隔离包；核helper执行位、既有Native适配器与Client无关部分保留。若需热部署，沿用空闲备份、官方更新、PID/历史不变及现GUI刷新验收；回退代码不擦除任何历史或账户。最终按实际结果更新案例矩阵，不以格式校验归档未完成项。
