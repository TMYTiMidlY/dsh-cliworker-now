## ADDED Requirements

### Requirement: 精确共享设置读取
Host SHALL 支持lxy隔离HOME的设置文件直接链接到当前用户默认AGY设置，同时保持凭据隔离和通用文件读取安全规则。

#### Scenario: 原生lxy共享默认设置
- **WHEN** lxy设置链接精确指向同用户默认AGY设置且链接与目标前后稳定
- **THEN** Host只读校验目标设置并继续使用lxy独立凭据进行身份与目录校验

#### Scenario: 非受信链接或目标变化
- **WHEN** 设置链接指向其他文件、祖先含不可信链接、所有者不符或读取期间发生替换
- **THEN** Host拒绝且不得运行模型、改写账号或静默回退到默认账号

#### Scenario: 自定义模型路线
- **WHEN** 共享设置包含现有预检不支持的自定义模型来源
- **THEN** Host保持原有拒绝行为，不把共享设置兼容当成自定义来源授权

#### Scenario: 凭据链接
- **WHEN** lxy凭据文件本身是软链接
- **THEN** Host继续拒绝；共享设置特例不得应用于凭据
