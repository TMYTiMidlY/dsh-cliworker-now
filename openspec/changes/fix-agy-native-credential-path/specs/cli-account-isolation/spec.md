## ADDED Requirements

### Requirement: AGY 当前文件认证来源一致性

非 Windows 的 AGY 文件认证状态、模型查询预检及执行账号绑定 SHALL 统一读取当前 home 下 `.gemini/antigravity-cli/antigravity-oauth-token`，只返回安全身份摘要或私有账号版本。Host MUST 保留有界只读、路径及文件身份检查，不跟随符号链接，不更改原生凭据，不把本地认证材料可读等同于远端授权。Windows 原生 Credential Manager 通路 SHALL 保持独立。

#### Scenario: 原生终端已保存当前账号

- **WHEN** 当前原生路径存在可用的合成 OAuth 材料，旧 jetski 文件不存在
- **THEN** 状态识别、模型预检和账号绑定使用同一当前文件，不要求迁移或重复登录；模型仍来自 CLI 实际目录

#### Scenario: 旧文件与当前文件冲突

- **WHEN** 旧 jetski 文件保留其他账号而当前文件存在
- **THEN** 各入口仅采用当前文件，旧文件不能改变账号绑定或显示身份

#### Scenario: 当前文件退出或不可读

- **WHEN** 当前文件缺失、失效、损坏、为符号链接或其祖先目录被链接替换，即使旧文件仍存在
- **THEN** 返回未配置、认证失效或读取失败，并阻止模型查询或任务授权，不回退旧账号

#### Scenario: 同账号续期及换号

- **WHEN** 当前文件中的同一账号续期，或被替换为不同账号
- **THEN** 同一身份的令牌轮换不改变账号版本，不同账号必须改变版本；删除当前文件后旧绑定不可继续使用

#### Scenario: Windows 使用原生凭据服务

- **WHEN** Windows 环境执行 AGY 账号发现或绑定
- **THEN** 继续通过原生 Credential Manager 安全摘要通路，不改用文件认证
