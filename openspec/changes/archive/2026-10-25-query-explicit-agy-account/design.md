## Context

conversationCatalog 当前总是带 conversationSetup.binding 查询。显式切换账号已经存在于新任务/配置入口，但只读模型工具缺少同样的账号选择。需要让重新选型能从公开目录开始，而非猜 effort 或删除私有绑定。

## Goals / Non-Goals

允许显式账号的只读发现，保持隐式查询和已有Worker的账号保护。不修改旧绑定，不替用户执行账号登录、不自动切换模型/权限、不放宽查询内的身份稳定性校验。

## Decisions

为 models 增加 agy_account，可且仅可与 antigravity 的 cli 选择器合用。参数在目录查询前校验。显式账号时构造独立RuntimeConfig并不传旧expected binding；authorizedCatalog仍对查询前后本账号身份做稳定性校验。隐式查询完全保留旧路径。

显式目录回执使用 explicit-account-read-only 范围，firstSelectionConfirmed=false、configuredModel/configuredEffort=null，并返回 agyAccount。该回执不宣称切换父会话选择。旧 setup/项目偏好/Worker 无写入；显式目录不更新设置页缓存。后续必须使用公开 start 或 configure_conversation 显式携带账号与精确模型/强度。

## Risks / Trade-offs

显式账号查询会读取指定账号的模型元数据，但不返回私有绑定或凭据。无效账号、非AGY、Worker混用、子Agent、忙账号、取消和CLI禁用均拒绝。账号在查询中变化仍失败。默认隐式查询不自动回退，避免把明确选型能力变成静默保护绕过。

## Migration Plan

先关联测试/typecheck/隔离preview，再在无活动Worker时按已安装Host入口更新并验证热重载。安装包不是源码软链，部署前核对其真实路径；不改DSH核心或启动替代服务。保留构建前副本以便回退，不发布、不提交其他会话改动。

## Open Questions

真实lxy目录与润色模型执行需在部署后经正式工具分别验证；源码/模拟测试不代表真实成功。
