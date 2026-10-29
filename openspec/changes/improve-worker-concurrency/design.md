# Design

## Context

既有runtime全局queue/running及drain负责slot和project写屏障；queue在submit后microtask调度，worker直到harnessPreparation结束才status=running。默认2，上限schema8。WorkerStorage持有私有根的单Host锁；设置页使用NativeChoice及公共文字/分区class。AGY控制和MiniMax Stage1已是本次开始前dirty，不回滚、不扩原生能力。

## Goals / Non-Goals

Goals：可信持久limit、无重载在线调参、parent公平、真实原因与权限/隐私边界；关联回归和独立Remote/postgen候选。
Non-Goals：运行真实CLI/模型/安装/重启、DSH核心修改、账户/模型/权限变化、抢占、调vendor限额、修改结果HMAC合同或其他CLI新cap。

## Decisions

1. Storage在独立私有JSON保存policy+limit。读取/写前核根与文件type/owner/mode/nlink/size及no-follow、前后inode/stamp；坏/不可信文件或权限错误failclosed，不自动修复。缺文件才用初始config/default8，1..12统一验证。Runtime保有有效limit和安全错误态；setter同步保存成功后才发布新limit/changed/drain，串行JS无await中途竞争。持久值优先初始配置，不写profile。保持已在途运行，即使降低后active>limit。
2. Round-robin按每parent第一个queue候选选择，last-served-parent在真正占位时更新。parent内FIFO；候选仍需与当前running、全局原queue更早同project任意写冲突都无交集。被冲突阻塞的parent可跳过，其他项目继续；不允许同parent后项超越首项，不改priority/followup准备代际。比按worker全局FIFO减少大parent霸占，且不引入抢占/复杂权重。
3. 安全aggregate只返回limit/source/globalActive/globalQueued/parentActive/parentQueued/maxLimit。active为真实runtime.running占位，包含授权/child准备和清理，不称native已执行。另投影每ownedWorker的有限阶段：capacity、project-write-conflict、parent-turn、queued、remote-recovery、admission、authorization、executable、harness-preparation、launch-preparation、running、cleanup；不持久为猜测历史，不泄露冲突任务身份。status/snapshot和必要label共用此投影。
4. cliworker_concurrency可选limit：缺省只读，有值明确全局改动。主Agent写服从assertExecution和取消，工具/两个Remote复用真实Agent核心；native工具桥按cliworker命名拒绝，补防递归反例。UI独立“并发与排队”设置页，复用现NativeChoice、分区/label/description/反馈，读最新统计不猜默认，明确会影响所有会话。保存失败保留错误和选择，不卸载runtime。
5. 新Worker缺binding先查真实inflight/queue证据，只返回PENDING_ADMISSION短错误与cli-only目录建议，不能替代binding。旧历史仍原拒绝。未准入body/model数据不进入别人的aggregate。
6. DSH maxActiveSubagents默认8且volatile，属于Host root activation pool门禁；连续managed descendants共享pool，插件预算仍跨parent全局。插件只观察SDK正式错误/生命周期，不读private pool、不用idle推测计数、不写Host config。父会话已通过正规settings API明确将本机Host政策升12，属独立线上事实，不作为本实现的前提或自动动作。
7. 新helper仅识别本地SubagentError ACTIVATION_LIMIT_REACHED，cold prompt仅识别RemoteError delivery-unavailable内已保留的该typed cause；未知delivery、draining、depth、unauthorized和清理不确认不重试。bridge provider.prepare在SDK reserve前已可能bind/replace，故create/projectRun完成原回滚且核无实际child后才抛内部Deferred。fresh未发布candidate childId仅存于同Task内重用；同authority的中间cold Deferred没带新candidate时保留旧候选，不跨authority继承，previous恢复不加retired链：普通store.replace保护不放宽，独立internal restoreUnpublished只接受本进程replace时捕获的完整current+previous快照租约，candidate被任何写触碰（含同值/ABA）即失效，冷加载不恢复租约；需bridge先证无child并drain确认，写失败不发布回滚或重试。Runtime仅在尚无native spawn/lease时把Deferred回原序队列，不换Task/run/controller/prompt、不写终态；保留parent FIFO/更早写屏障并释放global slot，其他独立root仍可运行。
8. Runtime在第一次真正harness准入后才arm本轮执行timeout；准入/元数据原有独立有界检查保持。事件订阅先于任何准备，subagent/end在SDK释放slot后发出，settings/document-updated与loader/volatile-update可唤醒。只把事件视作重试提示，不作为已准入证据；事件合并，已取消/更换parent/代际失效/关闭任务不能复活。SDK无完整capacity-ready且unpublished rollback不发end，使用单个Runtime owned one-shot watchdog，失败间隔2/4/8/16/30秒封顶，事件提示也有最小2秒失败冷却，避免foreign事件风暴或无限快速prepare；无等待队列/关闭时清timer，非setInterval。它不保证立即知道Host空槽、不假报计数，状态独立host-child-capacity并保留等候原因。

## Risks / Trade-offs

- 更高默认可能触发供应商/机器资源限制 → 上限12、默认仍8，明确本机12是用户选择而非vendor保证，可在线降；不换账号或重试。
- 更严格parent FIFO可能等待同parent首项的项目写锁 → 明确parent-turn原因，优先正确串行不暗中越过。
- 持久坏记录会阻止新任务 → failclosed，错误可读；不在用户无意中自动重置。
- 测试曾默认2 → 只有原意2槽的夹具显式设2，不放松断言；新测试实际保持8个受控只读模拟slot。

## Migration Plan

无历史迁移，缺持久选择使用新默认或明确初始配置；旧0600记录和模型/会话保持。源码与唯一preview合成完成后交父会话安装，在线仍旧候选不可宣称8槽已live。回退源码/包时保留新独立设置和历史，不删除个人数据；本任务不归档或提交。
