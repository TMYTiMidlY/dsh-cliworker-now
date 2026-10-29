# Spec Delta

## ADDED Requirements

### Requirement: 公开操作异常的安全投影
插件 SHALL 在公开工具与Remote展示边界区分可核验取消、已证清理/投递未确认及不透明异常，不直接字符串化未知对象、不遍历cause或调用未知getter/toString。内部控制流的原始abort identity MUST 保持；公开取消只依据真实signal或已证类型，不能从对象文字推断quota/auth或派遣绝未发生。清理与投递未确认 MUST 保持优先，不因取消隐藏。

#### Scenario: 已取消的结构化原因
- **WHEN** 正式工具请求在准入前或等待同CLI选型锁时被真实signal以plain object原因取消
- **THEN** 返回固定可读取消错误，不显示object Object或私有字段，不新增目录/Worker/prompt，不改变其他仍有效请求

#### Scenario: 未知对象或访问器
- **WHEN** 公开操作抛出未知对象或含异常message/code/cause/toString访问器的错误
- **THEN** 使用不透明固定诊断，不读取访问器或递归序列化，不以对象内容冒称已退出/无额度

#### Scenario: 取消同时存在未确认清理或投递
- **WHEN** 已证进程清理或投递范围未确认且caller同时取消
- **THEN** 保留原有保守语义与不可自动重发提示，不降为普通取消，不用错误展示改变底层控制身份
