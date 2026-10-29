# 1.2 Linux 严格快照实施记录

## Scope

本切片仅实现任务1.2，不实施MiniMax2.2、其他adapter、runtime、tools、Gateway、UI或真实导入；不覆盖第一切片1.1与其他CLI成果。当前 store 双revision、固定最终root、CAS/request去重和原子registry未改；前一阶段的时间戳ABA失败与严格拒绝历史保留在[早期记录](implementation-1.1-1.2.md)。本轮API/支持矩阵与安全合同见[严格快照说明](../../../doc/native-auth-snapshot.md)。

## Implementation

- [自有C](../../../src/host/native-auth-guard.c)只处理继承FD、元数据、独占open-description read leases和raw inotify；不读鉴权字节、不写Source、不执行来源代码、无后代进程。Node在全部guards armed后读bytes，再经CHECK确认读窗口；callback期间保持guard。read lease可能短暂阻塞Native写请求，非阻塞写者可能EWOULDBLOCK；break立即失败释放，不建source lockfile，不修改系统sysctl/权限或自动重试。
- [Host supervisor](../../../src/host/native-auth-kernel.ts)使用独立有界child_process协议，因为现有[ProcessBackend](../../../src/host/process.ts#L19-L23)需要Host注入且不提供此standalone多FD契约。C独立reopen未leased FD，而不是dup Node的description；实际退出才证明lease释放。固定安全enum、nonce/seq/frames、EOF/abort/父死/deadline及cleanup-unconfirmed均封闭处理。
- [快照入口](../../../src/host/native-auth-snapshot.ts)callback第二参为closed guard（files/signal/seal/close）。目标verify末尾必须await幂等且sticky的seal，确认helper实际退出0之后才能return identity让store发布。若外层先拒绝而callback忽略Signal继续晚返回，seal仍拒绝；不声称helper退出等于callback-owned进程已清理。普通只读projection可自动seal，不能无seal地在callback内提前publish。
- SEAL线性化点是callback后的成功源路径复核、raw drain与持有leases的采样确认，不是跨目录registry事务；之后源变化不回写独立副本，也不承诺独立grant。祖先只核owner/mode/devino/路径并监听相关子名；无关target sibling改变祖先mtime/size/nlink不自失败。Credential始终nlink1/0600/owner/regular/有界；targets仍0700/0600。
- [构建器](../../../scripts/build-native-auth-guard.mjs)仅构建期调用固定cc；[正式构建](../../../scripts/build.mjs)在typecheck-only提前退出之后才调用，[preview](../../../scripts/build-preview.mjs)带入新脚本和C源。包内source+manifest+binary有SHA/ELF/ABI核验，执行pinned FD；只接受固定本包bundle/type输出布局，不向邻包fallback。代码资产允许已验证pnpm hardlinks，凭据不允许。Helper明确700；完整父侧package gate须保留xbit。
- Linux x64/glibc与已知local-FS能力先证；未知FS、网络/FUSE、Windows/macOS/其他arch、资产/ABI/执行不符都UNSUPPORTED。没有Python或第三方runtime、用户运行时编译、全局env修改或模型OS沙箱。本轮只实测本机FS，不冒称白名单每一FS均实机通过。

## Actual red → green evidence

1. 新测试导入尚不存在的builder：1 suite failed，0行为测试执行，不冒称内核反例红。
2. C helper真实Werror编译成功，但生产wrapper仍严格拒绝时：**8测试中6FAIL/2PASS**；随后接入真实guard，初始8PASS，扩展33PASS。
3. 父只读复审指出duplicate inotify wd first-match漏后续filter。实际生产helper负例先**1FAIL/33筛选跳过**，错误返回MUST_NOT_PUBLISH；改为同wd所有filters并集后通过，未删反例/加sleep。
4. 补充显式seal编排、晚verify sticky、真实store0publish、hardlinked assets/tamper、固定单包资产、CHECK读窗、bounded协议数值、direct-cache sibling等后，kernel **43PASS**。
5. narrow build/ABI **8PASS**：C/source/binary SHA、重复build不覆盖、真实emit type/bundle-entry两布局smoke、坏primary/有效邻包绝不fallback、helper-only tar/extraction保留700且可执行、unsupported manifest、typecheck-only不编译合同及实际ASan/UBSan helper。
6. 既有store21、snapshot/observation20、files17全部重验，合计**5文件109PASS，0FAIL/0SKIP**。原地truncate阻塞/非阻塞A→B→A、original-inode/ancestor ABA、existing write FD、关闭FD后MAP_SHARED/mprotect、真实raw overflow、父死/EOF/未知帧/超时/取消/私密marker都在真实Linux synthetic中执行；不存在生产fakeProof或测试开关放行。
7. scoped strict源/测试类型与Host/Client noEmit按`&&`重验；初次完整scoped类型发现两处fixture nullable stdin type-query，已改为NonNullable后重验。未用失败后分号退出0冒通过。OpenSpec strict及范围内whitespace/输入hash另行核对。

最终测试报告位于忽略的[repo-local证据目录](../../../.cache/auth-profile-kernel-evidence-20261025/README.md)。所有persistent fixtures均为repo `.cache/auth-profile-*` synthetic，保留未删除。早期cc调用未显式TMPDIR，其瞬时scratch位置未审计；最终compiler children已固定私有cache TMPDIR及最小env，不能回溯宣称从未产生系统临时编译文件。

## Round12 后续：stdin fallback 与真实CHANGED帧的诊断次序

全失败case修复候选的47文件冻结验证曾出现**1680PASS/1FAIL/1既有SKIP**，唯一为ancestor-ABA拒绝返回VALIDATION_FAILED而非SOURCE_CHANGED；始终拒绝，不是泄漏快照或错误发布成功。随后使用实际pinned helper和真实祖先ABA，在其真正nonce-valid ERROR CHANGED chunk进入正常stdout listener前，确定性注入stdin EPIPE，一条新红例复现generic fallback先占firstError、吞掉具体源变化证明；不靠放宽期望或重跑碰绿。

后续修正仅在Node supervisor区分transport/helper/protocol/explicit/cleanup私有origin并保留固定wakeup错误身份；有效来源CHANGED/OVERFLOW可细化临时传输推断，取消/协议/stderr/timeout等definitive第一错误不被取代。终态后坏尾/重复frame/SEALED后ERROR使helper协议poison，不能冒source proof。仍即时abort/kill、按原有界范围等实际close，cleanup-unconfirmed保持优先；finally只最终裁定已选中的transport/helper推断，不盖callback自身错误。不改C/ABI、不加sleep/retry、不从EPIPE/未知CHECK I/O/旧帧猜source变化、不扩大导入授权。

独审再指出同步callback排入EPIPE微任务后抛BUSY/SOURCE_CHANGED的内层catch窗口；父2真红后按wakeup/current error身份区分修复，原explicit/protocol/cleanup优先及失败latch不变。新增协议/取消先发生、transport→protocol→CHANGED、partial/wrong nonce/坏尾/重复终态、EPIPE-only、cleanup unconfirmed和callback负向合同。最终kernel59项纳入[47文件1697PASS/0FAIL/1既有SKIP](../../../.cache/worker-history-parent-20261025-r7.json)，types及5change strict/diff通过，810输入冻结；隔离包、备份更新和真实GUI已另有[父实施记录](../../../doc/tasks.md)，不等于任何供应商真实导入。激活后的并发peer追加导致零delta严格检查未过、其旧8176行前缀和其他852原文件完整的限制，也在该记录明示，不声称整个激活区间排他空闲。

## Not performed（本1.2切片当时的范围）

未读取真实auth/config/history，未发HTTP/Native CLI/model任务，未全仓测试/完整应用构建/正式pack/install/deploy，未Git stage/commit/push、改版本/package/SDK/Core/AGENTS，未触碰父candidate/install guards或冻结Cursor证据。helper-only tar和小范围TypeScript emit不是完整应用构建/安装。其余15项保持待办；2.2的nativeNamespace、可选loginEpoch与保护配置合同由父另行续接，不因通用文件guard而当作供应商导入完成。
