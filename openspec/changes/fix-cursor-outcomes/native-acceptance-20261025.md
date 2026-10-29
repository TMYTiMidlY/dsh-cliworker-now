# Cursor outcome 修复的父独立验收（2026-10-25）

## 验证范围

本记录只验收本change的保守结果投影及既有会话保持，不把CLI本文标记当执行证据，也不声称开放新的批准、MCP、附件、图像或Shell权限。

父先独立复验20文件697通过/1既有跳过；再加入鉴权store基础，串行23文件755通过/0失败/1既有跳过，774个产品/测试输入前后冻结一致。Host/Client类型、三份关联strict与diff通过；不是全仓或跨平台验收。helper另补非终态一致性4反例，先4失败/97通过后修正；common原有缺终态硬ERROR一直有效，不能称此前生产假成功。

## 空闲备份热装与并行更新保留

- 首次候选52ad仅构建未安装：全局active1，idle守卫正确拒绝；180秒事件观察无空闲，不打断其他任务。后续全局0时重新冻结/构建，不复用旧源码证明。
- 期间另一任务已更新AGY catalog-preflight。最终候选与现网Host/Client运行字节相同，719个lib产物除Cursor helper/common钩子/声明、非执行adapters source-map及9个未接入的auth基础类型产物外没有差异，未移除旧产物；没有回退AGY更新。source-map只有mappings改变，adapters.js字节相同，不是额外业务变更。
- 正式包928文件、18295001bytes，SHA `87eb221e5057d7b5a47d825ae28999d3aa00edff0ff6e68dbf6649c4131206f9`；[构建证明](../../../.cache/cursor-authstore-20261025-r1-package/build-proof.json)与[安装证明](../../../.cache/install-backups/cursor-authstore-20261025-r1/installation-proof.json)保留在忽略目录。719个lib逐字节核对，827个既有历史文件不变、无关依赖和并发12不变。
- DSH PID38589/startTicks761921不变，没有重启服务。只替换profile第2行激活说明，其他配置行逐字一致。Host SHA `2cadf6702288f0a70d34cc8ce8e55979970a2a7de1b3ca2e003dcaad905d6401`，Client保持`21efc4552afc1cc250a9aa054cb46eb1aa658d03d39dc64807c33a6c830899ce`，helper为`e9d5800d4cf1eb8da785da269831cb9dded937e8e7bef3eedce99420d4d14b36`。

## 正式插件入口及本轮事件

四轮均以已有cursor-5续聊，精确expected_model/expected_run_id准入，未新建Worker；配置及native observed均为`grok-4.7[context=256k,reasoning_effort=high,fast=true]`、effort default、accept-edits，原生conversation保持。每个run分别读取完整公开结果至hasMore=false并收齐job。

| 场景 | runId | 实际结果及独立证据 |
| --- | --- | --- |
| 正常read | `9d625268-9232-45e0-a5f6-d8bb632cf6e4` | completed/complete、cleanup confirmed；恰1原生tool，RUNNING→UNKNOWN→COMPLETED。raw公开output与正文含**未放进提示词的**随机nonce，预置文件不变；不是正文自称成功。 |
| 本地拒权 | `587fbd77-2746-49a7-beda-8a30d054b2df` | failed/partial、cleanup confirmed；恰1准确Shell command，最终FAILED且固定本地拒绝摘要。没有重试、没有权限放宽；**不证明exit7实际执行**，只证明拒绝不会再变COMPLETED。 |
| read缺证据 | `014b5430-3722-4437-b1be-2d4f77872338` | uncertain/partial、cleanup confirmed；恰1准确path read，最终UNKNOWN，无COMPLETED。路径前后不存在仅作人工验收，不进入分类器；Native缺输出不猜ERROR。 |
| 明确新任务恢复 | `53469596-cb4a-4d63-8042-b8bb70b5476e` | completed/complete、cleanup confirmed；原native conversation及Harness child不变，17条本run事件且零tool，正文仅CURSOR_AFTER_UNCERTAIN_OK。不是重试旧读取/命令，也未借用旧lastResult。 |

[正向事件摘要](../../../.cache/cursor-positive-20261025-r1-observation.json)、[拒权摘要](../../../.cache/cursor-denial-20261025-r1-observation.json)、[缺证据摘要](../../../.cache/cursor-missing-read-20261025-r1-observation.json)、[明确恢复摘要](../../../.cache/cursor-explicit-recovery-20261025-r1-observation.json)只从本Worker/指定run的插件公开events核对；不读取Cursor私人原生history，不复用旧lastResult，不发布raw日志。

## 真实现有GUI

刷新现有`http://127.0.0.1:61060`，确认注入boot且打开本parent下cursor-5原生侧栏。[实际DOM证明](../../../.cache/gui-cursor-outcomes-20261025-r1/proof.json)和[截图](../../../.cache/gui-cursor-outcomes-20261025-r1/cursor-outcomes.png)显示最新read正文、此前正向nonce、拒绝说明及“Cursor 原生结果待核实，请核查本轮正文和产物，不要自动重试”。647px侧栏与页面无横溢出，1个可编辑原生输入；SDK turn错误样式显示Failed，顶部保留待核实原因，未冒称模型成功。使用隔离headless浏览器、未动用户浏览器/模型/消息/登录操作，无新服务器、无客户端样式改动。旧389px证明不冒充本次窄屏重测。

## 限制与后续

Host当前不允许额外审批，未验证Shell实际exit7及允许批准的执行路径。图像/no-output read仍保守未知。P1 effort/rail、P2MCP/附件及新的builtin一次性批准不因本次完成而开放。包中的auth store只是未接入基础模块，严格snapshot仍AUTH_UNSUPPORTED，不能称真实鉴权导入功能已完成。
