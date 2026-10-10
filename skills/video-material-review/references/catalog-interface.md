# 镜头库接口与记录约定

先读取接收电脑上的素材台说明，确定实际入口。规则Skill不包含本地软件；没有兼容接口就保存结构化审核记录，不编造调用。

## 已验证的适配接口

素材台使用Python/FastAPI/SQLite，网页和CLI共用runtime/library.sqlite3。仅监听127.0.0.1，写请求使用页面meta中local-token作为X-Local-Token；不要将令牌写入日志或仓库。

- GET /api/catalog：当前输入输出配置、批次、字典、项目。
- GET /api/catalog/segments?project=项目&status=状态&batch=批次&search=关键词：片段与审核证据。
- POST /api/catalog/prepare：source、output、project、limit（1至10），返回job。只进行本地元数据、镜头检测和抽帧，不自动调用视觉模型。
- POST /api/catalog/detail：id、start、end，候选区间补充6张时间戳画面，返回job。
- POST /api/catalog/review：审核记录数组，每项id、revision、changes。changes含start/end、subject、shot_size、content、uses、style、reason、scores、confidence、evidence_ids、review_state、status、primary。评分必须关联区间内实际查看的证据；截图只能标抽样初筛。
- POST /api/catalog/feedback：id、revision、action（like/dislike/reject/correct/primary/played）、changes、reason。dislike必须有原因并标备用，reject标不采用不删除。保存前后状态与项目范围；人工结果保护不被模型覆盖。
- POST /api/catalog/clone：id，新增独立连续片段，保留来源，重新审核。
- GET /api/catalog/examples?project=项目：最近20条同项目人工正反案例。
- POST /api/catalog/export：ids、candidate；候选与精选分开，精选需可用且播放复核。
- GET /api/jobs：队列状态；POST /api/jobs/ID/cancel或retry。

以上只是已经实现的协议，使用其他工具先核对其实际接口，不假定路径和命令兼容。

## CLI

在实际素材台目录使用其Python环境运行catalog.py：prepare --source 输入 --output 输出 --project 项目；list --batch 批次；review --file 审核JSON；examples --project 项目；export --file 片段ID数组 --candidate。
prepare及export共用处理队列；返回done不等同视觉验收完成。list只读；review导入人工或Agent已审画面的结构化结论。模型不可声称持续自动扫描。

## 分类与数据

原片身份用内容SHA-256追溯，快速变化检测用路径/大小/mtime特征。每段关联原片、源镜头边界、start/end、方法版本、项目、账号引用、多维标签、分项评分、证据、置信说明、审核状态和输出阶段。
总分是35/25/25/15分项之和，不是概率。相似检测首版采用多个抽样帧的顺序哈希提示，存在误报和漏报；只有原文件SHA-256相同才可称字节相同，仍保留全部原片。
先用10条真实样本校准；原速播放负责连续运动确认。喜欢/不喜欢保存项目范围和原因，后续Agent先读取同项目案例。尚未做模型训练。
网络成片常有烧录字幕和人物/标识，记录为参考来源；不能称独立可编辑原字幕或自有实拍案例。
爆款高转视频参考排除可用素材扫描，只保留参考历史。visual_checks分别记录text、watermark、person的有/无/未知；clean_reviewed为人工全片检查确认，不允许截图分析写true。所有原片文字、水印硬排除，网络/下载额外要求无人物且竖版，policy_errors提示导出门禁。反馈原因保存至feedback_reason并在界面回显；旧候选标新规则待复核、不删除。
导出索引是批次快照，改切点或归属生成新导出，不覆盖旧版本。缓存、日志、数据库、真实素材路径及偏好案例留在接收电脑。

