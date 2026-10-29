# Design

## Context

动机及实机事实见proposal。现有 `captureCatalogMetadata` 在spawn后并行读stdout/stderr、等待done、检查取消及退出码，在finally终止并等待范围退出；spawn在try外。Cursor的status与绑定使用同一只读原生命令，但非专有异常会被账号绑定末级包装吞成笼统错误。现有[metadata-cleanup](../../../tests/metadata-cleanup.test.ts)、[catalog-decoding](../../../tests/catalog-decoding.test.ts)、[cursor-native](../../../tests/cursor-native.test.ts)测试可复用。尚不知道两次真实续聊的原始失败阶段，不能先认定认证、网络或超时。

## Goals / Non-Goals

**Goals:** 只让准备期失败具备安全、可核对阶段；保持成功返回值、取消/cleanup优先级、当前来源和任务零准入。新诊断是证据，不是恢复策略。

**Non-Goals:** 不解析或输出任意CLI stderr以猜认证；不修登录、不自动重试、不新建替代Worker、不换号/模型/权限；不改其他CLI业务、原生路径选择、SDK进程监管或既有保护记录。不把此工作并入Cursor正文/工具负证据分类的实现范围。

## Decisions

- 共享捕获边界只增加Host私有的结构化失败信息：固定phase枚举resolve/spawn/read/exit/timeout；exitCode仅受验证整数或null；系统原因仅允许列表，其余unknown。若保留字节/耗时计数，也仅是经验证有界整数，不保留原始message/cause、stdout/stderr、env或argv。
- 共享捕获通过末尾 Host 内部 opt-in 参数启用安全异常，默认保持原异常/成功语义；不是新增 RPC/tool 参数。Cursor binding material 的 resolve 只做外层安全映射，入口选择与文件读取授权不变。同步/异步 resolver 抛错均为 resolve；caller 取消及 typed cleanup 先于映射，仅固定已知 Cursor 路径配置短错误可以保留。
- Cursor status入口将可信捕获诊断投影为简短安全错误，明确这是原生元数据调用失败而不是已登出。现有JSON解析/原生未认证判定仍独立，不以进程退出码推断认证拒绝。其他CLI维持旧公共错误语义，不通过全局改文案扩大范围。
- 安全成功只接受允许的uint32退出码并且signal为null/undefined；code=0与任意非空signal并存也不成功。固定已知signal仅给signal标签，其余给unknown。调用者取消覆盖之前错误仅限safeDiagnostics；默认分支在spawn/read原错误与取消竞争时仍保留原错误，不扩全CLI行为。
- 捕获应覆盖同步spawn异常及读流/done失败，但finally只清理真正创建的handle。调用者取消保持取消控制语义；查询自身期限单独标timeout。任何terminate/wait不确认仍抛原ProcessCleanupUnconfirmedError，优先于新阶段诊断并走现有按CLI保护，不为了拿诊断放行冲突操作。
- 不采用日志整段、stderr尾部截断或任意异常.name/code透传。只允许来自本地捕获控制流的阶段和封闭原因；未知外部字符串不经“看似安全”正则后直接公开，私密marker反例须断言不泄漏。控制信号reason不用于拼公开诊断。
- 不新增RPC或CLI诊断执行器。复用现有账号/status/目录/续聊路径，同一个Worker的最终正式canary仍带精确run/model前置条件。优先合成验证每个阶段与错误优先级，再空闲备份热更新；真实失败只记录实际阶段，不因候选已安装而宣称修复或执行成功。

## Risks / Trade-offs

- [改捕获finally破坏清理] → 对spawn前失败、读流失败、退出失败、超时/取消以及wait/terminate失败逐项验证；cleanup不确认必须胜出。
- [阶段信息不足以定位根因] → 诚实保留unknown；取得实际阶段后再决定下一窄修，不把未知native错误外推为认证/额度事实。
- [类型或错误文案影响其他CLI] → 固定保留非Cursor的既有公开语义及成功值，执行metadata、binding和对应适配器关联回归，不全仓重构。
- [敏感值进入异常链或日志] → 仅保留封闭枚举与数值；测试恶意message/code/stdout/stderr/argv marker，不能靠截断或散列代替不披露。

## Migration Plan

无存储、配置、账号或Worker迁移。源码/类型/严格规格及全新隔离候选通过后，仅在正式全局空闲及native进程guard满足时备份并官方热装；保留已验证AGY、OpenCode版本修复和历史。回退只使用当时实际已安装归档，不删除私有状态、不重启DSH。代码实施与后续实机结果分别记录，不自动归档、提交或发布。
