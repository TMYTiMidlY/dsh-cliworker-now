# 原生鉴权：私有身份策略与版本存储

本页记录 `add-native-auth-profiles` 任务2.1的 **Host-private store切片**，不是用户可用的导入操作指南。供应商adapter、完整原生格式/保护验证、运行时/工具/UI和真实导入仍未接入；2.1保持未完成。不得把这些API直接作为Agent任意文件/凭据导入入口。

## 边界与入口

- [store](../src/host/native-auth-store.ts)提供最终材料根、私有签名registry/manifest、request ID去重、管理CAS、固定材料解析和失败关闭；不自行授权来源、读取源账号、执行Native或证明远端身份。
- [文件原语](../src/host/native-auth-files.ts)提供Linux procfd/no-follow/owner/私有权限及固定错误。实际安全导入还需要[严格快照及metadata守卫](native-auth-snapshot.md)、可信供应商白名单和真实目标验证；store可运作不代表某平台或CLI已可导入。
- 原有公开descriptor仍只有 `id, cli, label, materialRevision, recordRevision, enabled, state`。其中available/disabled描述已登记材料的管理状态，**不是fresh登录、Native能力或当前授权证明**。原回执重放也不代替resolve/准入重检。私有root、identityPolicy、身份摘要、secret及原始异常不返回公共DTO。
- `prepare(context)`只得到原四字段最终root上下文，此时新材料身份未知。严格解析其identity后，`verify(context)`及resolve得到不可变的私有identityPolicy。缺policy不能当legacy；只有显式legacy-v1才按旧合同验证。policy本身不含secret或身份摘要。

## 三种身份合同

| 身份 | 依据与限制 |
| --- | --- |
| native-principal | 仅由已证稳定Native身份合同的可信adapter提供；不是邮箱/未验证JWT/标签/路径推断 |
| api-credential | 缺稳定原生账号ID时固定API凭据；换key不因同provider/标签而成为同身份 |
| oauth-credential | 本轮新增的插件策略类型，当前仅定义AGY consumer/固定native路由域；不是Native token文件新增字段，也不是远端UID/grant ID |

OAuth私有policy明确 `kind=oauth-credential, policyVersion=1, cli=antigravity, authMethod=consumer, route=native` 及mode；这些是**插件自身策略版本/域**，不声称Native存在同名字段或schema版本。

- refresh-token模式固定精确R0；可信adapter仍须独立核原生格式/材料、保护与能力。R0不变时可接受合同内正常access/expiry更新，它们不进入固定pin。R0改变、消失、空/无效或模式改变不得重新pin或覆盖同ID。
- access-only模式仅供来源本来就是已证Native access-only格式的未来adapter；独立固定精确A0，A变化或新增refresh-backed模式不能沿用原绑定。此存储策略有合成实现，**不证明AGY实际支持某个access-only序列化格式**。
- secret不trim/casefold、不解JWT后替换；新HMAC使用固定tuple域：`[native-auth-oauth-credential, policyVersion, cli, authMethod, route, mode, exactSecret]`。同字符串的refresh/access/API不是同身份；相同OAuth策略/路由域、mode及pin在同store不同profile/root得到相同私有身份摘要，不以root或label拆开。
- R0相同不证明当前A主体或A/R配对、未撤销、独立grant或额外额度；Native models成功和物理文件一致性同样不能补出这些证明。不新增userinfo/额度接口，不强迫刷新或改字段制造支持。

## 持久化版本及旧格式兼容

1. **schema1原合同**：旧registry/manifest只有身份摘要，无法反推native/API kind。冷读先验原始payload的HMAC，再仅在内存补显式legacy-v1标记；open/list/resolve不因归一化改写registry/manifest，不重算旧摘要。resolve中的可信verifier仍可在自己的Native root正常刷新，不把整个操作描述为原生数据只读。
2. **legacy-v1不等于native-principal**：可信旧verifier明确返回native-principal或api-credential后，仍使用原两字段 `HMAC(JSON.stringify(parsedIdentity))`，字段顺序/算法不加CLI或新prefix；不试另一个kind，不将旧摘要解释为OAuth。
3. **纯legacy树保留schema1读写**：仅首次成功发布OAuth的原子registry事务升级为schema2，原材料根、schema1 manifest字节、摘要、revision及旧请求input/result保持。管理或失败导入不提前升级。
4. **schema2混合树**：每材料有明确identityPolicy；legacy-v1只配原schema1 manifest，OAuth只配schema2 manifest且policy/CLI逐字段一致。新native/API材料仍走明确legacy-v1/manifest1合同，不伪造其稳定身份类型。未知/缺kind、mode、policyVersion、route或单侧版本降级均拒绝；同record全部材料须同policy和身份摘要。
5. **同ID重新导入**：管理CAS匹配且固定policy/摘要一致才新建materialRevision及独立最终root；旧Worker不换根。不同身份kind、pin、mode或route域须新profile及明确新Worker，不用新材料版本搬旧conversation。
6. **原请求重放**：继续使用原import/manage参数解析顺序和私有sourceKey的input HMAC，不加入默认policy字段破坏旧回执。精确重放只回原提交receipt，不再次prepare/verify或接纳R1；后续实际选择仍验当前材料。
7. **回退边界**：旧程序不能把schema2当schema1使用；不自动降级或擦除新材料来回退。此前1.1/1.2历史证据保留，不冒本轮新格式或真实Native验收。

## 生命周期与异常

- 材料根在prepare之前已分配，Native验证不能改成另一个pending路径；原始身份摘要在目标验证前固定，verify返回后再次按同policy比较。不接纳“最新token”重设基线。
- 目标Native/保护验证和source seal-before-publish仍由可信adapter编排；仅返回identity的函数不是这种验证的证据。helper退出也不证明Native-owned进程已清理。
- callback异常只查询构造时的私有WeakMap或已有真实Process cleanup构造器品牌，再重构固定安全错误；清理未确认优先于同时取消。不会读取抛出对象可变code、原型、message/cause或Proxy getter来认cleanup。把BUSY.code改为cleanup不能制造品牌。
- prepare返回的有界own-data `files/bytes`在取消/identity拒绝前接管；此提前ownership阶段不执行accessor或自定义迭代器发现隐藏buffer，不将该局部保证泛化为后续全部schema读取。仅接收可用的真实Uint8Array视图；Proxy和已detached视图不是合法投影。零范围intrinsic验证不修改字节，真正empty视图在泛用字节层仍有效，不是空Native auth可用声明。
- 最终逐buffer使用intrinsic擦除，某个调用方违反ownership使view后来detached也不能覆盖主结果、跳过其他buffer或strand write lease；release置于finally。调用方不得共享/保留/转移已交付buffer，未返回或隐藏在accessor后的buffer仍由adapter负责；不能把违规转移的底层内存宣称已擦除。
- 写lease以exclusive mkdir跨实例/进程串行并跨callback持有；store本身没有deadline，也不会主动打断挂起callback，操作时限由可信adapter及owned资源编排负责。正常只rename为私有released marker，崩溃不自动stale takeover/清理。这**不是**后续跨profile/root、readonly Native操作和任务所需的刷新组互斥实现。

## Round15验证及未完成项

[新增合成测试](../tests/native-auth-oauth-store.test.ts)独立构造旧schema1 native/API材料及原import/manage回执，不由新writer自证兼容。测试明确使用模拟Native字段和回执，不是AGY真实token schema或进程闭环。

- 初次31项：24FAIL/7PASS（新kind/上下文/格式尚未实现）；实现后连同旧21项52PASS。
- cleanup/ownership反例先6FAIL/2PASS/31筛选SKIP：4个真实构造器品牌的合成取消并发异常被错误归CANCELLED，2个已移交投影未擦除。修后39+旧21=60PASS；另补可变code/未知Proxy/own-data与intrinsic、独立旧manage回执、单侧schema降级、OAuth异步disable/head等边界。
- detached反例先3FAIL/48筛选SKIP，确见raw错误、遗留write-lease和后续buffer未擦；修复后新增可用empty/byte Proxy边界，当前53项。
- 关联7文件211PASS、scoped/Host/Client noEmit及strict/diff结果见[实际日志](tasks.md)。中途scope命令误用ES2022，遇到已有shared.types.findLast需要ES2023而退出2，Host/Client因`&&`未执行；未改业务findLast，改用项目实际ES2023/lib后重验。旧失败报告保留，不反写通过。

仍未完成：AGY完整原生token格式/读取优先级/刷新保存与必要保护投影、已装artifact版本合同、lxy专属授权、目标Native真实验证、刷新组、runtime/tools/UI、实际导入与部署。**2.1和真实6.2均未勾选**；包名/0.8.2不变，本切片未热装、未读真实凭据或执行模型。

## AGY原生证据的当前边界

- Round15–16（10/26–27）独审定位的旧本机program是stripped ELF，采样SHA256为 `40349135371a8ed1f1af1e9f8b741de99174ae9fce6380b96c2d1f543480af7a`；10/29复核已被10/28更新的`1c9102d0…`取代，旧采样不能作当前版本依据。它是程序artifact哈希，不是账号指纹或已识别语义版本。静态Go build-info尝试未取得标准module framing，结果unknown；没有执行程序或从strings猜auth字段。
- 父实际读取的[官方settings schema](https://antigravity.google/schemas/v1/settings.json)为HTTP200、当前live v1 JSON Schema：全部key可选、缺省用default、Native保留未知key；它**不是完整OAuth token schema，也尚未与本机ELF版本绑定**。unknown-key保留不授权importer删除未知保护。permissions的deny优先于ask/allow，agentMode/allowNonWorkspaceAccess/toolPermission等须按原生合同和实际argv共同核验。
- [官方hooks文档](https://www.antigravity.google/docs/hooks.md)明确CLI还读取global、workspace及plugin hooks，settings内hooks不加载。只检查settings没有hooks字段不能证明无外部保护或执行依赖；本轮没执行任何文档示例。
- 独审给出的[官方1.4.7发行归档](https://github.com/google-antigravity/antigravity-cli/releases/download/1.4.7/agy_cli_linux_x64.tar.gz)及其压缩包SHA不是裸ELF SHA，本轮未下载/解包映射，不能直接比或据差异判断安装版。公开配置合同已经找到，完整Native支持证明仍待补齐；拒绝应明确未支持格式/保护/来源，不能叫用户清配置重登或误称无额度。
