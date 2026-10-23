## 1. Implementation

- [x] 1.1 建立统一当前 AGY 凭据路径函数，更新身份与绑定读取器。
- [x] 1.2 更新关联合成夹具，增加旧文件冲突、无回退及不安全路径场景。
- [x] 1.3 同步账号说明及实际验证记录，不更改原生数据或发布版本。

## 2. Verification

- [x] 2.1 运行身份、模型、绑定、Windows 模拟账号的关联测试，核对结果（5 文件、115 项通过）。
- [x] 2.2 执行必要类型检查及隔离构建，核对失败及环境限制（首次根目录 typecheck 缺生成 remote；隔离构建含 Host/Client 类型检查通过）。
- [x] 2.3 严格验证本变更规格。

## 3. Installation and Real Validation

- [x] 3.1 在用户确认后替换本机安装，保留数据与回退包（依赖已固定为本地 tgz，触发 profile 热重载，宿主未重启）。
- [x] 3.2 验证用户原生选型的简单AGY请求：gemini-4-argon-high/high、plan，父会话独立核对completed/observedModel/原生会话与Harness子会话，实际返回“你好！这是一个 AGY 会话。”；见doc/tasks.md当日补充，不等同视觉验收。
- [ ] 3.3 用户确认当前GUI账号摘要、目录及侧栏视觉；不以原生请求回执代替截图或视觉核验。
