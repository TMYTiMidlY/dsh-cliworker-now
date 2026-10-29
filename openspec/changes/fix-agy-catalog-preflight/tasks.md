## 1. 实现与模拟验证

- [x] 1.1 核对已装产物与源代码的三次预检及15秒期限
- [x] 1.2 AGY独立60秒有界预算、safeDiagnostics、selected HOME
- [x] 1.3 关联模拟回归104项、隔离构建Host/Client类型检查与本change严格校验通过
- [x] 1.4 隔离构建完成；Host只26行diff，安装包取原Client与其他组件，仅更新4个Host产物
- [x] 1.5 对更新后的原生CLI非零退出补有限词表诊断，保留真实exit/cleanup/取消优先级，不公开或持久化任意stdout/stderr、argv或账号内容；关联正反例与实际入口重新核验
- [x] 1.6 Worker目录按固定Worker账号生成一致的binding/discovery配置，不误用部署默认；两方向×Tool/Remote四例红绿，旧binding/默认/历史不变

## 2. 本机真实验收

- [x] 2.1 无活动CLI任务时更新本机插件，确认当前宿主加载修复
- [x] 2.2 正式cliworker入口目录/启动取得Worker与run回执
- [ ] 2.3 实际Gemini返回完整审读正文并核原生模型/清理（按最新人工保守收口，本轮仅完成最小真实生成/同会话记忆续聊，此完整审读留可选后续，不能凭口令勾选）
- [ ] 2.4 同步实际验收和未验证边界；本change不发布或代合其他PR，最终Git收尾依本次用户另行明确授权统一整理/提交/推送
