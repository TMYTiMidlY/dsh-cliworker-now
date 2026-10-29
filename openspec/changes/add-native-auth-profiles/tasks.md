# Tasks

## 1. 私有store与安全导入基础

- [x] 1.1 建立profile descriptor/私有manifest、独立materialRevision与recordRevision及request ID去重；先红覆盖同ID重入、管理CAS冲突、rename不使旧材料失效、坏registry/冷恢复不回默认，记录测试和schema说明。
- [x] 1.2 实现有界FD no-follow、owner/nlink/路径前后及多文件一致快照、0700/0600目标与原子发布；以ABA/符号链接/硬链接/中断/私密marker反例验证不泄漏、不改来源、不复活未发布材料，说明未核ACL拒绝边界。Linux可选受管companion须核独占OFD read lease、原始inotify同步drain/overflow、线性化seal、mmap/已有writer、EOF/abort/父死清理及build/package ABI；缺产物/未知FS明确拒绝，不以watch/sleep或单一探针代替完成。

## 2. 三类原生导入adapter

- [ ] 2.1 实现AGY已证文件来源及必要路由/原生保护投影，保留default/lxy读取兼容；扩展私有oauth-credential kind与可辨别kind/mode/策略版本/CLI/路由域的HMAC身份合同，refresh-backed固定精确R0并允许其不变时已证正常access/expiry更新，原生已证access-only独立固定A0，轮换/缺失/跨mode不重pin。实现严格expected-absent及已证lxy settings-only元数据守卫，不放宽regular0600/nlink1或鉴权链接；用相反正例、创建删除/链接/祖先ABA、输入选择变化、跨kind/同字节跨mode、首次verify轮换零发布和target保护/cleanup反例验证。静态核完整Native格式/读取/刷新/保存及保护白名单，明确pin不证明A主体/A与R配对，未知合同不伪造能力；目标独立HOME不复制auth链接/历史/锁，未知route/keychain不借原HOME，同步格式及支持说明。
- [ ] 2.2 实现MiniMax标准prod cn/en多文件/schema/epoch一致导入与目标root原生record重键；正反例核token/state不变、只复制所选record、不复制锁/身份缓存冒认证，未知/refresh中来源拒绝，并记录原生合同。
- [ ] 2.3 实现Codex file auth/default route及最小安全config导入，隔离sessions/SQLite/locks；验证keyring/auto、祖先项目override与无法保留的保护策略不放行，共享settings不能变成凭据任意链接，更新支持说明。

## 3. 查询、绑定与运行时单一context

- [ ] 3.1 将registry解析context贯通固定身份合同/source、catalog、执行及原生终端，补Codex scoped root与显式子进程环境；oauth-credential在目标Native probe前后重读原始mode/pin和保护，不以legacy binding或models成功替代，源seal前保持guard且join目标owned进程；纵向验证固定来源一致、父env和其他CLI不变，记录注入点及不证明远端账号的边界。
- [ ] 3.2 完整setup/目录缓存纳入profile/revision，保留legacy native及agy_account；验证同model不同profile、不同parent/project、过期version与缺MODEL_REQUIRED，不出现问卡或跨源角色/权限继承，更新参数文档。
- [ ] 3.3 Worker保存固定source版本及身份策略，贯通queue/followup/model switch/fork/恢复；用实际runtime合成覆盖同R0合法更新仍续聊、R0消失但A未变/同root换pin/未知mode均零新prompt、不以新材料reimport搬旧conversation；来源失效仍用已拥有handle停止并等真实cleanup。已执行后失配保留run原文/产物/退出/清理独立证据，不倒填零执行/exit0/当前quota或自动重发，保留按CLI保护和历史。

## 4. Agent工具、Gateway与设置

- [ ] 4.1 提供安全list/import/manage及models/start/configure_conversation参数；主会话/plan/readonly/子Agent/CLI双选择和Worker override先拒绝。用真实工具注册/Remote边界测试无secret/path泄漏、无未授权Native执行，并同步工具指引。
- [ ] 4.2 设置页复用既有原生控件，区分当前原生/独立导入及不可用状态，提供宿主来源输入与导入/停用反馈；组件测试异步旧回执隔离、取消不保存半组合，按设置规范同步交互说明，不伪额度。
- [ ] 4.3 核实目录及新任务UI使用所选profile、已有Native会话只读显示固定来源；浏览器实际核对桌面/窄侧栏溢出、保存/重开与无secret展示，记录截图/状态，未核平台保持可见。

## 5. OAuth及管理生命周期

- [ ] 5.1 版本管理按固定身份合同核一致，API换key或OAuth换pin/mode/route域不能覆盖同ID，即使同邮箱/JWT/label/root；同pin重入仍新材料及CAS。合成覆盖跨parent不泄任务、取消/dispose/冷恢复未知kind/缺mode/坏manifest不补默认、rename/reimport后旧Worker仍旧root、disabled零新prompt但stop可用；request重放只回原receipt不重新验证/接纳新pin，旧格式/HMAC及legacy default/lxy不自动迁移，busy拒绝无fallback，记录持久边界。
- [ ] 5.2 对可证同Native principal或同CLI/策略/route/mode/OAuth精确pin建立插件内刷新组串行，refresh-backed同R0即使A/profile/root不同也同组，access-only同A0仅在独立域同组；覆盖导入目标验证、readonly metadata和任务，固定锁序/拿锁后重检/持锁至owned cleanup，store写lease不冒刷新锁。合成验证Native只写自己根、无回写/恢复旧token/跨profile救援；导入/UI/文档明确不同pin仍可能同grant/family、不保证外部刷新受控或失败导入无远端副作用。

## 6. 独立集成与实际验收

- [ ] 6.1 父独立关联回归、Host/Client类型、所有本change strict/diff及全新隔离包核对；冻结源码/构建/测试输入，核包无credential/history，不拿局部通过或已有0.8.2包冒新功能已部署。
- [ ] 6.2 在已授权同CLI来源执行真实导入、目标固定身份合同/Native模型目录、首轮/续聊及切profile新Worker；核原文件不变/目标权限/无历史复制/实际产物和runId，OAuth前后核原mode/pin且回执说明凭据连续性非远端账号/配对证明，首次轮换可失败及不同pin新profile/Worker边界如实记录；未发现的wrapper、原生合同或平台不冒称实测。
- [ ] 6.3 空闲备份热更新，验证registry/旧版本/Worker历史/并发及无关配置保留、PID不变；在现GUI刷新核新账号控件，并收齐所有job及按runId结果。
- [ ] 6.4 独立审查README中英/设计/参数示例和支持矩阵，区分已实现/合成/实机/Hub后续；同步本change及实际日志，核本变更归属并交总目标最终提交验收，不把其他未完成目标写成已通过。

## Workflow follow-up

- 1.1与1.2已完成的范围仍是当时的两类身份私有store及Linux/x64已存在regular文件严格快照后端；其余15项未完成，总数仍17。2026-10-26用户确认OAuth凭据固定并要求按既有目标直接实施，本轮先同步规划：第三种kind/版本化身份格式、expected-absent及settings-only链接扩展与全部新反例归未勾选2.1，不能以旧勾选或旧58/109项证明新能力。两份历史实施记录不重写；分别见[第一切片记录](implementation-1.1-1.2.md)和[1.2独立记录](implementation-1.2-linux.md)。缺helper/未知FS/平台/ABI仍拒绝；当前尚无供应商导入adapter、工具/UI/runtime接入或本change真实导入/完整包/安装验收，Hub/额度不在本轮。
- Round14实际切片：通用metadata守卫及33项合成已实现，6文件158PASS、scoped/Host/Client noEmit、strict/diff及8个明确切片输入前后hash通过。旧接口对新选择的21红、独审所指readlink有损UTF8的1真红及随后buffer字节修正均保留；C/ABI/store未改。具体lxy授权、OAuth kind/私有格式、完整Native schema/保护和供应商验证仍未完成，2.1不勾，既有两份历史实施记录不重写。当前切片与未覆盖owner/Native-cleanup闭环见[API](../../../doc/native-auth-snapshot.md)及[实际日志](../../../doc/tasks.md)，不是已部署导入功能。
- Round15存储切片（Round16接续核对）：第三种oauth-credential、明确私有policy/manifest2、混合registry2与旧manifest1/回执兼容已实现，53项新合成及7文件211PASS；ES2023 scoped/Host/Client noEmit、strict/diff通过。scope误用ES2022的类型退出2保留，未改已有findLast业务代码。取消覆盖真实品牌cleanup、交付buffer漏擦及detached遗留lease等反例先红后修，不冒真实Native进程验证。供应商adapter/实际格式/保护/运行时未完成，2.1仍不勾；独立[存储合同](../../../doc/native-auth-store.md)和实际日志保留边界，旧历史实施记录不重写。
- 完成业务与实际证据后按授权进行规格同步/归档；不要用格式通过或任务目录存在代替导入、模型或平台验收。
