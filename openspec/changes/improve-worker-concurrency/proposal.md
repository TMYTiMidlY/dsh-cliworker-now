# Proposal

## Why

当前运行时所有CLI和父会话共用默认2槽，排队Worker在进入准备阶段前不建child，容易被误认为AGY限流或卡死；固定config调参还需重载宿主。用户已要求提高可用并发、正式在线调参、跨父会话公平性和安全排队解释。

## What Changes

- 默认并发8，整数范围1–12；用户明确本机先设12，须经正式入口持久并读回，不能只改文案或把默认也升成12。Host私有持久选择优先于plugin初始config/default，保存成功后在线改变调度，不卸载或重启。
- 新正式cliworker_concurrency只读aggregate/明确limit写入工具及同服务Remote设置页；写操作服从主会话权限，不披露其他父会话信息。
- 每parent轮转、parent内FIFO，不抢占inflight；保留同Worker互斥、同project任意写冲突和原队列前方写屏障，以及priority/followup代际和所有原门禁。
- 返回真实capacity/project-write-conflict/parent-turn/准备阶段等有限状态；queued新任务缺尚未落盘binding显示pending-admission，不冒称历史缺绑定或未登录。
- 增加关联反例及双语文档；不改变账号、模型/角色/权限、原生保护、结果HMAC合同或其他CLI能力。
- 补充独立DSH Host active-child门禁：插件global12不代表某Host root pool可派12。只对SDK已证typed capacity、临时binding已成功回滚且尚无真实child/native的准入延期；同Task/Worker/run保留队列并释放插件槽，等公开事件或有界低频补偿再试。等待不消耗执行timeout，不写failedJob、不重新创建Worker/run、不自动抬Hostpolicy。

## Capabilities

### New Capabilities
- `worker-scheduling`: 全局在线并发预算、可信持久化、父会话公平排队及不泄密的调度解释。

### Modified Capabilities
无；worker-dispatch已有选型/权限合同保持，本次提取其尚未覆盖的运行调度域。

## Impact

证据入口为src/host/process.ts默认2、index.ts的max8 schema、runtime.ts drain的全局running和project写屏障，以及workerCatalog缺binding历史提示。修改Host Runtime/私有存储/工具/Remote，共享snapshot和设置页/任务标签；无新增依赖，不修改DSH核心、用户profile或凭据。保留先前AGY控制与MiniMax Stage1 dirty；只做合成、关联类型检查和唯一preview，包名/0.8.2不变，真实8槽上线由父会话后续处理。
