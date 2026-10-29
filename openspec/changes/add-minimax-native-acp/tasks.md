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
  - 后续更正（不改写本阶段历史）：2026-10-22 已确认原生 user_id 为 protobuf int32 并修正解析，见 [数字身份更正](../../../doc/tasks.md#2026-10-22-cursor-原生-int32-身份修正与安装后核对)；2026-10-24 旧在线数字修复包已实际通过只读生成/同会话记忆/Read/停止及恢复，见当前 [控制面检查点](../../../doc/tasks.md#2026-10-24-agent-模型控制与逐轮结果检查点)。不能继续把“原生缺 userId”当最新事实。

## 6. 隔离集成验收与交接

- [x] 6.1 更新构建资源清单，运行新增与邻接 AGY/Cursor/ACP/路径/账号/能力关联测试、pnpm typecheck 和本 change 严格 OpenSpec 校验；在 doc/tasks.md 逐项记录实际命令、数量及未通过项，不以格式校验代替行为验收。
- [x] 6.2 在新的 .cache/minimax-preview-* 构建隔离产物并检查必要 MiniMax runtime 及 schema 包含，保持 Cursor final preview、AGY tgz/rollback 不变；交接修改文件、产物、回归结果和回退边界，不安装、不提交/推送、不改版本。

## 7. Stage 1：标准托管显式配置兼容（2026-10-24）

- [x] 7.1 将 blanket apiKey/baseURL 拒绝改为纯有效路由判别：显式 authMode 优先，原生三个精确 HTTPS managed origin（无 URL 用户凭据）与 token_plan/minimax/Anthropic npm 一致；接受原生 sk-xxx/缺省 key，但不新增 API/BYOK/其他原生能力。
- [x] 7.2 合成正反例覆盖三个 origin/标准路径、显隐 managed、placeholder 与缺省 key；placeholder 单独不能授权、显式 API/oauth/真实 key/HTTP/用户凭据/近似域/畸形/headers/model override 拒绝；保留 region/source/config ABA、稳定主体/有效期及错误 PRIVATE_* 边界。
- [x] 7.3 运行触及的纯路由、MiniMax 账号/元数据/绑定及必要邻接回归、Host 类型检查与严格本 change 校验，在 doc/tasks.md 记录实际命令/结果和未执行真实验收；保留 AGY dirty、全部配置/凭据/旧产物，不安装、不重启、不打包、不改版本或提交。

## 8. Stable Identity：绑定前受限自身 userinfo（2026-10-24）

- [x] 8.1 复核并实现固定 prod 区域 userinfo GET 合同，单次3秒可取消、redirect:error、64KiB及业务/字符串ID验证，只输出principal hash与固定失败分类，不泄漏原始身份/URL/query/header/body/error。
- [x] 8.2 拆分私有 OwnOAuthProof 与 ensureVerifiedIdentity，普通摘要保持纯本地；严格 native verifiedcache 或受限当前userinfo才提供主体，目录/正式binding共用，前后重核完整source/state/credential/stamp含ABA，内存cache/dedupe有界且不长存token。
- [x] 8.3 合成网络回归覆盖精确请求签名/query、成功形态/字符串ID、所有失败/超限/取消/隐私、认证前后变化/ABA、同UID续期/换UID、0模型spawn直到verified、摘要不发HTTP及缓存/重入/TTL；扩MiniMax与绑定邻接测试，保留max effort、Stage1路由和十二槽dirty。
- [x] 8.4 必要Host类型/本change严格校验及全新隔离preview含postgen Remote/Host/Client，通过才记录实际命令/数量/hash并交权；不做真实HTTP/CLI/模型/安装/重启/打包/版本/Git动作，真实验证留父会话。

## 9. ACP 目录最小安全诊断（2026-10-24）

- [x] 9.1 为现有query添加typed phase/reason、布尔合同检查、固定RPC/exit/signal白名单与有界row投影；不可变首错/独立cleanup，仅固定错误安全token，无Raw/Remote/持久化/行为放宽。
- [x] 9.2 合成覆盖各阶段、稀疏控件、timeout/cancel、帧/大小/退出/清理优先及PRIVATE/URL/cause/stack不泄露；跑MiniMax identity/native/route/binding/bridge最小组与必要Hosttypes，正常目录/max保持。
- [x] 9.3 严格校验、新隔离preview/Remote/postgen和源码字节/hash交接，记录真实目录根因仍未知；保留Host延期基线和旧dirty，不CLI/HTTP/模型/账号/live/Core/版本/Git/打包/安装，完成即正式release。

## 10. Select-model -32603 固定错误枚举（2026-10-24）

- [x] 10.1 仅select_model且数值-32603提取已核固定literal/直接结构化known字段，输出native_error/envelope_kind并冻结首错；未知或矛盾other，不输出原值、不凭泛code猜细类，其他行为保持。
- [x] 10.2 synthetic覆盖exact/近似/结构化/未知嵌套与PRIVATE不泄露、非目标phase/code不提取、timeout/cancel/cleanup首错；重跑原6文件最小组及Host noEmit/scopedstrict。
- [x] 10.3 新r2隔离preview/Remote/postgen/精确hash及日志交权，保留父会话新部署/GUI记录和Host延期；无真实探测/资料读取/服务/打包/安装/版本/Git写入，不宣称实际目录根因已修复。

## 11. 已验证配置子集与精确当前值 no-op（2026-10-24）

- [x] 11.1 严格pending作用域仅局部化exact param_reasoning拒绝，不污染首fatal；拒绝后原预算/单child干净session严格重核全广告集合，仅真实tuple/effort子集及现有notice，零项/其它错误仍全拒。
- [x] 11.2 专用catalog/configure精确当前model/effort no-op，仍验证广告、当前model effort、Ask及最终漂移；不同选择不跳，不改shared协议。
- [x] 11.3 补single rejection/fresh session/同model不同variant/all reject/zero/fatal/late drift/source/cleanup/cancel/预算及no-op/max回归，原342邻接组与必要bridge/types/scopedstrict；无真实执行，留Parent立即验收。
- [x] 11.4 全新functional隔离preview/Remote/postgen/精确hash和记录后release，保留Parent最新部署/官方对照/GUI与旧包，不pack/install/Git/版本或其它范围写入，不称实机闭环完成。

## 12. 元数据启动环境快照隔离（2026-10-24）

- [x] 12.1 向metadata backend仅传原账号环境的独立副本，添加会原地扩展env的synthetic后端反例，保持账号epoch/来源/ABA比较和全部子集门禁；必要关联回归、类型及独立预览后再正式实测，不把防护本身称为已证实根因。

## 13. 来源后验的固定差异分类（2026-10-24）

- [ ] 13.1 保持原sameSnapshot授权判据不变，仅以私有弱引用记录来源文件版本分量；后验失败返回固定类别区分未跟踪、主体、source字段、state/credential/cache版本及原生续期待处理，不输出值/路径/摘要/Native错误；覆盖合成正反例，隔离构建后正式读取实际失败类别再修根因。

## 14. 同内容原子配置保存的稳定绑定（2026-10-24）

- [x] 14.1 分离完整raw配置稳定fingerprint与私有source配置epoch；每root ledger≤64、同内容安全新inode继承、其它触碰/缺失/淘汰失效，proof/前后/clone保版本、原授权表达式保持，state/credential/cache不归一化。
- [x] 14.2 synthetic验证同内容atomic元数据/稳定binding、真实内容atomic变化/已观测route变化/in-place ABA拒绝、auth/state/cache严格、clone/缺失/淘汰/取消/子集/max；更新旧inode绑定断言但保留操作ABA。
- [x] 14.3 同390邻接组/Hosttypes/scopedstrict与全新atomic-save隔离preview/Remote/postgen/290源码hash；同步检测边界与Parent新事实，不实际CLI/HTTP/Native模块/真实资料/pack/install/Git写，收job后release给Parent立刻实测。

## Workflow follow-up

- 已认证 MiniMax 原生模型目录、真实单轮/续聊/停止和 Windows 行为未验收；父会话需在当前自身账号满足、用户选型及明确执行授权后另行验证，不能通过换目录或猜测模型绕过。
- 本变更不执行安装、profile 修改、发布或归档；只在实现、安全测试和必要后续证据齐备后评估归档，任何剩余限制继续留在文档。
