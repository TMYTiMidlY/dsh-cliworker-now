# 实际验证（2026-10-25）

- 影响范围：新增AGY专用共享设置读取，修改AGY模型预检入口；未修改通用no-follow读取器、凭据来源、Client或派遣接口。工作树的其他在途修改未被本次打包。
- 合成回归：5文件88测试通过（agy-settings、agy-models、agy-account、account-identity、cli-account-binding）；其中本次新增8测试。
- Host/Client类型检查通过；OpenSpec本变更严格验证通过。
- 本地只读预检：lxy共享设置通过、账号binding可识别；该检查没有启动CLI、没有输出token或账号绑定值。
- 独立构建以实际已安装Host 62c7777dc82237526947dbe742069446674521c8d6f33cfc0ad0efcf74809e60为基线，仅编译两个AGY模块后重打Host；候选Host为7caedb7fcc40f9bf156c3d2750b284f361a17f60aee88f74e91811bdaf10748b。未打包其他会话修改的源码。
- 首次准备安装时发现其他CLI占用，未安装/中断；后续正式并发统计为globalActive/globalQueued=0，安装脚本再次验证无活动进程与Worker。
- 已备份并安装6个产物，792份既有Worker/events/raw/binding/fork文件字节未变，并发设定未变，安装期间两份token未变。仅更新已备份profile的包来源注释触发正常热重载，没有功能配置变更或服务重启。
- 激活后不再报无法确认账号，而是旧会话绑定变更保护；通过正式configure_conversation显式指定lxy和gemini-4-argon-high/high，只配置本父会话后续新Worker。随后cliworker_models成功返回原生账号模型目录。

## 真实任务边界

新建agy-155，worker 8542552f-067a-47ae-8630-df4340def4da，run 21bc6c9f-e342-40a9-9635-5a871f0b3b8f，复审尚未Argon审阅的题7697188248975658802。配置与原生观测均gemini-4-argon-high；请求实际进入原生CLI，但服务端返回RESOURCE_EXHAUSTED/HTTP429、Individual quota reached、Resets in27h37m48s。最终status failed、无公开正文、partial true、cleanup confirmed。

因此：共享设置兼容及账号/目录通路已修复；成功生成审阅正文尚未验收，不得把此次失败计为已审，不自动重试/换号/换模型。原生CLI的正常自动凭据续期不等于人工复制或迁移凭据；本次没有人工修改账号文件。

私有构建、安装备份及原生回执位于既有物理审题任务目录的work下；无Git提交、发布、上传、删除或服务重启。
