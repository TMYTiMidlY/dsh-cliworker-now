# 1.1 / 1.2 独立基础切片实施记录

本页保留第一切片的实际历史与58项证据；后续Linux严格后端的当前合同和证据见[1.2独立记录](implementation-1.2-linux.md)，不要将下文“未完成”当作后续状态。

## 第一切片的范围与当时状态

本记录只属于本 change 的私有 store / 文件基础切片，不汇总其他 CLI 修复。没有接入 shared DTO、runtime、工具、Gateway、UI、任何供应商 adapter、Hub 或额度；没有读取真实鉴权、启动原生 CLI、构建、安装或发布。Linux `/proc/self/fd` 锚定语义之外的平台明确拒绝，macOS 未实现；Windows 没有 ACL 证明，不能用 mode 代替。

1.1 已实现并完成本切片合成验证。1.2 尚未满足严格 ABA 证明，按明确确认的安全边界保持未勾选；其余15项也未动，合计1/17完成、16项待办。不能将下述局部通过描述为真实安全导入功能可用。

## 私有 schema 与 API 合同（1.1）

实现位于 [store](../../../src/host/native-auth-store.ts)、[私有文件原语](../../../src/host/native-auth-files.ts)，测试使用 [store 测试](../../../tests/native-auth-store.test.ts)、[文件测试](../../../tests/native-auth-files.test.ts) 与明确标注 synthetic 的 [独立进程探针](../../../tests/fixtures/native-auth-store-child.ts)。它们不是 model-facing 任意文件导入 API，也没有注册到插件入口。

- `NativeAuthStore.initialize(absoluteRoot)` 只创建全新 owned 私有根；`open(absoluteRoot)` 只冷读已发布 schema。已存在、部分初始化、丢失或损坏的 key/registry/manifest 均拒绝，不修复、不扫描材料、不回默认。
- `list()` / `import()` / `manage()` 的公开 descriptor **仅**含 `id, cli, label, materialRevision, recordRevision, enabled, state`。ID/材料版本为随机 opaque 标识；descriptor 不带原生根、principal、token、原始配置、hash 或 cause。
- `import(input, prepare, verify)` 是可信 Host API：先取得跨实例/进程的文件系统 write lease；分配**最终且不再 rename 的**材料路径，再调用可信 `prepare(context)` 生成最小投影字节和可信身份，写入私有文件，再在同一最终根调用 `verify(context)` 核验身份，最后只原子发布 registry/head。MiniMax 后续可据最终根重键，不能先验证 pending 路径后改名。
- `prepare` / `verify` 的来源授权、供应商白名单、schema、route、保护策略、native identity、generation/epoch 和目标原生核验由将来的可信 adapter 负责。本切片没有伪造这些能力；不是只传标签/路径就能导入真实账号。
- `resolve(id, cli, verify)` 选 head；`resolvePinned(id, cli, materialRevision, verify)` 只选明确登记的旧材料。返回的 `NativeAuthContext.nativeRoot` 是 **Host-private**，不得转发公共 DTO。每次必须提供可信身份 verifier；异步返回后重检停用、head 与注册材料。
- 每次成功导入新建 materialRevision/最终 nativeRoot；recordRevision 单独用于管理 CAS。改名只增加 recordRevision，不使旧材料过期；同身份重入推进 head，不覆盖旧 nativeRoot；停用阻止新的 resolve / resolvePinned，但不删除材料、历史或控制既有进程的资源。
- principal 只以私有随机 key 的 HMAC 绑定；API 缺稳定原生 principal 时，绑定的是受保护 credential identity，不是远程账号 ID。API key 变化不能以 provider/标签/目录相同覆盖旧 ID。
- 私有布局：`key.bin`、签名 `registry.json`、`materials/<materialRevision>/manifest.json` 与固定 `native/`。registry/manifest 使用严格 schema 与 HMAC；manifest 绑定 profile/CLI/materialRevision/principal 和 nativeRoot 的设备/inode，**不对可正常更新的 auth/token 字节做永久 checksum**。原生续期可更新该材料的 token，但 verifier 返回另一 principal 时拒绝。
- import/manage 使用 request ID 记录同一原子 registry 事务的准确回执，并绑定操作、CAS、CLI/label 及私有 sourceKey。重放不再次运行 adapter；同 request ID 的不同输入冲突；后续 adapter 必须给自己的 sourceKey。失败请求没有成功回执，可按相同请求重试；未提交材料从不自动恢复。
- POSIX 目标目录0700/文件0600。写 lease 以 exclusive mkdir 跨 store 实例和独立进程串行，跨异步 prepare/verify 保持；其他写者收到安全 BUSY。正常释放只将经过 FD/path 核验的 lease 改名为私有 released marker，不永久删除。崩溃 lease 保留、后续写 BUSY，**不自动 stale takeover**。冷读仍只看已提交记录，不因为 BUSY 回默认。保留的 released/失败材料需未来显式维护，不自行清理。
- 安全硬上限：128 profiles、每 profile 512 材料、2048 请求回执、registry 4MiB；满额拒绝而非静默丢失去重信息。每次投影最多16文件、每文件1MiB、合计4MiB、相对路径最多16段。容量错误不覆盖旧 head。

## 文件观察与 1.2 的未完成边界

[文件观察实现](../../../src/host/native-auth-snapshot.ts) 的 `observeNativeAuthFiles` 先打开全部必需文件/祖先 FD，再读取有界字节，整个 schema callback 窗口内保持 FD；对 regular/uid/nlink/0600/大小、祖先 owner/不可外写、路径/inode/模式及 bigint mtime/ctime 做前后检查；不用 symlink/hardlink，不递归 HOME、不写来源；借用 buffers 退出时清零。该诊断/实验原语**只返回 `{ verified: false, value }`**，不是 publication-authorizing snapshot。要求文件集合由可信 adapter 提供，底层不能替代供应商多文件 epoch/schema 合同。

实际反例显示：本文件系统上快速 file A→B→A 可在同一时间戳粒度内完成，**只用 ctime/mtime + FD/path stamps 不足以严格拒绝所有 ABA**。随后加入的 Linux fs.watch/inotify 观察能捕获本次反例，但 Node 公开接口没有队列完全 drained 的证明，固定 setImmediate 也不能证明不存在滞后/overflow；watch error 会拒绝，但未知/丢失事件不能假称已检测。观察窗口可能保守拒绝同祖先无关变化，读取可能由系统更新 atime，未改来源字节/mtime/ctime。

因此严格入口 `withNativeAuthSnapshot` 在读取文件、借出 bytes 或调用 projection 之前，固定拒绝 `AUTH_UNSUPPORTED`（已取消为 `AUTH_CANCELLED`）。该入口绝不成功返回材料；通过 store.prepare 调用也保持 `AUTH_UNSUPPORTED`，不会执行目标 native verifier 或发布 registry。实验观察中的 event-loop turn 只用于收集可观察事件，**不作为 queue-drain 安全保证**。没有生产 always-true proof、类型 cast 授权、外部 Python/native helper 或新依赖。

后续可信 vendor adapter 必须独立实现并证明原生 coherent-generation/source-binding 与安全来源合同，再讨论可发布导入；callback 存在或返回 identity 本身不是这种证据。本切片的 store 只接受可信调用者已准备的字节并提供事务持久化，不声称它能够授权任意来源。任务1.2保持开放，不将任何供应商白名单/native validation伪装成已完成。

## 实际验证过程

1. 先写测试、模块尚不存在：`pnpm test tests/native-auth-store.test.ts tests/native-auth-snapshot.test.ts` → **2 suite failed、0 executed tests**，明确是 module-absent red，不称29项行为红。
2. 首次可执行安全回归：29项 **28PASS / 1FAIL**，失败是 fast file ABA 未拒绝。保持该反例，不通过延迟修改 fixture 来掩盖。
3. 加观察 guard 后：ABA 反例通过，但与另一测试文件并行在公共 `.cache` 祖先发生变化，组合快照 fail-closed，仍 **28PASS / 1FAIL**。单独文件19PASS；文件串行后局部基础 **3文件54PASS**，包括真实独立 Node 子进程竞争 lease。严格祖先观察可能保守拒绝无关同祖先目录变更，所以最终基础测试显式串行；这不改变产品拒绝行为。
4. scoped `tsc --ignoreConfig` 初次缺 `--types node`，随后发现3处返回路径与 fixture identity 类型问题；修正后独立模块/测试 strict noEmit 通过。Host/Client noEmit 随后通过（不执行 build 脚本，不写构建缓存）。严格拒绝入口补充后，TypeScript 另发现 callback never helper 的2处 definite-assignment 问题，改为明确 function 声明后重验；早先 Host失败/Client成功的分号串联退出0不算通过，最终验证使用 `&&`。
5. 严格 snapshot 零材料/零publish 拒绝和原子 registry 写故障后 signed orphan 不复活反例补齐后，3文件56PASS（store21、observation/strict入口20、files15）。父只读复审另发现 leaf目录owner布尔条件及非相邻lex排序prefix缺口：新增受控uid负例和`['a','a-x','a/b']`反例实际先为**2FAIL / 15筛选跳过**，再修正leaf必须current uid、祖先仅current/root以及set逐祖先碰撞检查。
6. 最终命令：`pnpm test tests/native-auth-store.test.ts tests/native-auth-snapshot.test.ts tests/native-auth-files.test.ts --no-file-parallelism --reporter=default --reporter=json --outputFile=.cache/auth-profile-evidence-20261025/tests-final-r3.json` → **3文件58PASS（21+20+17），0失败/跳过**。JSON 证据在 repo 内忽略的 [.cache/auth-profile-evidence-20261025](../../../.cache/auth-profile-evidence-20261025/README.md)；所有 persistent fixtures 仅 `.cache/auth-profile-*`，明确 synthetic，未清理或永久删除。
7. 最终检查使用 scoped strict/noEmit（显式 `--types node`）、Host/Client `tsc -p ... --composite false --incremental false --noEmit`、本 change OpenSpec strict 与范围内 diff whitespace 检查；不执行全仓回归、build/pack/install 或冻结 Cursor 候选。

以上只是合成/类型证据，不能证明真实 AGY/MiniMax/Codex 导入、原生账号、服务端 grant、模型执行、UI、macOS、Windows、包或热安装。剩余任务保持可见；不能把全组待办改写为已完成。
