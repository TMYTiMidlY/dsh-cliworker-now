## Why

agy-lxy原生可用，但CLI Worker在账号绑定前读取其共享设置软链接时被通用no-follow读取器拒绝，最终错误被包装为无法确认账号。修复不得迁移/修改凭据、改变其他CLI或混入同时进行的派遣接口改造。

## What Changes

- 仅为已支持的lxy隔离HOME允许读取指向本用户默认AGY设置的精确共享链接；校验链接、所有者、目标与前后状态，目标仍使用严格只读no-follow读取。
- 凭据仍只来自lxy自己的独立token文件，不接受凭据软链接或任意设置链接。
- 使用已安装r4产物建立独立预览，仅重新编译本次AGY模块，避免部署工作树其他在途改动。

## Capabilities

### New Capabilities
- `agy-lxy-shared-settings`: 精确受限共享设置链接及错误边界。

### Modified Capabilities

无其他能力契约变化。

## Impact

Host AGY设置预检与测试；不改Client、账号文件、版本、厂商配额，不提交/发布/重启。目录可读与真实模型成功分别验证。
