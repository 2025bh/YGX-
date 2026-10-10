# 家具短视频制作 Skill

为家具品牌号、工厂员工号、门店案例与清货账号复用的制作规则。覆盖项目账号隔离、参考分析、自有素材筛选、文案匹配、配音换音色、独立字幕与剪映可编辑交付。

## 安装入口

[produce-furniture-video](https://github.com/2025bh/YGX-/tree/main/skills/produce-furniture-video)

复制给同事的Agent：

```text
请从 https://github.com/2025bh/YGX-/tree/main/skills/produce-furniture-video 安装 produce-furniture-video。
然后阅读 https://github.com/2025bh/YGX-/blob/main/docs/colleague-handoff.md，核对我的项目账号、本机素材和剪映环境后执行；不要假设作者电脑文件可用，不自动发布。
```

Codex系统skill-installer支持：

```text
python <skill-installer>/scripts/install-skill-from-github.py --repo 2025bh/YGX- --path skills/produce-furniture-video
```

`<skill-installer>`由接收Agent定位，不是作者机器的固定路径。已有同名Skill先核对版本，不覆盖。其他Agent按其Skill规范安装完整子目录；只下载SKILL.md会缺参考规则和校验工具。

## 同事交接

[项目方案与完整规则](docs/colleague-handoff.md)可单独发送给没有作者本地文件的Agent。

最新标准：9:16源和输出、普通镜头1.5至4秒、原片不重复、仅不同产品列举可快切、每条文字独立。当前旁白路线为真人播客女文本朗读后对音频换为春燕；春燕账号音色不包含在仓库中。

## 能力边界

这是方法、模板和计划校验工具，不是剪映/FFmpeg安装包或全自动剪辑软件。素材、参考视频、音乐许可、剪映账户/订阅、声音模型及作者私有后端均未上传。使用接收方已有工具；无兼容草稿导出器可用剪映UI执行。生成工程包、索引登记和原生编辑保存重开分别验收，不用规则安装成功冒充成片验证。

计划校验及15项自测仅需Python标准库，代码在Skill子目录`scripts/`。它们检查声明的计划，不证明真实画面、声音或剪映原生兼容。

版本1.0.0，2026-10-10。
