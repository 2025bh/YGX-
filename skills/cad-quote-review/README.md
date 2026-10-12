# CAD报价识别与纠错技能

`cad-quote-review` 把家具CAD报价中的分项、尺寸复核、算量和老师傅纠错整理成可携带的工作规则，同时给出本地审核平台的制作方法。

## 用途与使用场景

- 给一张截图和同版DWG/DXF，找出对应图号，核实部件、尺寸和工程量。
- 检查整柜、见光板、格栅门、藤编等部件或工艺是否漏项。
- 比较AI原稿与人工报价，逐项解释尺寸、单位、漏项、多项及价格差异。
- 把截图、错误理由、正确读图方法和计价方法保存成项目案例或待适配规则。
- 制作老师傅与销售可使用的本地报价审核工作台。

## 交付内容

技能目录含执行规则、详细报价规则、平台工作流程、数据契约、脱敏发布说明、模拟输入、确定性算量和模拟化脚本。

本技能不附带真实客户报价、CAD图纸、图片、账号、密钥、作者本机配置或商业识别模型。安装技能不会自动安装AutoCAD或启动识别训练。

## 安装方法

把完整的 `skills/cad-quote-review/` 目录安装到你的Agent技能目录，保留 `references/`、`assets/` 和 `scripts/`。

可以复制给Codex：

```text
请从 https://github.com/2025bh/YGX- 安装 skills/cad-quote-review 完整目录。
先读取该目录的 README.md 和 SKILL.md，再检查我自己的项目目录、规则库、CAD版本和可用工具。
```

安装后可说：

```text
用 $cad-quote-review 检查我提供的同版DWG/DXF。
先独立生成部件、尺寸和工程量，单价留空；再按我指定的人工报价逐项对比。
```

## 必要工具

运行算量和模拟化脚本需要Python 3.10或以上，仅使用标准库。核验DWG需要使用者自己的AutoCAD或可信DWG读取工具；DXF解析工具只作辅助。网页平台开发建议Node.js、React、Python、FastAPI和SQLite，现有项目可沿用兼容技术栈。

```text
python skills/cad-quote-review/scripts/test_calculate_quote.py
python skills/cad-quote-review/scripts/calculate_quote.py skills/cad-quote-review/assets/demo-quote.json <新的输出JSON>
python skills/cad-quote-review/scripts/sanitize_quote.py <私有JSON> <新的公开模拟JSON>
```

所有路径来自调用参数或当前项目配置。公开示例的部件名称、尺寸与单价为构造数据，不能用于实际核价。
