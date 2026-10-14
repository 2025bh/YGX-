# YGX 企业 AI 技能与项目库

当前收录 **3 个 Skill**、**2 套项目系统源码**。先按工作目标选择入口；每个 Skill 都有独立说明和完整规则。

## 技能目录

1. [视频素材筛选与分类](skills/video-material-review/README.md)：从原视频中找出可用镜头，记录区间、分类和审核反馈。
2. [家具短视频制作](skills/produce-furniture-video/README.md)：用已确认的素材制作家具短视频，并交付可继续编辑的剪映工程。

3. [CAD报价识别与纠错](skills/cad-quote-review/README.md)：核实家具CAD部件、尺寸与工程量，对比人工报价并保存纠错证据，支持本地审核平台制作。

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

## 技能 03：CAD报价识别与纠错

**什么时候用：** 家具木作报价需要同版DWG/DXF复核、见光板或工艺漏项检查、AI与老师傅报价对比，以及逐题纠错与本地平台制作。

**会得到什么：** 逐图部件及尺寸工程量、读图与计算依据、项目纠错案例、可复用规则候选和本地逐题审核平台执行要求。公开示例均为模拟数据，不附带客户图纸、价格或私有配置。

[打开技能说明](skills/cad-quote-review/README.md) · [阅读完整规则](skills/cad-quote-review/SKILL.md)

复制给同事的Agent：

```text
请从 GitHub 仓库 2025bh/YGX- 安装
skills/cad-quote-review 完整目录。
先读取 README.md 和 SKILL.md，再检查我自己的CAD、项目规则与工具。
```

---

## 项目源码：忆古轩项目交付系统

这是一套单独的[项目交付系统公开脱敏副本](project-delivery-system/README.md)，用于本地隔离演示和继续开发，**不计入上面的 3 个 Skill**。运行条件、演示范围和已实现功能都写在它自己的说明页。

## 项目源码：忆古轩报价审核纠错系统

这是一套单独的[报价审核纠错系统公开脱敏副本](quote-review-system/README.md)，**不计入上面的 3 个 Skill**。将整份AI报价与指定人工报价对比，先部件配对，再用差异题卡逐项确认，最后对照独立CAD图框清单查漏。支持一句话纠错、计算预览、保存续做、撤销、截图标记、同版CAD定位与18列导出。公开副本只带虚构练习数据，不含客户图纸、报价、真实单价或账号。

系统源码与Skill方法分开维护。CAD连接、局域网和老师傅使用效率仍需在使用者电脑实测；本地测试通过不等同业务上线。

## 使用与维护

- 安装 Skill 时保留其**整个目录**；只复制 `SKILL.md` 会漏掉引用规则、模板或脚本。
- Skill 提供工作规则和检查方法；原始素材、视觉模型、剪映、FFmpeg、账号及授权资源需在使用者自己的环境中准备。
- 新增 Skill 时，在 `skills/` 下建立独立目录和 `README.md`，并同步更新本页的数量、目录和独立介绍。


