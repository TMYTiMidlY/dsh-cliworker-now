# Tasks

## 1. 安全捕获与Cursor投影

- [x] 1.1 对Cursor binding同步/异步resolve、同步spawn、读流、退出和内部超时先补合成反例，再实现固定阶段/受限退出及系统原因诊断；metadata-cleanup/catalog-decoding成功与输出预算回归必须通过。
- [x] 1.2 将可信诊断接入Cursor material resolve、原生status及绑定错误透传；cursor-native/cli-account-binding测试覆盖不误称登出、无原始message/stdout/stderr/argv泄漏，真实未认证/格式错误保持原语义，同步简短使用说明。
- [x] 1.3 验证调用者取消与terminate/wait清理失败优先级、按CLI保护和无自动任务/重试；合成测试断言零prompt、旧Worker/run/模型/账号不变，并记录具体结果。
- [x] 1.4 收敛独立审查的矛盾signal/无效accepted退出码与非Cursor取消竞态反例；安全成功必须无signal且为允许的uint32，默认分支保留旧异常身份，重跑关联验收。

## 2. 独立集成与正式核对

- [x] 2.1 运行影响范围回归、Host/Client类型、严格规格及新隔离构建；核对源码/预览/包一致并记录实际数量，不冒充全仓通过。
- [x] 2.2 在真实空闲窗口保留最新AGY/OpenCode/Cursor修复并备份官方热更新，核对历史/并发/无关依赖/PID；只对原Worker以精确run/model条件做一次正式核对，收齐结果，若仍前置失败只记录实际阶段，不自动再发。
- [x] 2.3 在本change和doc/tasks追加实机证据与尚未恢复的具体条件，区分诊断上线、账号状态、目录可读和实际模型执行；保持其他CLI和未完成目标可见。

## Workflow follow-up

- 1.1–1.3为原写者阶段；父完成独立审查1.4、隔离包、备份热装及一次原Worker正式核对。634项关联通过不是全仓验收；正式run94472825已越过准备但被额外权限拒绝，shell exit7仍未获独立证明，之前准备失败根因仍未知。详见verification，Cursor其余工具/权限及总目标继续，不自动归档。
- 不自动Git暂存/提交/推送/PR/版本变化/发布或归档；Cursor结果分类与此准备期诊断分别交接。
