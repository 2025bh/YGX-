# 数据与证据约定

根对象含 `rows` 数组。每项包含 `figure`、`name`、`region`、`unit`、`height`、`length`、`width`、`thickness`、`quantity`、`material`、`price`、`risk`、`calc_mode`；不适用尺寸为null。毫米尺寸、米总长、平方米面积分别存储，不能只保存两位显示值。

计算模式为 `rect`、`length`、`count`、`manual` 或 `pending`；B端自动方法需要 `confirmed_rect`、`confirmed_length`、`confirmed_count`。人工工程量用 `area` 或 `total_length`，保留读图及计算说明。`minimum_area` 只代表这一个对象已经明确确认的最低面积。

私有证据索引至少含项目ID、图纸版本哈希、正式图号、图框/视图范围、对象句柄、标注/量测来源、采用值与冲突。截图标记使用归一化坐标，并保存资产ID、报价行ID及行版本；公开数据不能带这些源索引。

AI快照、人工快照不可变；当前采用稿和纠错历史分别存。版本冲突时先回读，不用最后一次提交静默覆盖。规则候选须说明适用C端/B端/共同规范或本项目，保存案例不等于完成训练。
