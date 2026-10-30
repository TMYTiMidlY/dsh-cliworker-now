# MiniMax 0.6.12 账号导入合同与证据边界

## 人工确认的产品范围

2026-10-30用户明确选择“只导入账号”：登录、必要连接及隐私/权限设置；不迁移业务智能体、业务提示、工作目录或历史。新的私有档案不是旧业务环境的完整克隆，不能宣称两者业务行为等价。

业务agents目录即使存在外链，也不因此取得读取或复制其目标的授权。account-only入口不访问该树；全局permission、plugin-hook以及必要连接/隐私设置仍须单独核对，未知或不能安全保留则拒绝。不搬MCP、hooks、锁、缓存、Native会话或数据库历史，不改原登录环境。目标使用Native Ask及宿主任务权限，不能把来源的全访问模式带成新的授权。

Hub未接入，不是原生账号导入的依赖；额度和远端授权独立性不在本切片的证明范围。

## 版本及静态证据来源

核对的是官方`@minimax-ai/code`0.6.12的安装程序，不用README最新版本代替已装程序。标准安装入口读取`current`，转到对应release的launcher，再执行该release的`cli.js`；package声明版本0.6.12、Node范围`>=22.19 <23 || >=24 <27`。尚须在实际profile运行入口完成程序版本/协议门禁，不把本次静态核对当将来每次执行的证明。

以下位置均为该固定版本包内文件和JS UTF16偏移，升级后不可机械沿用：

- `chunks/chunk-X3PES5WL.js`：主配置normalizer `Ka@238839–242300`；memory `Nd@187105`、permission `Zd@205927`、agents `ba@214155`、askUser `Sp@217800`、dataContribution `va@218016`、sandbox `Ia@224328`、subagent `Ma@227140`、CLI `R_@246507`、log retention `D_@247356`、contentReview `F_@247481`。
- `chunks/chunk-47KWM23C.js`：canonical agents解析约6974k–6986k；目录链接检查约6980k；安全目录创建约7002634；builtin生成约7145387；primary默认`mavis`约6967101。
- `chunks/chunk-5ADYFF2U.js`：process permission检查约2716k、规则合并约2717792；配置update allowlist约2941896；启动builtin恢复约3776405。
- `run-acp-command-MV4O4NBX.js`：标准ACP入口及session/new链；workspaceDir/mcpServers不等于选择一个名为Ask的agent。

Native会忽略一些未知配置键，并不是闭合严格schema；插件使用明确支持的更窄白名单，不能说这是Native自己拒绝的字段。

## 鉴权文件与最终root投影

- prod区域只支持`cn`和`en`；固定区域必须在UID请求、目录、启动及续聊中始终随私有root传递，不能再由Host环境或偏好换回另一区域。
- state schemaVersion2、file store、authenticated；credential envelope及record schemaVersion1、Bearer、`mcode-public`、`agent-backend`、包含`agent.default`。
- key为`com.minimax.mcode.oauth.prod.<region>\0`加base64url SHA256(`join(root,'auth') + '\0mcode-public'`)。必须直接投影到最终已分配root，不先验证临时root再搬家。
- 逐record校验格式，选择exact key；state与所选credential的generation、scopes多重集及可选expiry须相符。源导入要求A仍有至少60秒有效期。credential-only subject/accountId/loginEpoch保留存在性，不编造state epoch。
- Native刷新可能恢复或回滚原payload，generation不是普遍单调提交号。目标正常刷新必须按Native合同重新读取和验证，不能永远固定旧token checksum，也不能把目标刷新写回原来源。
- UID使用已有0.6.12 Native用户协议的新鲜realUserID证明；目录、email、token自称或旧缓存不能代替。这里只处理账号身份，不伪造独立远端账号、refresh family或额度。

## 账号-only设置投影

第一批仅支持已证的窄配置形状：标准managed OAuth路由、原生模型偏好、info日志、enabled布尔的dataContribution/memory、已证permissionMode及未关闭的hard safety guards。未知顶层/保护或未知隐私嵌套直接拒绝。

- source managed provider只用于校验，原生默认广告、model/variant/thinking/context偏好不搬进新档案。Variant/Thinking/ContextWindow旧值作为明确不迁移的偏好接受后丢弃，不宣称这些任意值符合Native子schema；例如Native生效thinking形状是effort对象，不是boolean。不能由标准origin推断任意自定义path可用；固定区域只认已证origin和`/mavis/api/v1/llm/v1`，连空query/fragment分隔符也拒绝，不带用户名或密码。
- 保留dataContribution同意与memory enabled；已有空config的memory默认true，与无config第一次初始化默认false不同。不能把两种情况合并成一个空映射。
- 目标固定Native `permissionMode: default`与两个hard guards未跳过；不继承来源bypass。全局permission/plugin-hook首批仅支持真实expected-absent，存在时不静默剥离。
- protected settings以独立account-only HMAC域和configDigest签入private policy；group仍按prod/region/principal导出，不能因root或privacy配置不同而拆开同一刷新组。
- 目标assert使用原始signed digest和严格目标schema，不能调用source normalizer把bypass、privacy或未知字段漂移“修正回”原期望再接受。

2026-10-30已在授权来源上做guarded **config-only**私有解析及投影/assert：supported。没有输出raw config、secret、地址、digest或业务原文；该调用未读auth.json，也未启动vendor CLI、模型或UID HTTP。这不是实际账号导入、刷新、目录或任务验收。

## agents与权限的区别

Ask是process permission mode，不是独立agent，也不替代agent中的tools/disallowedTools、MCP、skills、prompt及agent permission规则。Native会跟随agents目录链接；不能将“Native可读”当导入外部业务树的授权。

Native启动会生成`agents/.builtin/<name>/agent.md`，因此目标后验不能机械要求agents永远不存在，更不能删除正常生成树来通过测试。固定0.6.12标准assets的roster为mavis/explore/worker/verifier；fresh路径每个只生成一个regular agent.md。当前已实现能力/格式采样器，逐项比对features、tools、skills和窄x-mavis字段，拒外链/custom/permission和Native拒绝的纯空白description/effort/displayName；公开builtin叶可在已验证0700私有根中为0644，auth/config的0600要求未放宽。

目标verifier已有实现：先原signed配置与global absence长guard，短auth coherent采样完全seal/close后才允许Native更新；仅对未过期A做前UID，过期A只候选Native准备；低层ACP要求agentInfo.version精确0.6.12、实际join owned cleanup，随后fresh auth/UID与原principal组后验，最后再次采样builtin并seal原配置。固定assets override环境明确拒绝，不能看四目录名补来源。前/后采样不等于全异步窗口的strict agents子树或所有ABA证明，动态body也不是已获固定hash的prompt来源证明；仍需owned标准初始化链。已有真实C/私有store加synthetic ACP/HTTP反例，不是实际vendor Native或GUI验收。

## 生命周期、并发与已复现反例

- source严格guard须覆盖读取、目标工作及实际owned cleanup；verify最后await seal，含实际helper close，再允许store发布。
- kernel Promise.race不会自动join调用者工作。orchestrator保留整个inner promise，在源失败后仍join；目标真实cleanup未知优先于普通源变化或取消。
- per-principal刷新组用私有filesystem lease跨manager排他，持有至实际operation settle；未知cleanup持久隔离，冷启动不按PID、时间或mtime抢占。合成callback settle不是Native子进程已退出的证明，实际verifier/operation必须join自身owned范围。
- resolver两阶段交接：先在组内验证target，等store检查身份/HMAC、版本及enabled之后，才解除operation gate；同一组始终持有，未授权不能执行实际操作。旧Worker使用原materialRevision，不被新head收养。
- 独审提出并由父用确定反例复现：target真正cleanup witness被store finally释放EIO覆盖，组误释放；现在在direct target hook catch记录品牌，组callback退出前恢复cleanup优先级并持久隔离。
- 另一确定反例：实际SEAL之后原input.signal监听已移除，原调用者取消可能丢失；现在操作使用原signal与guard.signal的any组合，持续到最终发布检查。最初双microtask调度probe旧码通过，不作为该反例的失败证据；改为真实seal完成点注入取消后才两项真红。

- Facade实际登记work须先于同步资源创建：确定复现先perform再track时dispose拍下空pending、漏等仍在verify的work；现先登记deferred promise再microtask start。真实cleanup债务先latch再移pending，dispose不能把旧隔离债务说清净；取消后仍等actual callback settle，deadline不是清理的总墙钟硬上限。
- 每次target验证在private parent中新建UUID workspace，并在任何auth/UID/Native前核当前private且empty；仅有0700不证明空，不能复用混入项目规则的旧cwd。Native程序定位和fresh cwd创建惰性延后至真实target hook，精确已提交回执重放不依赖再找到程序；已提交receipt不因后来取消改标成未提交。
- builtin的纯空白字段和UID等待期间新增custom树均有确定反例；分别按Native非空白语义拒绝，并在postUID后再次采样完整树。这个修复仍不是continuous subtree ABA防护。

对应回归源码在项目tests中，可复现这些边界；原始合成报告和详细过程留本机，不把它们说成真实Native cleanup或远端refresh验收。

## 已接管理接口及验证现状

Host源码已注册三个独立Agent工具：`cliworker_auth_profiles`（只读登记描述，不核live auth/额度）、`cliworker_auth_import`（closed account-only请求、幂等receipt）、`cliworker_auth_manage`（label/enablement CAS）。Gateway对应`authProfiles/authImport/authManage`，共用相同Host执行器和权限门禁。只有main可查看；写须非plan且可写，输入不接受token、private policy、backend、执行器或业务agent迁移选项。返回只含七字段安全profile描述及固定scope/notice，不带source/root/identity/config摘要。不会切换旧Worker来源；Round22管理入口本身不代表彼时已接任务选择，Round23的新增接线及证据另见下节。

实际授权来源的后续strict-guarded auth+config **只读预检**证明格式coherent，但访问令牌剩余有效期不足source导入要求的60秒，未做UID HTTP、vendor CLI/模型、source内容写入或业务agents读取；没有因此放宽source门槛、强刷或改expiry。尚未建立真实target或可用导入回执。

Round22最后16个关联测试文件545PASS，Host/Client对SDK0.2.1-rc.2 typecheck及隔离preview构建通过。隔离包的npm pack dry-run核964个发布文件、无私人运行态文件名且native guard源码/二进制与manifest哈希一致；不是内容秘密全扫或实际部署。一次先扫整个preview的检查误把构建缓存中SDK sessions声明当运行态而exit1，已定位为不在发布清单中的代码；没有删除或隐藏它来过检查。

## Round23固定执行来源与收尾证据

- resolver把原signed configDigest注入Host-private运行配置；普通来源同一次raw read先严格核验再擦除，在缓存身份返回/UID及真正metadata spawn门口复核私有root/config/global保护。metadata只用fresh source.env；未传private字段的legacy分支不改。
- 私有request携带原root/region/digest/0.6.12期望，不携带环境秘密。Native bridge请求原本不写env，实际vendor进程继承环境，因此门禁必须核`process.env`和override合并后的真正四键，不能以config.env缺省豁免。load/new前固定版本，prompt前再核保护。新mjs模块支持严格JSON及Native YAML、本地有界FD no-follow/权限/全局absence；这是采样，不是长任务连续guard或完全ABA证明。
- 公开Worker preference仅opaque ID/materialRevision。ready/end执行scope从出队授权到Native/readers/steering/Harness及launch真实清理持续持刷新组，close/join后才finish/安全回队；停止不重新认证。queue admission/stop同样识别真实Auth/Process双cleanup品牌。post-policy及scope关闭后诊断EIO都有确定反例，所有异常仍join、真实CCU优先、已知清理不降unknown；已实际成功而保护后验不符保正文/退出/confirmed清理，标待核且拒后续，不冒零执行。
- models/start/configure_conversation源码接受MiniMax profile ID或明确native，ID只用于新选择取head一次；旧Worker模型入口按ID恢复其原固定pin，不能顺便覆盖账号/材料。完整设定按project/parent/profile/revision分域，current只指向明确完整源；同model不同effort/非空role不串域，profile不入legacy缓存或项目原生默认setter。显式未完成同域选型仍MODEL_REQUIRED，不弹问题卡、不借默认角色。
- 先红后绿包括私有设置4项、Native runner3项、Runtime4项、scope10项；独审点经父确定复现9项后修，另queued停止1项、after-close清理证据2项、legacy setter污染1项也先红后修。首次Tool models例误带fixture worker_id、一次Runtime mock collection缺导出分别明确是测试夹具问题，不冒业务失败证明。实际最后30文件915PASS/0FAIL/0SKIP、Host/Client types及全新隔离preview通过；实际pack dry-run973文件、缓存不出货/无私有运行态文件名，built bridge模块import及guard源码/二进制manifest哈希通过，不是内容秘密全扫。源代码与合成层，不是vendor/GUI/热部署，重叠报告不相加。

## Round24账号界面、完整来源组合与有限实况

- 既有MiniMax设置页新增独立profile登记/显式宿主目录区域导入/CAS改名和启停；原项目原生默认form不接profile，旧Worker仅只读显示固定档案编号。显式新任务来源编辑器只在打开时核该源目录，以原生NativeChoice/Input/Button选择完整model/effort并应用到当前parent，不新增业务任务composer，不复制history/业务agents或暗换已有会话。
- 三个新增便捷Gateway分别只读登记/current/可写性、fresh指定source目录和精确pin且不存设置、显式完整组合重验后只写parent current/domain；有界proof按parent/project/CLI/profile/revision，不复用legacy展示缓存。队列放行先核live Agent同实例及当前项目，再准许metadata；proof发布及最终同步CAS前仍核owner/cancel/权限/CLI/terminal busy/project/proof。原同域role才保留，不能借当前另一source。
- 真实3 Gateway例先红后绿；独审queued项目变更的extra metadata调用、catalog/apply late owner再3红后修。13个模拟UI例覆盖切源、取消、readonly、disabled无fallback、跨unmount幂等、旧success不能清活实例的未确认ID、blocked失效及正确variant/defaultOnly。后三类原有3红及late-success1红均确定后修；一处旧高级设置测试把整个页面复用的公共class都当路径管理，改为仍严核原advanced scope/no-path-IO，不删断言或改产品来避错。样式复核纠正祖先scope并去纵向wrapper的row，仍不是浏览器视觉证据。
- 最后33文件1190PASS/0FAIL/0SKIP、Host/Client types及全新隔离preview通过，重叠报告不相加，不是全仓或实机；源代码此后仅同步文档。现GUI用隔离Chromium实际访问401，kimi-cu-win disconnected，不取cookies或绕认证/开替代服务。浏览器及缺asound的deb只下载/解包进ignored项目cache，不装系统包。当前真实source strict guard重新证格式coherent但A已过期、未满足60秒；0UID HTTP/vendor CLI/model/源内容写/业务agents读取，不刷新来源或改expiry。最初直接TS预检两次UNSUPPORTED仅为不支持的未emitted资产布局，定位后按正常已验证包布局取得上述结论，不把其当来源格式失败或放宽kernel门禁。
- Round24真实导入实况（默认`~/.minimax`根，A未过期、门槛满足）：生产facade+真实本地subprocess+真实内核/store/mcode连续AUTH_SOURCE_CHANGED。只读诊断链：安静窗口20秒纯快照seal；外部`mcode --version`不破坏快照；私有根下真实`mcode acp`证明0.6.12完全遵守`MINIMAX_DATA_DIR`（含`run/mt-*`全落私有根）；fs.watch抓到活终端~9秒周期的`run/mt-*`任务且auth文件字节级戳失败前后完全未变——活终端对auth.json的打开动作触发OFD读租约/open守卫，属设计拒绝（活跃账号不可导入），非内核误报。排队停止分类回归（停止前准入失败被误标interrupted）由去async化的preferenceBinding直接返回绑定Promise修复——根因是Round23的异步包装延迟了拒绝传播，而非守卫分类本身；先停止后失败的排队查询仍保持interrupted，仅双品牌CCU始终强制记录。mcode单进程实况补充：默认根存在45527硬链接的background-tasks历史目录，仅观察目录元数据未读内容。
- 真实验收驱动的产品修复与最终实况：①mcode启动会normalize目标config（回添provider广告），target verifier从"跨Native整段字节守卫"重构为PRE短守卫+POST新鲜读取、owned字段仍须匹配签名摘要（vendor形态白名单解析，瞬态permission创建后删除不可见、持久仍拒）；②ELECTRON_RUN_AS_NODE不再泄入vendor子进程；③typed发射布局缺`terminal-bridge.mjs`使managed-agent的PTY帧解析在loader错误文本上崩溃——build补拷该资产（连同pi-login/zcode-resume），此即此前"间歇失败"的唯一真根因（目录日志中的"Invalid model reasoning"是被设计跳过的第4条广告配置）。修复后agony真实导入**首轮成功**（profile `ap_f1285fd2`，真实快照/UID/store/目标verifier发布），profiles.run真实目录3个已验证模型，生产Runtime真实链路连续两轮完整通过：首轮completed（口令回执、原生会话、模型回显）+**同会话续聊completed（sameConversation复用同一原生会话）**，runtime干净关闭。agony仅在用户授权下由其自身CLI续期一次，0业务agents读取。

## 尚未完成与最终交付

仍待实际vendor Native目标初始化/刷新/保护验收、真实导入/目录/首轮/同会话续聊/停止及现GUI桌面/窄栏，以及正式提交前最终全量/热更新。Runtime固定pin/作用域、正式选型和账号控件已有源码及模拟证据，但不能由此称完整可用；本轮受管来源预检为新的实际观察，不能重复计算成连续三轮同阻塞。原change主清单仍2/17，MiniMax2.2及跨CLI任务不虚勾。

用户要求最终核本轮所有有价值本机成果：源码、测试、设计研究和有价值草稿均纳入交付盘点；重复的旧stub/原始日志、凭据及业务内容继续留本机。保留原ignored草稿及校验，不整包上传缓存，不以工作区干净代替完整成果盘点。最终仍须提交推原分支并核远端SHA；截至本记录尚未提交、推送、部署或发布本切片。
