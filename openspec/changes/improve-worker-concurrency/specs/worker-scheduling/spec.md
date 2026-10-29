# Spec Delta

## Purpose

为多CLI、多父会话提供可核查的全局运行预算与公平队列；允许经授权在线调整并持久恢复，不中断已有任务，不泄露其他会话内容，并保持既有会话互斥、目录写串行、身份和原生保护边界。

## ADDED Requirements

### Requirement: 有界且可信的全局并发选择
系统 SHALL 默认8槽并接受1–12整数，已持久的明确选择优先于插件初始配置。持久设置 MUST 为Host私有可信文件；损坏、链接、权限或读取错误不得静默重置为默认放行。

#### Scenario: 初始配置与重启
- **WHEN** 没有持久选择或已有明确选择后重新启动Host
- **THEN** 分别使用有效初始配置/默认8，或恢复明确选择且不改账号/模型/历史

#### Scenario: 不可信设置
- **WHEN** 保存记录损坏、超限、软硬链接或不具备要求的私有权限
- **THEN** 阻止新增准入和调参覆盖，返回安全错误，不借默认值绕过

### Requirement: 不抢占的在线调参
系统 MUST 先验证并成功持久化再原子更新预算、通知观察者及释放eligible队列。提高后立即调度；降低时允许active暂时高于预算，不能停止、取消或重排inflight，只阻止新运行直到满足预算。

#### Scenario: 提高与降低
- **WHEN** 2提高到8或已有8个真实占位时降低到2
- **THEN** 前者立即释放可运行队列，后者保留原8任务并等待占位减少，不重启CLI/宿主

#### Scenario: 默认8且本机明确选择12
- **WHEN** 用户通过正式工具或设置页明确选择本机12槽
- **THEN** 在线保存并读回12，重启后恢复12；默认值仍8，提高和降低均不重建已有任务，13仍拒绝

#### Scenario: 无效或失败写入
- **WHEN** limit不是1–12整数、请求取消或持久化失败
- **THEN** 预算、排队顺序、inflight及通知均无提交副作用

### Requirement: 正式入口与最小公开数据
系统 SHALL 提供只读aggregate和明确修改limit的正式工具及同服务设置页；写入 MUST 拒绝子Agent、Host plan/read-only。公开内容仅含globalActive/globalQueued/limit与本parent统计和有界原因，不包含其他parent身份、标题、任务或正文；工具 MUST 解释这是插件全局而非厂商配额，不递归转发给native工具桥。

#### Scenario: 权限与隐私
- **WHEN** 本父会话读取统计或无写权限的调用者请求修改
- **THEN** 读取不泄漏foreign数据，拒绝写入不触及持久记录或调度

### Requirement: 父会话公平且保持目录屏障
系统 SHALL 在可运行parent之间轮转并保持每parent入队FIFO；单个parent批量排队不能持续阻挡后来parent。所有候选 MUST 同时服从同Worker互斥、同project任意accept-edits冲突、原队列前方写屏障、priority/followup generation、取消/禁用/清理隔离与原生限制，不抢占已占位任务。

#### Scenario: 两父会话与大量排队
- **WHEN** A有大量任务而B后来提交可运行任务，运行槽陆续释放
- **THEN** 按parent轮转分配后续可运行槽，A/B各自入队顺序保持，不因A批量队列饿死B

#### Scenario: 写任务屏障
- **WHEN** running或前方排队同project存在写冲突，即便候选parent轮到运行
- **THEN** 候选仍等待；无冲突其他project可进，不通过提高预算绕过串行或既有门禁

### Requirement: 真实排队与准备状态
系统 SHALL 用有限、基于真实运行状态的原因解释capacity active/limit、project-write-conflict、parent-turn及准备阶段，不伪造进度或把job已启动等同CLI已执行。准备占位计入globalActive；队列等待不冒称模型限流。

#### Scenario: 无child的queued任务
- **WHEN** 全局占位已满，新Worker只有准入与queued事件
- **THEN** 显示真实capacity和占位，不显示已连接CLI或虚构child/模型进度

### Requirement: 尚未绑定的新任务目录提示
尚在排队/准备且未完成账号binding的新Worker查询目录 MUST 显示pending-admission/busy和等待或使用明确cli目录的建议，不误报历史缺账号、登录失败或建议新建；不得因缺binding放行身份查询，真正历史记录仍保留原缺绑定拒绝。

#### Scenario: 新任务与旧历史区分
- **WHEN** 新queued任务或没有inflight证据的旧历史均缺binding
- **THEN** 前者返回pending-admission而不查询或借其他来源，后者仍按旧历史门禁拒绝

### Requirement: 独立Host容量的延期准入
系统 MUST 将Host active-child政策与插件global预算及厂商配额分开。仅SDK已证typed ACTIVATION_LIMIT_REACHED且临时binding/previous回滚与清理确认、无真实child或native开始时 SHALL 同Task/Worker/run/prompt回队，释放global槽，保留parent公平和原项目写屏障；不得写failed/completed或新建Worker/run/retired链，不自动修改Hostpolicy或旧失败任务。

#### Scenario: 插件12而Host1或2
- **WHEN** 相同Host root pool的本插件或其他provider已占满Host1/2，而插件还有12槽
- **THEN** 候选保留queued并标host-child-capacity，不声称AGY限流或已审，其他独立root可利用插件空槽；释放Host槽后原Worker/run只真正提交一次prompt

#### Scenario: 暂态绑定和cold续聊
- **WHEN** provider.prepare已bind/replace后reserve拒绝，或cold prompt以delivery-unavailable保留typed capacity cause
- **THEN** 新候选binding撤销、previous原样恢复且不增长retired链；cold pending请求回滚后可同轮延期；缺typed cause或cleanup未确认、权限/depth/draining等仍拒绝自动重试

#### Scenario: replacement与cold混合拒绝的候选连续性
- **WHEN** 同authority的replacement候选C先遇容量拒绝，下一轮cold容量拒绝没有新candidate，再次replacement获准
- **THEN** 原Task/Worker/run仍使用C且仅一次native prompt；不因无candidate的中间错误丢失C，不把旧候选继承给不同authority

### Requirement: 有界等待与真实执行预算
系统 MUST 在harness真正准入后才启动执行timeout，保留元数据本身有界保护。等待 SHALL 预订阅公开end/正式配置更新并合并唤醒，校验取消/生命周期/原parent/代际；SDK未发布回滚无end时 SHALL 有低频one-shot补偿，失败重试间隔至少2秒且backoff封顶30秒，不忙轮询、不私读pool、不把事件当成功。所有监听与timer MUST 随所属scope/任务关闭释放，不公开猜测Host计数。

#### Scenario: 无end的回滚与事件竞态
- **WHEN** 占槽启动在发布前回滚，或释放事件恰在失败回队前到达
- **THEN** 事件epoch及有界低频watchdog防永久漏唤醒，保留安全等待诊断，不快速重复准备；等待超过本轮执行timeout仍未耗真正执行预算

#### Scenario: 等候取消和关闭
- **WHEN** 等候Task取消、父Agent替换、代际失效或插件关闭，之后仍到达旧end/配置事件
- **THEN** 不再准入或spawn，清除timer/任务引用及scope监听，原cancel/cleanup语义和Host政策保持
