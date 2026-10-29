# 原生鉴权：Linux 严格文件快照基础

本页说明 `add-native-auth-profiles` 的 **1.2** 及任务 **2.1 的受限元数据守卫基础切片**。它不是 AGY/MiniMax/Codex 导入功能，也不是 Agent 任意文件读取工具。供应商白名单、配置保护等价性、原生 schema/身份和授权仍由后续可信 adapter 实现；**2.1–2.3 的供应商 adapter、runtime/UI/tools 均未接入，2.1 未完成**。1.1 的私有 registry、双 revision、最终材料根、request ID/CAS 合同不变；新增 OAuth kind/私有身份格式已有[独立store切片](native-auth-store.md)及合成验证，供应商adapter仍未完成；不能用文件守卫或存储测试冒称真实凭据/远端账号验证。

## 支持与拒绝矩阵

| 条件 | 行为 |
| --- | --- |
| Linux x64、glibc 不低于构建 manifest、完整本包 helper | 执行真实内核 guard；仍须每次成功取得 read lease/watch |
| ext4、XFS、Btrfs、tmpfs、overlay 的已知 Linux magic | 可尝试；任何 lease/watch/权限能力不满足仍拒绝；本轮只实测当前本机文件系统，不冒称逐种实机验收 |
| NFS/CIFS/FUSE、procfs、未知 magic | `AUTH_UNSUPPORTED`，不回退 fs.watch、时间戳或另一个 helper |
| Windows/macOS/非 x64/非已证 libc、资产缺失、坏 hash/ELF/ABI、不可执行 | `AUTH_UNSUPPORTED`；不以 mode 冒充 ACL，不在运行时编译 |
| 已有写 FD、已有可写 MAP_SHARED 映射或可升级的共享映射妨碍 lease | `AUTH_BUSY` / 拒绝，不读出凭据，不要求用户删除配置 |

实际平台/文件系统/编译器与测试结果保留在本切片 repo-local synthetic 证据中。Linux 是必要条件，不是对所有文件系统的安全保证。特权 mount-over、内核故障、ptrace/任意同 UID 内存或代码篡改者不在此机制的抵抗声明内；它不是附加给模型的操作系统沙箱。

## 实现与来源

- [自有 C companion](../src/host/native-auth-guard.c)：仅元数据、read lease、raw inotify 和固定协议；不读取 credential bytes、不写源文件、不 fork/执行子进程或供应商代码。
- [受管 Host supervisor](../src/host/native-auth-kernel.ts)：私有 IPC、已验证 FD 传递、bounded callback/abort、实际退出确认。
- [快照入口](../src/host/native-auth-snapshot.ts)：`withNativeAuthSnapshot`；旧 `observeNativeAuthFiles` 仍只返回 `verified:false`，永不作为授权。
- [构建器](../scripts/build-native-auth-guard.mjs)：仅构建期 `/usr/bin/cc`，Werror/PIE/stack protector/RELRO/NOW/noexecstack；运行时无编译器、Python或第三方运行库依赖。动态系统 glibc 依赖如实保留。

包内资产包括 C 源、协议/架构/libc/source SHA/binary SHA manifest 和对应 binary。运行时只接受已核的 `lib/index.js` 或 `lib/types/host/native-auth-kernel.js` 布局所指向的**单一本包资产目录**；坏 primary 不探测邻包或 typed-local 替代物。完整 hash、owner/不可外写权限、ELF 与 ABI 验证后，通过继承的 pinned executable FD 执行，不把 source path 放 argv。

代码资产允许 pnpm content-addressed store 的 hardlink（经上述验证）；**凭据仍强制 nlink=1**。构建 helper 为0700，C源和manifest为0600。后续打包/安装 gate 必须保留 helper owner-execute，不能把所有产物一律 chmod0600。本轮仅验证 helper-only tar/extraction 与 pnpm-like hardlink，不代替父侧完整包/正式安装验收。

## 读取与 SEAL 合同

1. Node 对全部必要文件与祖先做 no-follow、owner、regular、nlink、权限、大小和路径绑定检查，保留所有 FD。源文件0600；祖先为 root/current UID、不可 group/other 写；源叶目录为 current UID。没有递归目录复制或整个 HOME/history/cache 扫描。
2. C 在所有 guards armed 后才发 `READY 0`。它从继承的**未 leased** 文件 FD 经 procfd 独立 open 得到自己的 open-file-description，再设置 `F_SETLEASE/F_RDLCK`。不是 `dup`，不是 advisory `F_SETLK`；Node 不保留 leased description。C死亡会释放全部 lease。
3. Signal 在获取 lease 前配置。raw inotify 非阻塞读到 EAGAIN，明确处理 overflow、ignored/unmount、未知事件和相关 move/create/delete/modify/attrib。重复 inode 的 watch descriptor 合并全部 child filters；不等待 rename cookie 配对，不因队列丢失重建后继续成功。`F_GETLEASE` 若已是 break 目标 UNLCK，立即失败，不等异步 signal，不重新抢 lease 掩盖 break。
4. Node 在 READY 后读取所有有界 bytes，前后复核，再请求 `CHECK 1`。只有真实 helper 的 `CHECKED 1` 才借出 bytes 给 callback：读窗口中已丢失的 guard 不能继续授权 callback。C不接收任何凭据字节。
5. Callback 期间持续守卫。目标 staging 写入不应因无关 sibling 改变祖先 mtime/size/nlink而自失败：严格后端检查祖先 owner/mode/dev/ino/路径绑定，配合**相关子名** raw 事件。源必需路径的变化、权限/身份变化仍 sticky 拒绝；旧 unverified observation 的保守行为不变。
6. `seal()` 在目标核验结束后做 Node 源路径/文件复核，再请求 `SEAL 2`。`SEALED 2` 及真实 helper 退出0全部确认后才成功。该点是成功 drain 且仍持 leases 的采样线性化点，**不是与另一 root 的 registry rename 构成的跨目录原子事务**。随后原来源变化不回写副本，也不代表独立服务端 grant。

read lease 会暂时协调原生写者：阻塞型 open/truncate 可能短暂停等，O_NONBLOCK 写者可能收到 EWOULDBLOCK。任一 break 立即中止导入并退出释放，不等待系统默认 lease-break 超时；不创建 source lockfile、不 chmod/修复/回写来源。读取可能由系统更新 atime，不能据此宣称所有源 metadata 零变化；源码不写源字节/mtime/ctime。

## 受限元数据依赖（2.1 基础切片）

严格输入增加私有 `metadata` 选择，必须由可信 adapter 指定，不向 Agent/Gateway 开放任意路径：

```ts
metadata: [
  { kind: 'absent', path: 'settings.json' },
  // Alternative selection, not simultaneous with the absent entry:
  // { kind: 'symlink', path: 'alias/settings.json', target: 'canonical/settings.json' }
]
```

- `path` 与 `target` 均相对同一个已核 `root`；`target` 是已选择的 regular 内容文件路径，不是任意 readlink 文本。所有内容文件和元数据叶项合计最多16，统一拒绝重复/前缀冲突；至少一个内容文件。目标必须同 guard 经 no-follow/owner/0600/nlink1/read lease 检查，不能靠 link 自动选择一个未授权文件。
- `absent` 只认已打开安全现存 parent FD 下叶项的 ENOENT。缺父目录、EACCES、ENOTDIR、悬空链接或已存在目录都不是空配置。不创建源占位文件或 lock。
- `symlink` 只观察自身元数据，要求当前 UID、nlink1、有界长度；只接受精确绝对目标或 `relative(linkParent, selectedTarget)` 的唯一规范拼写，并按原始字节比较（含后续复核），不能用有损 UTF-8 解码把非法字节混同合法 U+FFFD；不禁合法 Unicode 根，也不放任 `./`、多跳或其他等价解析。其0777不放宽 regular0600。是否为已授权 lxy settings-only 别名仍由尚未实现的供应商 adapter 决定，不能将此通用守卫当成 credential-link 导入许可。
- Node 在 spawn/首个 await 前复制选择，保持元数据的 FD-relative 原始期望；READY、读窗和 SEAL 时复核。元数据自己的 parent/ancestor/叶名加入同一 C raw watch 过滤并集，创建删除、原inode/同目标链接替换及 metadata-only 祖先 ABA 均 sticky 拒绝。没有新增 C/IPC/ABI 或基于 sleep 的观察证明。
- callback 的 bytes map **不含** absent/link 叶项；它只包含显式 regular 文件。输出配置是否为独立 regular 文件、完整保护等价、HOME 及 OAuth 身份仍由 adapter/store 验证。
- `observeNativeAuthFiles` 尚未实现这种守卫，有非空 metadata 时明确 `AUTH_UNSUPPORTED`，不静默忽略。成功 `seal()` 后的源变化属于后续独立副本风险，不被追溯为跨目录 registry 事务。

## 正确编排 store：先 seal，后 publish

Callback 第二参数为 closed guard：`files`、`signal`、幂等且失败 sticky 的 `seal()`、`close()`。普通只读 projection/validation 可在 callback 返回时自动 seal；**prepare 中单独结束 snapshot，或 callback 内无 seal 直接 await 整个 store.import，均不是“目标验证后 seal 再发布”**。

正确的可信 Host 编排形状：

```ts
await withNativeAuthSnapshot(input, async (files, guard) => {
  return await store.import(request,
    async finalContext => projectOwnedMaterial(files, finalContext.nativeRoot),
    async finalContext => {
      const identity = await verifyActualTarget(finalContext, guard.signal)
      await guard.seal() // includes actual helper exit; MUST precede identity return
      return identity
    })
})
```

这只是调度形状，`projectOwnedMaterial` / `verifyActualTarget` 不是已实现 adapter，也不能替换为 always-true proof。原生来源的格式/路由/保护和实际身份仍需真实实现与验证。源变化即使先使外层 wrapper 失败，忽略取消并稍后返回的目标 verifier 也会在 sticky `seal()` 再次失败，不能发布 registry。

Callback-owned 网络/进程必须遵守 `guard.signal` 并在自己的 finally 等待其实际 cleanup。Supervisor 不等待任意恶意永久 JS promise，**C helper 退出不证明 callback 自己启动的进程已退出**。借用 bytes 始终在 wrapper 结束时清零；需保留的 projection 必须复制，投影 ownership 继续按 store 合同转移。取消或 callback 异常只给固定安全错误，不带 caller reason/cause、source path、token 或 raw stderr。

## 生命周期与边界

- C独占 leased OFDs、无后代、配置前父死 race 检查及 parent-death signal；EOF、超时、取消、错误和父死均退出释放。Node不用 shell/PATH 搜索，以最小 child env 排除 LD/NODE 注入，不改 `process.env`，并确认 owned helper 的实际 close。
- 默认 guard budget10秒，可信内部测试/调用可在1–30000ms内缩短/调整；C启动输入另有3秒边界。失败清理等待实际 helper close，超过1秒则 `AUTH_CLEANUP_UNCONFIRMED`，绝不报成功或伪造已退出。
- 内容文件与元数据叶项合计最多16（至少1个内容文件）、每内容文件1MiB、总4MiB、相对路径16段；最多256 ancestor descriptions、每个32 filters、单名255 bytes；input frame/累计输出/nonce/seq均有界。任何未知/过期/重复帧或 early exit 不产生有效结果。
- 包内 binary 缺失、noexec/ABI/库装载失败明确拒绝；不尝试旧包/邻包/另一个 CLI。没有主机重启、全局 sysctl、sudo、真实凭据/模型访问。

## 本轮证据与未验证项

### 2026-10-26 Round14 元数据基础切片

新增[元数据测试](../tests/native-auth-metadata.test.ts)使用真实自有helper及synthetic文件：初次 **26项中21FAIL/5PASS**，原因是旧接口不支持/未处理新增metadata选择；不能据此称原有调用已经发生生产泄漏。实现有界选择复制、absent/alias元数据和raw相关名守卫后26项通过；原有基础连同新增组 **6文件151PASS/0FAIL/0SKIP**，scoped strict/noEmit及Host/Client noEmit通过。补充输入在spawn期间被修改、hardlinked alias/不安全parent与target、真实READY后ABA的最终结果在[实际日志](tasks.md)记录。此切片没有OAuth身份格式或AGY adapter，没有真实鉴权、vendor CLI/HTTP/model、UI、完整包或热安装；2.1仍未勾选。C源码/IPC/ABI和store未改。

### 1.2 原有基础证据

生产函数覆盖实际 in-place truncate A→B→A、原 inode rename-away/back、atomic replacement、祖先 ABA、symlink/hardlink/owner/mode/限额、MAP_SHARED（关闭 FD 后仍保留）、mprotect upgrade、真实 raw queue overflow、重复 wd filter、已有 write FD、父死/EOF/取消/未知帧/超时、晚 target verify sticky拒绝、真实 store seal-before-publish、sibling staging、包内单一来源、hardlinked code tamper、helper-only tar权限及 ASan/UBSan。

既有1.1注册材料、双 revision、冷恢复、原子 registry故障与 signed orphan不复活回归一并重验。没有真实 vendor auth/import/HTTP/CLI/model、UI、macOS/Windows、全仓回归、完整应用构建、正式 pack/install 或热部署；这些仍属于后续任务，不能拿本基础证明或当前0.8.2包代替。

OS 合同参考：[F_SETLEASE / F_GETLEASE](https://man7.org/linux/man-pages/man2/F_SETLEASE.2const.html)、[inotify](https://man7.org/linux/man-pages/man7/inotify.7.html)。
