# Tasks

## 1. 版本和受信来源

- [x] 1.1 实现有界原生版本识别与默认官方路径 fallback，覆盖未知版本、手动路径不替换及 v1 fixtures。
- [x] 1.2 实现 Linux 私有 registry 与固定原生服务身份校验，合成测试覆盖 no-follow、权限/路径 race、版本/PID/URL、重定向、字节/时间/取消；不启动服务或读取 DB。

## 2. 元数据与入口分流（第一阶段历史；当前纯文本通路见第4节）

- [x] 2.1 投影当前 credential/integration/provider/model 与精确数组 variants，测试环境/needs_auth/覆盖路由/切换过滤及无原始秘密输出；候选只诊断且状态不虚报远端认证。
- [x] 2.2 接入 AccountManager、authorizedCatalog、binding 和执行准备门禁，测试 v2 缺服务不误判登出、账号终端仅 manage、不创建 v1 数据/任务/注入；保留 v1 回归并同步使用/设计说明。

## 3. 集成核对

- [x] 3.1 执行关联回归、strict规格校验和全新隔离构建/typecheck，在 doc/tasks.md 追加精确结果及未验收边界；保留现有预览/归档/dirty，Git index为空。

## 4. Owned-session显式只读纯文本执行

- [x] 4.1 提取Host/bridge共享受信service core；稳定credential来源绑定与per-run epoch分离；原生默认首项agent安全投影、路由过滤、变更/观察流缺口触发dirty及取消。
- [x] 4.2 接通版本固定opencode-http-v2，preparation前固定transport；仍创建真实DSH child但不建工具lease；精确opaque身份/picker/echo，v2禁用编辑/工具/MCP/附件/fork/steer/会话内模型修改，v1保留。
- [x] 4.3 实现全工具DENY的owned session创建/碰撞/marker/ledger及安全resume；审查已签水位后的外来输入/历史，不能baseline跳过；源证据ID，不收养或删除用户历史。
- [x] 4.4 实现耐久input ID准入、ACK丢失精确核对、不盲重发、每session durable SSE/水位/terminal关联与ended去重；不伪装volatile delta，最终模型step/正文缺失或冲突为模型结果未知。
- [x] 4.5 实现独立stop，必须清理前先证明owninput已准入，防止pre-D.admit晚到；同PID cancel-own/interrupt/wait/active/inbox/log与Host私有HMAC；桥kill/PID替换/缺证据持久quarantine及cleanup-only，未创建会话/404不自动解除。
- [x] 4.6 实际Host→Node bridge→合成v2服务及官方DSH child集成回归：v2为61metadata/44execution/1service integration；关联31文件938PASS+4既有skip，全新r2 preview生成Remote/Host/Client构建及postgen typecheck、283个src与helper副本一致，详见doc/tasks.md。

## 5. 仍未开放的能力与真实验收

- [ ] 5.1 完整编辑/读取文件/工具/原生后台/MCP/附件/fork/steer策略与执行验证；纯文本deny*阶段不替代。
- [ ] 5.2 获授权后完成真实服务/账号/模型、续聊/停止、GUI与其他平台验收；当前子任务不执行。

## Workflow follow-up

- 父会话独立复核与打包另行进行，安装须再确认；不自动归档，不将纯文本阶段代码/合成验收报告成完整 OpenCode v2 或真实服务/模型验收。
