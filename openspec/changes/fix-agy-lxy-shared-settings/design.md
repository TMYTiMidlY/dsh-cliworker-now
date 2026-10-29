## Context

本机lxy HOME的settings.json是指向默认HOME同名设置的软链接；assertAgyNativeAccountRoute调用readFirstPartyJson，后者明确拒绝所有软链接。实际只读复现默认路径通过，lxy拒绝。两份token独立且存在，不需修改。

## Goals / Non-Goals

仅兼容已知共享设置布局，不放开通用配置读取、凭据链接或外部账号来源。不给其他CLI增加特例，不自动刷新/复制token，不将本地文件检查等同远端权限。

## Decisions

新增readAgySettings(home,parentHome)专用入口。普通文件保留原有路径；仅当home精确为parentHome/.agy-homes/lxy、链接直接解析到parentHome/.gemini/antigravity-cli/settings.json、链接与目标为当前用户所有时允许该共享设置。目标严格读取并检查链接前后inode/mtime/ctime/内容不变；祖先仍禁止非可信软链接，目标拒绝链接与硬链接。其他布局给出不含私密路径的明确设置错误。

安装预览从当前已安装lib复制，不执行会清理共享.cache的build:preview，不打包其他会话正在修改的index.ts。只替换经hash校验的本次host产物并保留备份；不写账号；必要时仅更新已备份profile的包来源注释以触发正常热重载，不改任何功能配置，不重启服务。热重载是否生效须通过插件工具读目录及一题真实任务验收。

## Risks / Trade-offs

共享设置可能引入自定义模型配置，原有拒绝逻辑仍执行。链接存在TOCTOU风险，因此读取前后校验链接和目标并在不一致时拒绝。此修复只覆盖本机明确布局；未知链接不跟随。

## Migration Plan

合成目录测试→本地只读预检→独立产物构建→无活动任务时有备份安装→原生工具目录及真实任务验证。失败保留证据且不冒称成功。
