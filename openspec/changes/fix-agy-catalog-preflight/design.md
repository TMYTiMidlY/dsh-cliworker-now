## Context

新建任务在创建 Worker/job 之前做目录、选型和 launch 授权，runtime 准入后再授权。已装包和源码均为每次目录固定15秒，AGY未启用既有安全诊断。单独目录成功不保证整个启动链通过。真实根因仍需修复后正式入口回读，不从通用Abort文本推断用户取消或quota。

## Goals / Non-Goals

目标是给AGY目录明确有界的60秒预算、可区分的安全错误、正确的账号HOME。非目标：删除重复授权、缓存跨请求目录、改变模型/权限/并发/账号配置、修改Harness核心或发布版本。

## Decisions

captureCatalogMetadata新增内部可选metadataTimeoutMs，默认为15秒并限制1–60000毫秒；只有AGY目录显式取60秒并启用已有safeDiagnostics。任务timeout不作为目录预算。原生设置检查传agyHome(undefined, config)，与子进程环境及identitySource一致。

保留caller abort优先、ProcessCleanupUnconfirmedError最高优先及terminate/waitForExit。输出字节预算和退出码检查不变。所有账号binding、角色、项目、exact model/effort与排队后授权原样保留。本轮不做3→1或3→2目录去重，避免在恢复故障时同时改变授权事务。

## Risks / Trade-offs

目录真正卡死时最多比以前多等待45秒；仍可由用户取消。多次预检仍可能累积等待，真实启动需验证。模拟16秒响应仅证明预算回归修复，不代表厂商服务恢复。lxy路径修正是独立的源码缺陷，不将其冒称timeout根因。

## Rollback

只撤销本次AGY调用点、内部预算参数和关联新增测试/规格，不回滚仓库其他dirty，也不改私有状态。安装前确认无活动CLI任务；保留原安装包作为回退依据。不重启整个宿主来绕过并发或权限。
