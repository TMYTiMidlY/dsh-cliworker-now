# Spec Delta

## Purpose

为用户提供独立 Cursor Agent CLI 接入，保留其自身账号、精确参数化模型标识及原生 ACP 会话，复用宿主派遣与生命周期约束，并明确拒绝未经验证的认证路由、权限提升和会话能力。

## ADDED Requirements

### Requirement: 独立路由及原生可执行程序
系统 SHALL 将 cursor、cursor-agent、cursor agent 与 cursor CLI 路由到独立 Cursor Agent，不将 generic agent 或 Cursor IDE 作为备用执行入口。

#### Scenario: 不替换产品
- **WHEN** 已配置的 Cursor CLI 缺失或 Windows 入口未核验
- **THEN** 派遣失败并提示配置原生 CLI，不启动 IDE 或其他 CLI

### Requirement: 账号安全识别
系统 SHALL 仅从原生 status JSON 投影安全邮箱与登录状态；账号绑定 MUST 依赖稳定用户身份，拒绝未支持的 API key/自定义服务路由，不向客户端暴露原始元数据或凭据。

#### Scenario: 原生数字账号身份
- **WHEN** status 返回 authenticated 与 1..2147483647 范围的整数 userInfo.userId
- **THEN** 使用该原生数字身份生成私有稳定绑定，不因不是字符串而误报不可用，不向客户端暴露账号 ID

#### Scenario: 非原生账号标识
- **WHEN** userInfo.userId 是 0、负数、非整数、超出 int32 范围或字符串
- **THEN** 不强制类型转换，并拒绝将其作为原生账号身份授权任务

#### Scenario: 用户资料暂不可得
- **WHEN** CLI 报告令牌存在但缺少稳定用户身份
- **THEN** 显示凭据已配置而非未登录或远端授权成功，并拒绝可复用任务账号绑定

#### Scenario: 账号切换或登出
- **WHEN** 目录查询前后或任务启动前的账号身份发生变化
- **THEN** 拒绝旧选型，不自动恢复其他账号或发送 prompt

### Requirement: 零 prompt 原生模型目录
系统 SHALL 只采用 ACP v1 新会话广告的模型配置选项，原样保留含括号参数的 opaque ID，仅提供 default effort；目录查询有时间、字节与进程清理边界，不删除原生空会话历史。

#### Scenario: 参数化模型标识
- **WHEN** CLI 广告 grok-4.7[context=256k,reasoning_effort=high,fast=true] 或 default[]
- **THEN** 选型与运行保存完整 ID，不拆出或猜测强度、窗口及快速模式

### Requirement: 原生模式与会话严格执行
系统 SHALL 在 prompt 前通过 plain-string config 选项确认所选 model 与 agent/plan mode；恢复加载精确会话，拒绝额外权限，取消后确认整个进程范围退出。

#### Scenario: 模型或权限未确认
- **WHEN** 选择回执缺失、模型不匹配或 mode 不匹配
- **THEN** 任务失败且不发送 prompt

#### Scenario: 恢复与取消
- **WHEN** 任务有原生 session ID 或运行中收到停止
- **THEN** 仅加载该 session；停止发送原生 cancel 并等进程退出，不因仅收到 cancel 回执就报告成功

### Requirement: 未验证能力保持关闭
系统 MUST 对 Cursor 关闭工具/MCP 注入、附件、分支、实时引导；未知统计保持未知，不用其他 CLI 数据补齐。

#### Scenario: 请求未支持能力
- **WHEN** 用户请求 Cursor 附件、分支或额外权限
- **THEN** 返回明确不支持或拒绝，不静默忽略、提升权限或伪造成功
