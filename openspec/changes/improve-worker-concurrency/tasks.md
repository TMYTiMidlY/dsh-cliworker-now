# Tasks

## 1. 可信在线并发预算
- [x] 1.1 默认8、配置与setter仅接受1..12整数；私有设置优先初始config，坏/链接/超限/权限记录failclosed；测试缺省/明确配置/0600/重启与持久失败零更改，同步设计说明。
- [x] 1.2 Runtime在线setter先保存再更新/changed/drain；测试8真实模拟只读slot、2→8立即释放、8→2不杀旧8且延迟新任务，保留同Worker互斥及清理门禁。

## 2. 公平调度与真实解释
- [x] 2.1 实现parent轮转/parent内FIFO并保留原project冲突与前方写屏障；测试两parent批量、跨项目可运行、阻塞首项、priority/followup generation、取消/禁用/隔离/paused/fixed-v2原约束。
- [x] 2.2 投影有限的真实queue/preparation阶段及安全aggregate，snapshot/status/UI共用；测试capacity/写冲突/parent-turn/准备占位与无foreign身份正文，queued models提示PENDING_ADMISSION且不借绑定，旧历史拒绝仍在。

## 3. 正式工具、Remote与设置
- [x] 3.1 新cliworker_concurrency可选limit与同核心Remote入口，写须main/assertExecution/取消；测试只读无副作用、子Agent/plan/readonly/无效参数/持久失败拒绝，原生工具桥禁止递归。
- [x] 3.2 设置页用现NativeChoice和公共排版增加全局并发页，显示跨CLI/parent影响和真实占位；组件测试加载/保存/失败/禁写交互，窄栏复用既有响应式规则、不卸载runtime，更新settings-ui-design与README/usage两语。按父会话核验浏览器控制通道当前不可用，实际刷新/窄栏视觉保留待实证，不以组件检查代替。

## 4. 集成与交接
- [x] 4.1 运行并发与原有关联回归，意图2槽的旧夹具显式2，不放松断言；保留AGY控制/结果及MiniMax184回归，Host类型与strict通过，在doc/tasks记录命令/数量和失败修正。
- [x] 4.2 新建唯一统一candidate2 preview，生成Remote、Host/Client bundle及postgen类型检查；核对全部src与README副本、包名/0.8.2、无Git写入，全部jobs收齐并释放唯一写权，明确未安装/未实测8槽live。

## 5. 用户明确本机12槽增量
- [x] 5.1 保持默认8，将共享验证、初始配置、工具、设置页及当前文档统一支持1..12；新增12槽升降、持久重启及正式工具/UI选择12反例，13仍拒绝。实际关联23文件985PASS、Host类型及strict通过。
- [x] 5.2 运行关联23文件985PASS、Host及postgen两端类型和strict，创建不覆盖旧候选的新12槽preview/package；0.8.2保持，901文件逐字节验证。
- [x] 5.3 备份并在空闲窗热部署，正式工具读到默认8后明确设置本机12/persisted，实际在线12→8→12；原DSH进程及136历史文件保持。调参时active0，不冒称12云模型同时执行；MiniMax稳定身份目录仍未通过，GUI视觉仍待实证，均在日志明确保留。

## 6. Host独立容量延期准入
- [x] 6.1 新typed容量识别/Deferred合同；fresh/cold在确认无真实child/native且临时bind/pending/previous安全回滚后延期，保留Task/Worker/run/candidate/原prompt，不增长retired链，unknown delivery/cleanup错误不重试。
- [x] 6.2 Runtime原序回队释放插件slot，保留FIFO/写屏障/代际/权限；真正harness准入后arm执行timeout，独立host-child-capacity投影。预订阅SDK end与正式配置/volatile事件，epoch/合并/2–30秒one-shot backoff补齐无end回滚，cancel/close清理，不写Hostpolicy或旧失败任务。
- [x] 6.3 合成真实SDK AgentLoop+mock process覆盖Host1/2与plugin12、同root其他provider/不同root、fresh/cold、回滚/无悬空child/零native、一次prompt/原run、lost wakeup/取消/关闭、跨执行timeout等待与无end补偿；保留邻接调度/队列/AGY/最新MiniMax关联回归，不调用CLI/模型/HTTP/live文件。
- [x] 6.4 同步双语使用说明与设计/实施日志，Host/strict和唯一隔离preview/Remote postgen两端类型；核全部src/helper及bundlehash，收全部jobs并正式release，不pack/install/版本/Git/Host配置写，真实部署与任务由父会话另验。

## 7. 候选连续性窄修正
- [x] 7.1 同authority且新Deferred未携candidate时保留原hostWait.childId，不跨authority继承；补replacement-cap→cold-cap→replacement-admit官方SDK混合路径与authority反例，同Worker/run/candidate仅一次native prompt；重跑原26关联/Host/strict并新建不覆盖r1的r2 postgen候选、记录hash与交接，不改Core/MiniMax/Host/live。

## Workflow follow-up
- 父会话另行核对热更新、线上明确调参和GUI；不以本源码/合成通过冒称实际8槽已运行，不归档或提交本change。
