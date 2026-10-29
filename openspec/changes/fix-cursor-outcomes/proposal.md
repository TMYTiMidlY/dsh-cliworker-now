# Proposal

## Why

Cursor 2026.10.19-6bbf2c4 会把部分认证/计费/配置/连接异常转换为普通 assistant text，最后仍返回 end_turn；工具 presenter 也把内部错误写为 completed。现有 Cursor 适配器仅依赖 end_turn 与非空正文，可能假报成功。

## What Changes

- 仅为 Cursor 增加本轮结果跟踪，不改变其他 ACP 的默认处理。
- 已核实的 source-shaped 诊断只表示疑似异常：结果待核实并保留正文；相同文本也可能是合法引用，不能认定为错误。
- 仅从同轮同 session、已关联 toolCallId 的严格原生 rawOutput，或Host对该唯一已开卡ID的确定本地权限拒绝，识别确定工具失败；未知或冲突格式保守待核实，不解析用户正文、文件内容或 stdout 的 JSON/错误词。
- 仅read工具在没有已核实raw正证据、又无确定负向/硬失败时保持UNKNOWN与本轮UNCERTAIN；原生缺输出无法区分正常非文本与失败，不据文件名或Host路径检查猜ERROR。
- 不改变原错误、取消、非零退出和清理失败优先级，不添加自动重试或下一轮执行。
- 范围外：effort/rail、MCP/附件/权限能力、安装、真实 CLI/模型、版本/包名变化。

## Capabilities

### New Capabilities
- `cursor-run-outcomes`: Cursor 结果的保守诊断与已关联工具失败判定。

### Modified Capabilities

无；复用已有 UNCERTAIN 与后续队列暂停机制。

## Impact

Cursor 专用 helper 与 native-cursor 的结果包装、公共 ACP 可选 post-dedupe acceptedUpdate/projectTool 钩子（其他 CLI 默认不变）、合成测试、构建 helper 清单及说明文档。依据为 native-acp.mjs 的文本/工具投影和本机安装源码 6136.index.js 的静态分支；不读取真实凭据或会话日志，不执行安装模块。既有 c3 真实验收不作为本次新实现的模型验收。
