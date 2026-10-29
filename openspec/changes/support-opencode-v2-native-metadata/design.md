# Design

## Context

动机见 proposal。当前 native-session-http 是 v1，prepareOpenCode 会快照 auth.json 并创建隔离 OPENCODE_DB。原生 2.0.31 已把账号和会话放入数据库，并通过默认服务 registry 与 HTTP 元数据提供当前来源。本子任务没有真实服务或模型调用授权，不读取凭据值。

证据：安装 ELF 的 service.Info 记录为 id?/version?/url/pid/password?；默认路径 XDG_STATE_HOME 或 ~/.local/state 下的 opencode/service.json；固定 Basic 用户 opencode。官方 https://opencode.ai/v2/openapi.json 的 integration/provider/model 返回 {location,data}，variants 是数组，Connection.Status 仅在 needs_auth 时出现。/api/info 返回 version/pid/urls，但不证明 DB 路径或稳定 principal。

以下 Decisions / Risks 保留第一阶段元数据检查点的历史决策；当前实现范围及覆盖关系以“执行阶段补充设计”为准，不把历史“尚未实现”当成当前状态。

## Goals / Non-Goals

**Goals:** 版本 gate、正确状态诊断、精确原生模型/变体、显式只读纯文本 owned-session 执行与恢复、耐久准入和有证据的停止/隔离，保留 v1 回归。

**Non-Goals:** 不启动服务，不连接远程或无密码服务，不读取 provider credential API/SQL/value，不复制 DB，不修改 ~/.dsh，不把配置目录当远端模型授权；完整读写/工具能力及真实服务/模型/GUI/其他平台验收不在本轮。

## Decisions

- 新增 opencode-v2.ts，版本查询使用既有有界 ProcessBackend metadata capture；版本输出只接受明确 semver 1/2，未知格式/major 不回退。官方安装路径只作为默认 PATH 缺失的候选，不覆盖手动入口。
- 2026-10-25 父会话已获真实验收/空闲热更新授权后，补固定安装版横幅：正式路径API确认 `/home/timidly/.opencode/bin/opencode`，ELF SHA256 `2df936a20cf74af5706020342164628f9a31978c50c2b0ad306b42b614fe245d`。静态effect/cli默认formatter@131425441为 `formatVersion(name,version) => bold(name)+' '+dim('v')+bold(version)`；pipe时bold/dim为identity（@131424249），内置version flag@131450675调用Console.log（@131371041），root名opencode@131934196、版本sa=2.0.31@131919921、主入口@133155794。因此原生普通管道合同为 `opencode v2.0.31\n`；正式工具实测17字符、trim后单行、无ANSI，吻合而旧regex拒绝。仅增加lowercase品牌后literal v的完整版本行，不搜索任意数字、不扩大其他品牌/大小写/ANSI/未知major；prefix不得跨行。错误仅返回固定format枚举、字符/行数及ANSI布尔，不输出原始stdout/stderr，即使看似版本也不泄漏未知程序载荷。版本通过不证明服务、目录、权益或实际执行通过。
- Linux 默认服务 registry 按 inode/dev/nlink/mode/UID/大小/mtime/ctime 检查，读取前后检查父目录身份与 no-follow 祖先；不为其 chmod 或创建目录。只接受 http://127.0.0.1:port/，密码保留 Host 内存。核对 /proc/PID/exe、UID 及 /api/info 的 PID/版本/URL；registry 在结束时复验，拒绝来源改变。Windows/macOS ACL/进程身份未验证则显式不支持。
- API 函数只接受固定 GET 路径，取消/超时/总字节有界，禁止重定向，错误统一安全文案。相同 project directory 的包装响应必须一致；查询前后再次读取 integration/provider，检测变化。不访问全局事件、credential、session 或写 API。
- 原生第一 connection 决定元数据来源，不在失效或 env 来源后尝试其他账号；只支持无状态错误的 key/oauth credential。provider/model/variant 的认证、地址和 headers/body 覆盖保守拒绝。模型与 variant 用可逆 tuple 编码，default effort 仅为诊断，不虚构强度。
- 只读 snapshot 给出候选和 metadata-scope 指纹，后者只用于防止目录来源混用，明确不是 principal/远端授权。Catalog 的可执行 models 为空，携带 executionUnavailable 与 nativeModelCount；authorizedCatalog 可返回此明确空目录，而 authorizeSelection/validatePreference/extendedLaunch 必须拒绝。这样不违背既有可执行模型筛选规格，也不把元数据当任务授权。
- v2 AccountManager 显示 configured/unavailable/原生 needs_auth 的安全投影，只有 native 空 connections 才能说明未连接。仅 manage 终端，裸原生入口、原 project、无 v1 XDG/DB 配置；用户自己操作认证。
- 没有 v2 Worker 或新 transport tag；当前阶段先封锁所有执行，不创建假的 opencode-http-v2 任务。未来真正落地执行后才在 runtime 授权后、harness preparation 前固定 transport/capabilities。

## Risks / Trade-offs

- [完整执行代码尚未实现] → 当前只准入元数据，不冒称任务可用。正常原生 UI 的 key/OAuth connect 新建 credential record，公开 PATCH 只改 label，refresh 复用 record；下一阶段可用同服务+record ID+重检/切换观察达到既有适配器的实际竞态契约，不要求数学原子 pin，也不把缺少已实现代码归因于 API 本身无法支持。
- [OAuth 通用刷新锁和自定义外部来源未核验] → 只复用一个现有服务，不新建刷新客户端；下一阶段对支持来源保持明确限制，不读取秘密值补证。
- [共享服务停止不能由 bridge 退出证明] → 当前不启动远端任务；需继续实现 pending-input reconciliation、wait/terminal settlement 与持久 quarantine。上述是待实现代码，不是已证明的原生能力缺失。
- [默认服务、Linux 范围较窄] → 短说明告知未支持，不猜测其他 service 文件、平台或账号。
- [原生 GET 可能加载 location] → 插件只调用明确 GET，不直接改 DB/配置；原生服务仍按其自身语义处理加载，不声称文件系统绝无副作用。
- [原生 schema 变化] → 严格包装与失败关闭，合成夹具注明2.0.31/官方schema，不把测试当真实验收。

## 执行阶段补充设计（显式只读纯文本）

- 延续现有受信服务，不启动任何原生进程。提取无 Host 依赖的共享 service/metadata core供Host和原生bridge复用；密码和私有服务地址仅经Host-private env，绝不进入argv、request JSON、Gateway或ledger。未知版本、v1历史到v2续接不重解释。
- stable source binding 包含原生目录、当前 credential record ID/method、provider/model/默认 agent 的私有摘要，不含 PID/password/registry epoch；同来源正常重启不损坏已完成会话续聊。每轮另固定 registry/PID/version/secret epoch。global SSE 头部有独立有界等待且可被运行取消，先获得合法 server.connected 屏障再复核元数据；credential/integration/provider/model/agent/config/plugin/location/MCP 变化、own-session 模型/agent/permissions 外部变化或观察断开均 dirty 并取消，A→B→A 也不静默采纳。
- 默认agent采用原生列表已选默认首项；只投影id/mode/hidden/permissions和私有路由摘要，原始request/system/headers不出Host。会话最后规则 `[{action:'*',resource:'*',effect:'deny'}]`，不重放snapshotALLOW，不用plan agent代替强拒绝。所有工具包括read/glob/grep/shell/subagent/skill/question/web/unknownMCP均不准入，native model请求仍被允许。
- `opencode-http-v2` 在版本/选型授权后、harness preparation 前固定；plan 对 v2 意味着纯文本，不提供文件工具。allow-edits 在 picker/persist/prompt 前拒绝，附件在 preparation 前拒绝。preparation 仍先 bridge.ensure 创建真实 DSH child、绑定并设只读，再 v2 提前返回，不建 tool/MCP lease。工具/技能/附件/fork/steer/会话内模型修改均禁用且公开能力一致，backend 也拒绝改模型；v1 不变。opaque ID 显式按精确身份分组，不小写或剥 route，保留原生标签。模型/variant echo 在 prompt 前核对，实际 step 也须精确匹配。
- 只创建插件 owned top-level session，ID 使用原生 startsWith('ses') / startsWith('msg_') schema 支持的随机前缀值。create 可返回已有对象，必须再核对 marker/project/无 parent/agent/model/deny，碰撞不收养。私有 ledger 在可能写入前保存 pending，绑定 worker/run/session/input/不可变正文摘要与原始 epoch，不含认证值。续聊从已签水位审查 gap：只允许自身首次 created 与非内容 viewed/usage housekeeping；未知输入、synthetic 或历史/策略变化即 invalid，即使当前 idle、空 inbox、marker/model 一致也不使用被污染历史，不删除任何原生历史。
- prompt 仅一次 POST；ACK 只是耐久准入，丢失后核对精确 inbox、GET message/{ownInputID} 与 durable log，必须内容摘要一致，取消也不重发。execution.started 先于 inbox.delivered，不能编造 executionID；关联 baseline、唯一 own input、started/delivery/terminal。log 是原生事件 JSON，durable.aggregateID/data.sessionID/可选 location 均核对，after 为 exclusive；log.synced 是初始捕获水位，过滤行允许 seq 不连续，但倒序/冲突/错误会话不接受。只显示最终 text.ended/reasoning.ended，按 assistant/ordinal 去重，不伪装 volatile delta。成功还须最后实际模型 step 与非空公开最终正文；缺失则模型结果不确定。暂不投影 v2 usage，不补成本/令牌。
- stop 独立预算，先正向证明精确不可变 input 已准入，才可用随后同 PID cancel-own/interrupt(resume=false)/wait/active/inbox/log 证明前台清理。native prompt 的异步准备可能尚未到 D.admit，204 cancel 没有 tombstone；无正向准入证据时即使暂时 idle 也不签 settled。晚到后仅明确 cleanup-only 再证明已准入并停止，永不重 POST。已知准入的生命周期发布失败可使模型结果未知，但同进程 wait/active/inbox 仍能单独证明前台空闲；不伪造 terminal。桥死亡、PID 替换、缺清理证据或 policy violation 留 UNCERTAIN/quarantine。
- 可信 Node runner 以每轮 Host-private fresh key 签 ledger，HMAC 绑定 worker/run/source/project/model/agent/session/marker/epoch/input/正文摘要/baseline/水位及关键状态；Host 在 local range 退出后复核，SSE/native result 不能提供 proof。pending→spawn 抛错/桥 kill 默认持久隔离，冷 Host 恢复不放行。无会话的 pre-spawn 不确定状态、GET404 或新服务空闲不能自动清除，这是当前保守恢复限制。
- `tool.called` 的 executed:false 是 providerExecuted，不代表本地工具未运行；全工具 DENY 子集拒绝任何 tool.called/success/failed、shell/skill 活动并保持未确认策略隔离。cleanup-only 只触及原服务/marker 自身输入及前台执行，可跨当前账号变化，不借新账号派遣、不杀共享服务、不删历史，不声称任意 detached OS 作业静止。
- source变更后的远端清理与执行授权分开；可恢复明确隔离但不自动重播业务输入。纯文本deny*不冒称可证明任意外部detached OS任务已经结束。

## Migration Plan

无数据迁移。既有 v1 仅增加明确版本核验；无法核验则安全失败。所有原生账号、会话、偏好及现有构建保持，不安装或发布。恢复旧源码仅回退本 change 文件，不撤销其他 dirty 改动。纯文本之外的完整 v2 读写/工具能力，以及真实服务/模型/停止/续聊、GUI 和非 Linux 验收均保留未完成，不归档隐藏。
