# AI 难度校准

## 数据方向

- `predicted_difficulty`：AI 生成题目时给出的预测难度，0 表示容易、1 表示困难。
- `teacher_difficulty`：教师人工调整值，方向与预测难度一致。
- `empirical_difficulty`：实际考试统计难度，定义为 `1 - correct_rate`。

系统不会用后续统计覆盖原始 AI 预测。每次满足统计样本要求的“考试-题目”组合会形成一条 `DifficultyCalibrationRecord`，记录生成时的预测快照、教师调整值、实际难度和样本量。

## 题目级判定

误差定义为：

```text
prediction_error = predicted_difficulty - empirical_difficulty
```

- 绝对误差不超过 `ASSESSMENT_CALIBRATION_TOLERANCE`（默认 0.10）：基本准确。
- 误差大于阈值：AI 高估难度。
- 误差小于负阈值：AI 低估难度。
- 缺少原始 AI 预测：不作判定。

教师调整值仅用于对照，不反向覆盖原始预测。

## 课程级指标

- MAE：绝对误差均值。
- RMSE：均方根误差。
- bias：`predicted - empirical` 的平均值；正值表示整体高估，负值表示整体低估。

至少需要 `ASSESSMENT_MIN_CALIBRATION_RECORDS`（默认 10）条包含 AI 预测的有效记录。样本不足时，API 和页面保留题目级历史，但 MAE、RMSE 和 bias 返回空值，并显示“当前课程数据不足，暂不进行自动校准”。

## 接口与页面

- `GET /api/courses/:id/difficulty-calibration`：课程所有者或管理员读取校准结果。
- 教师课程详情 → “AI 难度校准”：查看汇总和题目级对照。
- 题目编辑页 → “教师难度 (0-1)”：录入教师调整值；AI 原始预测只读显示。
