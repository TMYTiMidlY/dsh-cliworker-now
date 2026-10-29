# Tasks

## 1. 主 Agent 的模型控制与准入

- [x] 1.1 注册父会话所属 Worker 的只读模型目录工具，复用账号绑定及原生目录；测试跨父会话、缺绑定、取消、无可用目录及零任务副作用。
- [x] 1.2 注册显式 Worker 模型/强度配置工具，与现有 Remote 共用校验；测试有效 Argon→Opus 选择、无效标识/强度、角色/权限/conversationId 保持及项目默认不改变。
- [x] 1.3 保留忙碌、准备、清理未确认、原生子会话 inbox、暂停队列、子 Agent/宿主拒绝和固定模型 transport 门禁；用真实工具注册和 runtime 反例验证拒绝时零 prompt、零新 Worker。
- [x] 1.4 为 followup 增加可选 expected_model/expected_run_id，在异步准备和最终准入处复核；测试模型不匹配、过期轮次、UI配置/提交竞争与取消，不得隐式切换、重试或新建。按已批准匿名化证据补原生 child provenance：await next前捕获claimed输入，working-directory/runtime-context不单独准入；真实官方AgentLoop反例覆盖零额外run、用户同文与混合上下文，不能靠文本匹配。
- [x] 1.5 同步工具指引、README/usage与设计中的“先目录→显式配置→带预期模型续聊”示例；核对首次原生选型流程及旧调用仍兼容，不引导 Agent 在提示词写模型名冒充配置。
- [x] 1.6 实现显式cli目录查询及独立本父会话已确认setup配置；共用首次selection锁，首次缺setup为FIRST_SELECTION_REQUIRED。测试完整Argon角色确认→本conversation精确Opus→fresh start首prompt Opus，项目默认/其他parent/已有Worker不变；取消、source/权限/project/并发选择不暗填角色或产生额外任务；start可选expected_model仅作前置条件，配置后并发改回旧模型在快照/异步授权/同步准入处拒绝，零Worker/prompt。

## 2. 按轮次取回回复与模型证据

- [x] 2.1 检查现有历史的逐轮配置证据，必要时添加最小兼容运行摘要；测试新轮可恢复、旧轮缺证据明确未知、目录0700/文件0600，不迁写或删除旧历史。
- [x] 2.2 注册只读结果工具并实现绑定 worker/run/事件水位的有界分页；测试当前/旧run、未知run、长文本完整拼接、重复游标、追加竞争、跨父会话拒绝以及恶意游标。
- [x] 2.3 返回该轮配置模型、观察模型和独立终态；测试模型已改未执行、native模型不匹配、无正文超时、failed/uncertain及同一失败流的多段正文，不混入公开思考/工具或前轮 lastResult。无scope SUCCESS前缀不能扩写旧会话尾部；completed错/冲突模型仍targetModelVerified=false。
- [x] 2.4 同步结果契约与错误/部分性说明，记录合成运行证据；核对文档示例不会把 failed_with_output 或已配置 Opus 写作已完成 Opus。

## 3. 现有成果与 PR 口径核对

- [x] 3.1 对照代码修正双语README及usage的 MiniMax Plan、OpenCode仅v1 fork/v2固定模型纯文本条目；补 Cursor 数字身份后续更正的交叉引用，人工逐项核对支持矩阵与门禁一致。
- [x] 3.2 在日志与最终说明中区分源HEAD、独立候选、旧在线包和真实模型结果；保留Kimi GUI未复现、Cursor旧在线只读部分已过但新控制面/GUI等未验收、MiniMax本次provider覆盖在OAuth读取前拒绝、v2原生服务未验收，不替原有change虚勾真实验收。

## 4. 集成构建、热加载与真实 AGY 验收

- [x] 4.1 运行模型控制/结果/派遣/权限/隔离/AGY关联回归及strict规格校验，创建不覆盖旧材料的隔离预览，生成Remote后通过Host/Client构建和typecheck；记录精确命令、计数及SDK版本。实际20文件628PASS，最终r2预览284个src一致，DSH0.2.1-rc.2两端postgen检查通过。
- [x] 4.2 核对整合候选与在线包的实际差异、备份及热替换授权；检查全局活动Worker，保持原DSH PID/URL不变并验证新工具schema（含start.expected_model、models的cli及conversation配置）可见。实际候选889文件逐字节验证，旧102个Worker/history文件hash保持，PID/start ticks未变；新9工具及controlApiVersion=1实际可调用。忙碌时未强停他人任务。
- [x] 4.3 在本父会话按原生流程完成首次必要选型，仅创建受控只读canary；Argon实际回复后精确配置Opus/high，同conversationId续聊正确记忆且native observed匹配。另已确认conversation设Opus后fresh start携带回执actual模型，首个唯一run配置及native init均Opus，completed/cleanup confirmed；项目默认及另一个旧Worker仍Argon、role保持。旧run结果不借当前偏好，错expected_model真实零Worker拒绝；不以正文自称为证据。
- [x] 4.4 父会话仅对own fresh Opus canary在实际公开流且无终态时停止，真实interrupted/user、7152字符部分正文和cleanup confirmed，独立/proc无owned残留。正式result以8192完整读及4096+3056两页读到hasMore=false；停止后同Worker新nonce续聊completed，旧cursor再次读取仍旧水位/摘要/7152字符及interrupted/partial、不混入新成功。未触碰别的任务或原审题会话，私有ID/原题不入Git。
- [ ] 4.5 追加实际证据并完成PR适用性结论，明确Draft可审/可合并有限范围/正式完整版的区别；验证包名dsh-cliworker-now、版本0.8.2、用户账号和历史不变，确认未重启DSH及未自动commit/push/创建PR。

## Workflow follow-up

- 用户已明确授权实施及测试后整合热替换/实测；初次编码交接为13/17项，之后父会话已实际完成4.2–4.4，现16/17。4.5的PR适用性与完整交付结论仍未完成，GUI/其他CLI parity及新并发上线不能借既有Opus实测虚勾。
- 用户批准正式GitHub提交时再执行项目要求的全量测试；提交、推送、PR和发布授权分别核对，本change不自动执行。
- 所有约定验收实际完成后才考虑归档；未完成或受阻的真实检查保持可见。
