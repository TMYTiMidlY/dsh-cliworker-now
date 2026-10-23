# Tasks

## 1. CLI 与账号入口

- [x] 1.1 新增 cursor ID、别名、独立 executable 设置与 fail-closed Windows 路径，模拟路由/路径/设置测试通过。
- [x] 1.2 实现原生 status 安全投影、稳定账号绑定和 API/端点路由拒绝；模拟测试覆盖缺资料、切换账号、登出与敏感字段不泄漏。

## 2. 原生目录与执行

- [x] 2.1 实现有界零 prompt ACP 模型元数据，完整保留 opaque ID、default effort，覆盖 malformed/error/early-exit/timeout/cleanup 与账号变化。
- [x] 2.2 实现 cursor-acp-v1 桥、原生 model/mode 确认、精确 resume、取消和权限拒绝，模拟测试不发送未确认 prompt。
- [x] 2.3 明确关闭工具/MCP、附件、fork、steer，覆盖能力与防御性入口测试。
- [x] 2.4 最小同步 README、usage/settings/design 与 doc/tasks.md 结果，保留既有附录。

## 3. 集成检查

- [x] 3.1 执行关联回归、可用类型检查和 OpenSpec strict 校验，记录命令、结果及未执行范围。

## 4. 原生数字身份修正与父会话验收

- [x] 4.1 对照已安装原生 GetMeResponse int32 描述及实际 status 类型，修正数字账号 ID 校验；不读取凭据文件或推断 JWT 映射。
- [x] 4.2 增加原生正整数边界、无效类型拒绝及数字账号切换模拟回归；5文件179项、strict校验与全新隔离构建通过，实际原生status私有投影已确认authenticated与稳定principal。
- [x] 4.3 经用户授权热替换数字身份修复包，核对安装产物一致、其他依赖不变及宿主PID保持；安装和HMR通过。
- [ ] 4.4 通过原生选型取得真实Cursor请求回传。首次启动工具等待1800000ms超时，随后确认无Cursor Worker、无native-bridge进程；未重复派遣，待确认用户是否看到选型卡。

## Workflow follow-up

- 同会话续聊、真实取消、浏览器侧栏和 Windows 验收仍待实际执行；模拟通过不代表完整验收。
- 原编码子任务没有执行安装替换；父会话获用户授权的后续安装与真实请求见 doc/tasks.md。没有 git 暂存、提交、推送、版本升级或变更归档。
