# Spec Delta

## ADDED Requirements

### Requirement: Codex目录连续查询的来源与失败分类
Codex目录 SHALL 每次使用同一原生执行上下文的fresh metadata与scope检查，不用显示缓存放行。未知scope、未分类拒绝、已确认quota/auth拒绝、真实空目录与能力交集为空 MUST 分开说明，不能从unknown推断无余额或登出。Native进程前后来源身份 SHALL 稳定；正常同principal OAuth token轮换不当账号变更，真实root/provider/route/principal变化必须拒绝，来源标识不得进入公开目录或错误。已证清理未确认和caller取消仍保持原有优先级。

#### Scenario: 同来源正常连续查询
- **WHEN** 首次models和后续准入各次fresh native/scope均有效且来源一致
- **THEN** 目录与effort保持精确，无业务prompt；不存在代码固有的第二次必空

#### Scenario: 曾有目录但后续scope未知
- **WHEN** 同来源旧显示目录可用而当前fresh scope未知或未分类拒绝
- **THEN** 拒绝本次准入并给受限明确reason，不自动重试、借cache或称已无额度，旧成功不等于永久权益

#### Scenario: Native准备期间来源变更
- **WHEN** Native刷新前后出现root/provider/route/principal变化，而非仅同principal token轮换
- **THEN** 不把A的native能力与B的scope相交，保留来源变化拒绝，不先归成A无模型或无额度

#### Scenario: 目录错误同时来源已变
- **WHEN** Codex已确认清理的受限目录错误发生且外层绑定复核证实A已变B
- **THEN** 优先说明来源变化，保留零授权/零业务prompt，不掩盖为旧账号空目录；清理未确认时不再启动额外查询
