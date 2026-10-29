# explicit-agy-catalog Specification

## Purpose
在旧父会话绑定失效时提供显式 AGY 账号的只读模型与强度发现入口，使后续正式选型无需猜测参数；保留隐式账号保护、原生身份稳定性检查及旧 Worker 隔离。

## Requirements

### Requirement: Explicit account catalog discovery

系统 SHALL 允许所属主会话以 cli=antigravity 与 agy_account=default|lxy 只读查询该账号精确模型和强度，且 MUST 不创建Worker、不写会话设定或项目默认、不修改已有Worker。

#### Scenario: Stale parent binding with explicit lxy query
- **WHEN** 父会话已有失效绑定并显式查询lxy目录
- **THEN** 系统使用lxy配置查询真实目录，不沿用旧expected绑定；返回只读账号范围、未确认配置和目录，原设定保持。

#### Scenario: Implicit query retains identity protection
- **WHEN** 不提供agy_account且当前账号与已保存绑定不符
- **THEN** 系统继续拒绝账号变更，不重绑定或回退。

#### Scenario: Selector misuse is rejected
- **WHEN** agy_account与Worker选择器混用、缺cli、非AGY CLI或无效账号值一起提供
- **THEN** 系统在查询前拒绝，不产生执行或配置副作用。

#### Scenario: Account changes during lookup
- **WHEN** 显式账号目录查询过程中实际账号身份发生变化
- **THEN** 原生授权层仍拒绝，查询不修改原设定。

#### Scenario: Parent and lifecycle guards
- **WHEN** 子Agent、忙账号终端、已取消调用或禁用CLI发起查询
- **THEN** 原有门禁继续拒绝；显式账号参数不扩大权限。
