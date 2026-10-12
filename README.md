# YGX 企业 AI 技能与项目库

当前收录 **2 个 Skill**、**1 套项目系统源码**。先按工作目标选择入口；每个 Skill 都有独立说明和完整规则。

## 技能目录

1. [视频素材筛选与分类](skills/video-material-review/README.md)：从原视频中找出可用镜头，记录区间、分类和审核反馈。
2. [家具短视频制作](skills/produce-furniture-video/README.md)：用已确认的素材制作家具短视频，并交付可继续编辑的剪映工程。

常见顺序：**先筛选素材，再制作视频**。两个 Skill 可以分别安装和使用。

---

## 技能 01：视频素材筛选与分类

**什么时候用：** 素材散落在不同项目和账号里，需要看真实画面、找稳定镜头、标记适用范围和记录个人审美偏好。

**会得到什么：** 原片和候选区间的索引、主体与用途标签、质量判断依据，以及可保存的人工审核意见。原始视频保留在原位置。

[打开技能说明](skills/video-material-review/README.md) · [阅读完整规则](skills/video-material-review/SKILL.md)

复制给同事的 Agent：

```text
请从 GitHub 仓库 2025bh/YGX- 安装
skills/video-material-review 完整目录。
安装后先读该目录的 README.md 和 SKILL.md，
再核对我自己的素材、项目和可用分析工具。
```

---

## 技能 02：家具短视频制作

**什么时候用：** 为家具品牌号、工厂员工号、门店或清货账号制作混剪、案例或带看视频。

**会得到什么：** 按镜头计划制作的审片视频、文案、镜头清单，以及符合任务要求的可编辑剪映交付。制作前仍需提供接收方自己的素材和剪辑环境。

[打开技能说明](skills/produce-furniture-video/README.md) · [阅读完整规则](skills/produce-furniture-video/SKILL.md)

复制给同事的 Agent：

```text
请从 GitHub 仓库 2025bh/YGX- 安装
skills/produce-furniture-video 完整目录。
安装后先读该目录的 README.md 和 SKILL.md，
并按仓库里的同事交接文档核对项目、账号和工具。
```

[查看视频制作同事交接文档](docs/colleague-handoff.md)

---

## 项目源码：忆古轩项目交付系统

这是一套单独的[项目交付系统公开脱敏副本](project-delivery-system/README.md)，用于本地隔离演示和继续开发，**不计入上面的 2 个 Skill**。运行条件、演示范围和已实现功能都写在它自己的说明页。

## 使用与维护

- 安装 Skill 时保留其**整个目录**；只复制 `SKILL.md` 会漏掉引用规则、模板或脚本。
- Skill 提供工作规则和检查方法；原始素材、视觉模型、剪映、FFmpeg、账号及授权资源需在使用者自己的环境中准备。
- 新增 Skill 时，在 `skills/` 下建立独立目录和 `README.md`，并同步更新本页的数量、目录和独立介绍。

