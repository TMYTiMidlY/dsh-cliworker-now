# Design

## Context

动机见 proposal。现有 `native-acp.mjs` 已支持 configOptions plain-string 编码、modeConfigId、loadSession、权限拒绝与取消，可复用但不能把 Cursor 假定为 Qoder/Kimi。父会话已观察 ACP protocolVersion=1、loadSession=true，无 agentInfo；model 与 mode 是 select，mode 值 agent/plan/ask。模型 ID 含原生方括号参数。原生 status JSON 的 userInfo 可能在 getMe 失败时缺失。

## Goals / Non-Goals

**Goals:** 新增 cursor CLI；复用 Host 的 ProcessBackend 与最后账号绑定检查；零 prompt 目录读写有界，客户端仅接收 ModelChoice 与安全账号投影；原生 model/mode 确认失败不执行。

**Non-Goals:** 不复制或解析 token 文件；不支持 API key/自定义端点；不跨会话缓存认证；不以 CLI token 标记证明远端订阅权限；不执行真实 prompt、安装或发布。

## Decisions

- 新增 cursor-accounts.ts 处理 status 投影与私有 subject 哈希。仅原生 status 有可用 userId 时允许 account binding；已安装原生 GetMeResponse 的 user_id 是 int32，status 原样输出数字，因此只接受 1..2147483647 的整数，不接受字符串强转或 protobuf 默认值 0。缺资料但有 token 显示 configured。所有异常对外固定安全文字。
- 模型元数据使用独立有界 ACP 查询器（initialize → session/new → 读取 configOptions），绝不调用 session/prompt。前后重新 status，比对稳定账号，并依赖现有 authorizedCatalog 的启动边界复验。允许创建原生空会话并在文档说明，不删除历史。
- 新增 native-cursor.mjs 调用 common runNativeAcp；argv 只为 cursor-agent acp，editMode=agent，modeConfigId=mode，plain-string encode，default effort。模型/模式 schema 必须为已观察 select/currentValue/options；不猜模型容量、计费、其他 RPC。
- 无 agentInfo 时不发明品牌断言；通过已确认 CLI 路径和原生 status/ACP 组合确定来源。Windows 仅显式 cursor-agent CLI-native 入口，拒绝 cursor.exe/通用 agent 和自动 IDE 搜索。
- 用现有列表、设置控件和通用图标，不引入专属样式；模型参数整体作为不可信文本。
- Cursor 权限请求不走 nativeHarnessAcpApproval，附件/工具连接防御性拒绝；保留原生工具事件展示，不允许 DSH MCP 注入。

## Risks / Trade-offs

- [CLI schema 变化] → 固定已观察字段与失败关闭；模拟测试明确非真实模型验收。
- [身份查询暂不可用] → 保留 configured 诊断但阻止不可追踪任务，比静默换账号安全。
- [查询产生空原生会话] → 明确说明，不删除会话或伪称只读文件系统。
- [共享 ACP 行为回归] → Cursor 配置用显式 hooks/开关，复跑原有 ACP 回归。
- [Windows 未验证] → 仅显式 CLI 路径，品牌不明入口拒绝；不声称 Windows 验收。

## Migration Plan

无数据迁移。保留原包名、现有 CLI ID 与已装插件。父会话后续独立构建、安装和真实验收；本任务只改源码和模拟回归。回退时仅回退 Cursor 新增代码，不动 AGY dirty 基线或用户凭据。
