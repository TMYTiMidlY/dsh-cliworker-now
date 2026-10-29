# Proposal

## Why

目前只有 AGY 的 default/lxy 具备明确的子进程账号路由，MiniMax 和 Codex 的多个原生账号尚无统一的独立导入、持久保存及 Agent 选择合同。用户已确认本轮先打通多份原生鉴权；没有 dsh-provider-hub 也允许多份保存，Hub 导入与额度查询留待后续。

## What Changes

- 新增 Host 私有、按 CLI 隔离的原生鉴权 profiles：白名单导入鉴权及必要路由/保护配置，存为独立版本，不复制原生历史、缓存、锁、MCP 或可执行 hooks，不改写来源目录。首批实现 AGY 文件来源、MiniMax 标准 prod 文件来源、Codex file auth 来源；其他 CLI 保持原生默认账号，不假称已支持导入。
- Agent 可列出安全描述、导入/停用 profile，在目录查询、新 Worker 和未来新任务设定中显式指定 `auth_profile`。查询、账号绑定、排队准入、执行和原生终端必须使用同一份解析上下文，不修改父进程环境。
- 已有 Worker/native conversation 固定 profile/版本；续聊、换模型和 fork 不支持顺便换账号。没有有效来源时拒绝，不回退默认、其他 profile 或其他 CLI，也不基于额度自动重发。
- 来源使用已确证的原生目录或内置来源描述；agy-lxy、mcode-agony、codex-ljy 这类名称可作为显示标签，不作为执行器或任意 shell 解析入口。缺少实际来源路径时明确缺参，不根据名字猜目录。
- 设置页复用现有“账号与登录”结构，提供原生默认/导入项的清楚区分、导入反馈和可用性。只展示 ID、标签、CLI、版本及安全状态；不展示凭据、原始配置、私有路径或 token 指纹。
- AGY 首版导入新增独立的 `oauth-credential` 凭据固定模式，不冒充 `native-principal` 或 API key 身份。有已证合法 refresh-token 时固定 R0，R0 不变且其他原生检查通过才允许正常 access-token/expiry 更新；R0 改变、丢失或模式变化不得覆盖原 profile/Worker，需明确新 profile 和新 Worker。只有来源本来是已证 access-only 格式才在独立域固定 A0，不删除 refresh 字段制造此模式。首次目标原生核验也可能因轮换而导入失败。
- 明确 OAuth 边界：pin 相同不证明当前 access-token 的远端主体、A/R 同属一个 grant 或当前授权有效；文件快照、邮箱及目录成功不能补出这项证明，仍须独立核原生材料/路由/保护和能力。本地独立保存不等于独立服务端 grant、不同账号或额外额度；原生刷新只写该 profile，轮换失败不重设 pin、不恢复旧 token、不回借来源。即使导入失败也可能影响远端 grant，不能保证复制的 refresh-token family 互不影响；插件只能对可证同身份或同 pin 域串行，不承诺控制外部刷新。
- 本轮不接 Hub、不新增额度数字或余额工具；接口与文档保留将来的可选来源扩展，不依赖 Hub 才能启动基本账号功能。

## Capabilities

### New Capabilities

- `native-auth-profiles`：原生鉴权白名单导入、私有版本存储、显式选择、固定执行上下文、可用性及管理生命周期。

### Modified Capabilities

- `cli-account-isolation`：将用户明确授权并登记的同 CLI 独立导入来源纳入自身账号，区分这种来源与旧 Worker 缓存/未授权派生快照；保留跨 CLI 禁借和退出重检。
- `worker-dispatch`：增加 profile 参数及完整设定的 profile 作用域，已有 Worker 不接受覆盖，继续参数化选型而不生成问题卡。

## Impact

- Host：新增私有 registry/import adapters；贯通 [AGY 路由](../../../src/host/agy-account.ts)、[MiniMax 来源](../../../src/host/minimax-accounts.ts)、[Codex 绑定](../../../src/host/cli-account-binding.ts)与[目录子进程](../../../src/host/codex-models.ts)、[运行时](../../../src/host/runtime.ts)、[偏好存储](../../../src/host/storage.ts)、[工具/Gateway](../../../src/host/index.ts)。Codex 当前直接读父 `CODEX_HOME` 且元数据 spawn 不传显式环境，不能仅补模型进程环境。
- Client：账号页及新派遣来源选择遵循[设置页规范](../../../doc/settings-ui-design.md)；原生会话只展示其固定来源，不增加静默换号按钮。
- 存储：新增私有目录/版本，POSIX 目录0700、文件0600；OAuth 增量需可辨别 kind/mode/策略版本和路由域的私有身份格式及冷恢复，不从旧摘要猜身份、不迁移旧 default/lxy。缺失设置及已证 lxy settings-only 链接须有独立元数据守卫，不能用现有 regular-file 快照冒完成。Windows 不以 mode 假装 ACL 已验证，缺乏已证私有存储/原生文件来源时拒绝导入。
- 协议与安装：工具参数为加法，CLI 每次仍必填；保留 `agy_account` legacy default/lxy，双选择冲突拒绝。包名及0.8.2不变，无 Hub 依赖、不改 DSH 核心或原生 CLI。
- 证据现状：[现有隔离规格](../../specs/cli-account-isolation/spec.md)、[已实施的参数化增量](../parameterize-worker-dispatch/specs/worker-dispatch/spec.md)是基线。只读已确认本机 AGY lxy 和 MiniMax agony 候选目录存在；未验证 wrapper 映射、未读取这些鉴权内容、未真实导入，Codex ljy 的实际根尚未知。本提案不是功能或平台验收完成声明。2026-10-26 用户已确认上述凭据固定方案并要求直接按既有目标实施；本次先有规划增量，随后仅实现 metadata 通用守卫基础并独立合成验证；store 新 kind/格式随后已有独立存储切片及合成验证；供应商授权/投影 adapter 及真实导入仍未完成，旧基础测试或该守卫通过不是这些剩余能力的验证。
