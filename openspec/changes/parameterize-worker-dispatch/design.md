# Design

## Context

Host 已有同父/项目/CLI 的选型锁、账号绑定与完整 DispatchSetup。动机见 proposal；旧问题卡只服务 start，没有必要保留在 Agent 工具的默认路径。

## Goals / Non-Goals

**Goals:** 所有 start 分支无问题卡；输入可由 Agent 指定并按原生目录校验；不降低权限或账号检查。

**Non-Goals:** 不替代原生登录、权限审批，不开放新 CLI 能力，不让 expected_model 选模型或角色，不修改已有 Worker。

## Decisions

- 保留现有作用域锁和完整设定存储。当前父设定优先，随后才是同项目设定；当前父设定失效时不悄悄换用项目设定。
- 没有显式 model 时必须存在完整且仍有效的设定；legacy 模型偏好不补造角色。显式 model 使用当前 CLI 自有账号建立新派遣设定，仍在最终授权前核对同一绑定。
- effort 省略时优先复用相同模型的有效旧强度，否则仅采用目录实际支持的 default 或唯一强度；存在多个且无 default 时返回 EFFORT_REQUIRED。
- role 省略时复用有效完整设定的角色快照；首次显式 model 默认无预设。role=none 清空本次新派遣角色，其他值只接受预设精确 ID。cliworker_roles 只返回 id/name/summary，不输出预设正文。
- expected_model 只校验最终解析后的精确目标；在写入设定、创建 job/Worker 前拒绝不符。账号来源、模式和项目变化仍须再次检查。
- Qoder 双版本歧义返回明确的 qoder国际版/qodercn 候选，不创建问题卡，也不自动回退。

## Risks / Trade-offs

- [旧 Agent 仍按问题卡说明调用] → 同步工具及系统提示；缺参错误指导查询目录后补参，不自动选模型。
- [同项目设定可能来自另一对话] → 每次实时验证绑定与精确模型/强度，已有对话快照不被项目更新覆盖。
- [登录/权限仍可能有用户交互] → 本变更仅移除选型问题卡，不绕过原生授权与宿主审批。

## Migration Plan

无存储迁移。先关联测试、typecheck 与隔离构建，在插件空闲时备份并热更新既有 profile；不重启 DSH。若失败保留旧包与历史，不自动覆盖认证/设定。
