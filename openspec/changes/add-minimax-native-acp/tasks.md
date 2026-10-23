# Tasks

## 1. 独立路由与当前自身来源

- [x] 1.1 增加 minimax CLI、精确别名、稳定 mcode 路径、可选 minimaxHome 及 Host/Gateway schema；补路由/路径/配置回归，验证不会命中 mimo、未知 Windows 入口拒绝，README 同步独立名称。
- [x] 1.2 实现单一数据根、prod 区域选择和子进程环境投影；合成测试覆盖显式配置、MINIMAX_DATA_DIR/MAVIS_DATA_DIR 优先级、cn/en、原生 preferences、唯一状态、歧义及未知 env/endpoint 拒绝；文档明确不自动选其他账号。

## 2. 原生认证与稳定身份

- [x] 2.1 实现有界私有 no-follow 的 state/credential/cache 读取、精确 namespace/records key 和 schema/资源契约校验；fixture 覆盖 scope=agent.default、Bearer、client/audience、generation/env/region、损坏/超限/链接/硬链接/并发替换，确保 PRIVATE_* 不进入错误或公开投影。
- [x] 2.2 实现稳定主体及当前 token 绑定 identity cache 验证，接入 AccountManager、账号终端与 readCliAccountBinding；测试 subject/accountId、缓存指纹精确匹配、缓存单独无效、过期/refreshing/退出/换号/换目录，主体缺失保留 configured 并拒绝绑定；同步账号限制文档。
- [x] 2.3 核对原生 provider list --json 的安全投影边界，默认 OAuth 行、遮罩密钥和状态错误不得成为认证证据；纯 synthetic 回归证明无凭据时不发布目录，不调用未实现的 ACP providers/list，不记录真实凭据。

## 3. 动态模型目录与元数据生命周期

- [x] 3.1 新增专用 MiniMax state 解析和零 prompt ACP catalog；测试 protocol1/minimax-code 身份、session/new 登录拒绝固定提示、精确 opaque model 值、grouped 选项、安全标签、模型设置后的 thinkingEffort 与无控件 default；不发送 prompt 或 MCP。
- [x] 3.2 目录前后重检当前绑定，限制输出/时限并确认进程退出；测试查询换号、取消、超时、半行/超限、RPC error、完整回执后异常退出、清理失败保护；文档注明 metadata 空会话边界和当前原生登录阻塞。

## 4. 专用 ACP 执行与权限门禁

- [x] 4.1 增加 minimax-acp-v1/native worker/bridge 和必要可选 ACP configure/update hook；合成测试确认 model→模型后 effort→进程 permissionMode=default 完整回执→default 会话模式→prompt 顺序，未确认/漂移/延迟 Plan 均拒绝，其他 CLI 默认路径保持不变。
- [x] 4.2 接入原 cwd 精确 session/load、历史抑制、真实正文/公开思考/工具事件、end_turn/取消/限额/缺失终态与 owned cancel/quiescence；模拟 native subprocess 覆盖加载身份错误、权限/FS/terminal/elicitation 拒绝、异常退出和清理失败，不使用真实 CLI。
- [x] 4.3 更新 Client 标识、共享会话能力与工具/附件/steer/fork/Plan 门禁，测试入口与实际执行两层拒绝；同步 README、usage-details、design 及 settings-ui-design 的必要增量，不覆盖既有追加内容。

## 5. 新 CLI 数据边界及 Cursor 邻接修正

- [x] 5.1 为 Cursor/MiniMax 增加 opt-in per-run 原始 native/RPC/stderr 抑制策略，不改变其他 CLI；端到端 synthetic PRIVATE_* fixture 检查 bridge stdout/stderr、native/raw、诊断及持久公开事件全部不泄漏，同时确认解析后的公开正文/工具仍可见。
- [x] 5.2 收紧 Cursor 元数据 ownStop 退出分类，只接受完整回执加本次真实预期 signal/native128+signal 证据；添加完整 schema 回执后 exit1/未知 signal 拒绝测试及有效受管终止测试，保留 typed cleanup error，不弱化稳定主体门禁。
- [x] 5.3 追加 Cursor 当前 status 缺稳定 userId 的实际验收边界：configured/no principal 为正确拒绝；之前 46 模型 metadata 不作为当前 dispatch 通过，保留原有记录并补充最新结论。

## 6. 隔离集成验收与交接

- [x] 6.1 更新构建资源清单，运行新增与邻接 AGY/Cursor/ACP/路径/账号/能力关联测试、pnpm typecheck 和本 change 严格 OpenSpec 校验；在 doc/tasks.md 逐项记录实际命令、数量及未通过项，不以格式校验代替行为验收。
- [x] 6.2 在新的 .cache/minimax-preview-* 构建隔离产物并检查必要 MiniMax runtime 及 schema 包含，保持 Cursor final preview、AGY tgz/rollback 不变；交接修改文件、产物、回归结果和回退边界，不安装、不提交/推送、不改版本。

## Workflow follow-up

- 已认证 MiniMax 原生模型目录、真实单轮/续聊/停止和 Windows 行为未验收；父会话需在当前自身账号满足、用户选型及明确执行授权后另行验证，不能通过换目录或猜测模型绕过。
- 本变更不执行安装、profile 修改、发布或归档；只在实现、安全测试和必要后续证据齐备后评估归档，任何剩余限制继续留在文档。
