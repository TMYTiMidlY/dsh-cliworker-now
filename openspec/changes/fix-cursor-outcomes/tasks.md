# Tasks

## 1. 保守结果投影

- [x] 1.1 实现 Cursor 专用诊断/工具结果 helper；单测覆盖同文引用、分块/部分正文、普通 JSON、严格值/边界/混合未知与关联歧义。
- [x] 1.2 接入 native-cursor io/event/result 和 accepted/post-dedupe 可选钩子并加入构建清单；合成真实子进程覆盖 end_turn、错误/取消/退出/清理，不改其他 ACP 默认。
- [x] 1.3 同步最小行为说明、静态证据局限及 doc/tasks.md 追加记录；保留原真实验收与并发 dirty。

## 2. 关联验收

- [x] 2.1 执行 Cursor/shared ACP/Host outcome 最小关联回归，核对 UNCERTAIN 不自动下一条、私密错误不公开；执行 Host 类型和严格规格检查，记录实际结果。

## 3. content-only 终态快照复核修复

- [x] 3.1 先红复现 edit/delete diff 及 content-only 矛盾终态；冻结首个有效终态内容，支持等价重放/键重排、省略 metadata 和合法非终态进度，冲突只影响该工具。
- [x] 3.2 验证 helper、合成 bridge、官方消费者及邻接生命周期回归，执行 Host/Client 类型、strict spec/diff 检查并追加实际红绿记录；不改 common hooks/账号/诊断规划。

## 4. Cursor-only response fence 畸形协议失败关闭

- [x] 4.1 先红复现 owned prompt response 带 falsy method、mixed/missing result/error 与非法 error；仅 opt-in fence 同步固定安全失败并封口，正常/无关/preprompt帧隔离不变。
- [x] 4.2 验证真实合成 bridge 与官方消费者关键纵向、邻接生命周期及类型/strict/diff，记录红绿并收齐 jobs；不改 LinePeer/其他ACP默认、账号或独立诊断规划。

## 5. Cursor-only 本地权限拒绝的工具因果投影

- [x] 5.1 补充原生权限来源合同与增量规格，先红复现 local deny 后原生 completed/空输出或可见零输出误COMPLETED；实现可选 permissionDenied 钩子与本run唯一有效opening的sticky localDenied，区分identity复用与普通output歧义，不开放批准能力。
- [x] 5.2 验证helper、真实合成Bridge及官方passive consumer的精确ID/多tool隔离、orphan/reuse/foreign/preprompt/late、MCP allow_once及其他ACP默认；保持原权限runERROR、取消/cleanup优先，执行关联回归/类型/strict/diff并追加实际记录，收齐jobs。

## 6. Cursor read 缺有效正证据时保留未知

- [x] 6.1 基于固定source和父run871202a9否定证据补read合同，先红复现completed但无raw/有效正证据误SUCCESS；仅read在缺正证据且无确定负向/硬失败时最终UNKNOWN/runUNCERTAIN，保留正常raw文本（含空）和已知readLints计数，不猜image或解析error/文件名/Host读路径。
- [x] 6.2 验证helper、真实合成Bridge、官方消费者及邻接回归；缺证据只影响目标read，独立严格失败/localDenied/native failed及取消/cleanup优先，记录实际红绿/类型/strict/diff并收齐jobs，不Native重试。

## Workflow follow-up

- 独立写者未安装/调用Native；父随后已完成空闲备份热装、正常read/本地拒绝/read缺证据/明确新任务恢复四项正式run及现GUI刷新，见[native验收](native-acceptance-20261025.md)。没有重启/发布/归档；实际Shell exit7与允许一次批准仍未验证，不把该窄修冒全CLI能力完成。
- P1 effort/transport rail 与 P2 MCP/附件能力保持原界限，不因本变更开放。
