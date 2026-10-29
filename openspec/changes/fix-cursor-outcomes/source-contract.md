# Cursor outcome 重写的固定安装版来源合同

本文件是2026-10-25只读静态审查证据，不是已实现或真实负向验收声明。原4测试草稿已退出运行和出货路径，不能照其行为实现。

## 固定来源

- 官方入口 `~/.local/bin/cursor-agent` 指向 `2026.10.19-6bbf2c4/cursor-agent`；wrapper第31–35行执行同目录index.js。
- `6136.index.js` 为单行，101021 UTF-16 code units/101023 bytes；SHA256 `dc44b42cada8341448edf3e4ca64c0a0f17ebf0afd1e428464340cf9e6decd41`。下文@是该文件0-based UTF-16位置，不是字节偏移。
- 主 `index.js` SHA256 `39af0910c68c127ca534f7df096652219a08cf756394f18dc5654ae3c47d63ba`；shell_exec_pb在第414行，ShellResult@5022182、ShellSuccess@5026852、ShellFailure@5027616。
- 审查没有执行CLI、import/eval模块、读凭据或历史、跑模型。大单行read被截断后只以字符串定点提取、哈希读取程序源。

## 生命周期与类型

sendToolCall@75049发送tool_call、opaque toolCallId、kind、pending、rawInput及locations；sendToolCallUpdate@75248不再发送kind，undefined在JSON中省略。openToolCallCard@77884使用callId及getToolKind(tool.case)。refresh@78475只更新title/rawInput/locations，省略status/rawOutput合法，不能清空已有证据。toolCallCompleted@77228即使底层失败也发送completed。processPrompt@10373清presenter状态，因此ID关联只在本run、active同session内成立。load及prompt前的重放不准入。

getToolKind@99608中shell映射execute，但execute还包括computerUse、writeShellStdin、setupVmEnvironment、replaceEnv、startGrindExecution。只能继承已关联typed kind；不得从title、name、rawInput.name猜测shell。shell输入@91646为 `{command}`，stdin为 `{shellId,chars}`，computerUse为 `{action,coordinate,text}`。watch通知使用watch-UUID/kind other，合法无rawOutput。

补充静态字段证据（本轮有界字符串读取，没有执行模块）：同固定hash主 `index.js` 的 WriteShellStdinArgs@4814152，constructor为 `shellId=0,chars=""`，descriptor为 `WriteShellStdinArgs|1 shell_id 13|2 chars 9`，即 protobuf uint32 number（0..4294967295）与string；不是string/safeInteger双类型。WriteShellStdinToolCall@4596886引用 `background_shell_exec_pb.js` 的该args。仅按此形状识别execute/stdin子型，未知类型不认确定负证据。

该presenter没有eventId、native toolName、parentCallId或provider response ID。公共轨若收到eventId先去重再观察；无ID不可按文本去重assistant token。合法metadata update不因整JSON变化被误判为reuse。冲突开卡/kind漂移/矛盾终态才建立关联歧义；孤立update不在后来开卡后追认为确定失败。

## 原生输出形状（extractToolCallOutput@96320）

| 工具 | 正常可见对象 | 负向可见对象 |
| --- | --- | --- |
| shell@96393 | success或failure都可能为完整 `{exitCode,stdout,stderr}` | int32非零是可见非零证据；timeout/rejected/spawn_error/permission_denied均undefined |
| read@96571 | `{content}`，仅文本content分支 | error/非文本success都undefined |
| readLints@96722 | `{totalDiagnostics,totalFiles}` | `{error:string}` |
| grep@96932 | `{totalMatches,truncated}` | `{error:string}` |
| semSearch@97363 | `{resultCount}` | `{error:string}` |
| glob@97593 | `{totalFiles,truncated}` | `{error:string}` |
| ls@97783 | success或timeout都可能为 `{success:true}` | `{error:string}` |
| mcp@97939 | `{success:true}` | `{error:string}` / `{rejected:true}` / 独占`{permissionDenied:true}` |
| webSearch@98161 | `{referenceCount}` | `{error:string}` / `{rejected:true,reason}` |
| webFetch@98394 | `{success:true}` | `{error:string}` / `{rejected:true,reason}` |
| task@98592 | `{durationMs,isBackground}` | `{error:string}` |
| writeShellStdin@98825 | `{success:true}` | `{error:string}` |
| generateVideo@98973 | `{filePath,durationSeconds}` | `{error:string}` |

其余分支可无rawOutput；edit/delete的diff由extractToolCallContent@95115提供，不得抹掉。成功object和普通文本必须保留，不递归解析read.content、stdout或业务JSON里的error字段。

**不能编造的边界：** error/reason字符串原生可为空、含换行；插件可安全限长但不能把该限制冒充原生schema。permissionDenied源分支没有reason；混入未知字段不属确定负向。shell exitCode是int32，不是任意safe integer或0..255；success/failure都默认0，所以零只表示“无可见负证据”，不能误降UNCERTAIN，也不能证明底层ShellSuccess。原生丢弃的signal/aborted/oom/read error/ls timeout不能靠插件猜回。

## Source-shaped assistant诊断

processPrompt catch@14955：取消直接返回；action错误@15088–15206分别发送以下固定文本；unauthenticated@15329和generic@15604进入Error族：

- `\n\nPlease sign in to continue`
- `\n\nUpgrade your plan to continue`
- `\n\nAdd a payment method to continue`
- `\n\nCheck your settings to continue`
- `\n\nError: ` 加非空内容；固定unauthenticated分支是该族的一种。

handlePrompt@8349在catch吞掉错误后仍可end_turn。五族准确是四个action literal加Error族（按catch分支是六条）。没有错误origin标签，同文引用不可区分，最多UNCERTAIN；未知action回退任意message，不能宣称穷尽。扫描必须覆盖当前完整chunk及有限prefix carry，再保留carry；不得先截尾漏掉大chunk前部。诊断只给固定摘要，不复制String(error)。

## 本地权限拒绝的确定来源与新增边界

父正式run `94472825` 已有否定证据：本地权限拒绝导致run ERROR，但同原生tool最后COMPLETED，独立proof不存在；正文标记不是执行证据，不重试。这里记录父提供的本轮证据边界，不回读真实历史。当前案例没有可见shell exit7证据，也不把可见exit0说成该案例事实。

同固定6136源码@56283，ACP decision provider的requestApproval/requestReadApproval发送requestPermission：sessionId来自本session，toolCall.toolCallId沿用operation.toolCallId，选项allow-once/allow-always/reject-once；rejected/cancelled明确返回approved:false。@75400附近presenter仍对toolCallCompleted无条件发completed；@96393 shell仅success/failure产rawOutput，rejected/permission_denied为undefined。这一“本地确实拒绝 + 同session/唯一opening ID”补足原生丢失的origin，不靠title/reason或空输出猜失败。

common默认行为保持，只有Cursor选用permissionDenied钩子：active&&!ended、exact session且确实准备发送reject/cancel回执时，先保留原run权限ERROR，同步传安全sessionId/toolCallId固定事实。未知/foreign/preprompt/late或无有效唯一opening不造FAILED卡。tracker以独立identityAmbiguous标记orphan/重复opening/kind或输入子型漂移；localDenied只在身份有效时硬投影FAILED，压过普通output冲突；拒绝后ID复用使合并卡UNKNOWN，不能把上一调用的拒绝贴到新调用。native failed等原硬失败独立保持。

本阶段不开放allow grant/批准桥、force/全局配置、MCP/新RPC或自动下一次；正常MCP allow_once不应触发拒绝钩子。必须helper+真实合成Bridge+官方消费者先红→绿覆盖空/exit0、关联隔离、先后reuse与output歧义、取消/cleanup；真实运行由父独立处理，不把合成当恢复。

## Read缺正证据的明确未知边界

父另一次正式run `871202a9` 已收齐：仅一项read，路径由父提交前后独立确认不存在，原生卡仍completed且toolCall.output始终undefined；正文marker不是文件已读的证明。本写者不回读真实历史、不重新读该路径；手工不存在证据不是运行时ERROR分类依据。

固定6136@95115的extractToolCallContent只处理edit/delete diff，没有read或image内容分支；@96571的read rawOutput只在success.output.case为content时产`{content:string}`（空串合法）。非文本成功和error都可能undefined，因此缺输出不能判确定失败，但也不得默认为成功；同kind read的readLints可保留严格计数正证据。无法从这个ACP层确证image success，不用合成image/content、工具标题、文件扩展名或error文本建立正证据。

仅read最终没有有效raw正证据且无确定negative/原硬失败时UNKNOWN，原SUCCESS为UNCERTAIN；其他kind不泛改。此前合法raw正证据及metadata省略保留，独立确定失败、本地拒绝、native failed、取消和cleanup仍胜出；不自动重试/下一条。

## 实施门槛与反例

1. Cursor专属accepted/post-dedupe观察点；不搬动Grok扩展receive轨。每工具独立保存typed kind、已核输入shape、原生status/terminal、rawOutput是否出现、累计证据及ambiguity；缺字段不清旧值。
2. 只对同session/run、已关联无歧义、严格独占源形状判确定ERROR；孤立/复用/混合/未知shape为UNCERTAIN。另一独立无歧义失败仍能ERROR，不全局吞掉。
3. 可被后续冲突推翻的raw推断不可提前写入common sticky fail；原生failed/权限拒绝、取消、RPC/传输/退出/cleanup硬失败仍保留原优先级。最终只降原SUCCESS。
4. 保留已知成功object、edit diff和完整公开正文；错误/未知负向不公开raw error/reason或整update。UNCERTAIN复用Host暂停队列，不重试。
5. 必测：四action/unauthenticated/generic及同文引用；跨chunk、大chunk前部；exit0/stdout错误JSON、int32非零、范围/类型/缺字段/混success；非execute标题带run；全部成功object/diff/watch；空/多行reason；负向后合法metadata省略；正负矛盾；冲突ID/kind/孤立；eventId重放；foreign/load/preprompt/ended隔离；原硬失败优先；result正文及队列纵向断言。

这些反例必须先打红再实现，最后另做真实负向、停止/恢复及GUI验收。现有正向回归、原生运行中停止/恢复不替代负向分类验收。
