# Assessment Metrics

所有考试测量指标由确定性 TypeScript 代码计算，不调用 LLM。当前统计单位是学生：如允许多次作答，每名学生只使用最近一次已完成批改的作答，避免同一学生重复增加样本权重。未完成主观题批改的作答不进入样本。

## 配置

默认最低样本量为 5，高低分组各取 27%，及格线为总分的 60%。配置集中在 `server/src/config/assessment.ts`，可通过 `ASSESSMENT_MIN_SAMPLE_SIZE`、`ASSESSMENT_HIGH_LOW_PROPORTION` 和 `ASSESSMENT_PASSING_SCORE_RATE` 等环境变量调整。

## 指标

- `correct rate`：客观题答对学生数 / 有效学生样本数。空答按未答对计。
- `empirical difficulty`：`1 - correct rate`，数值越高表示实际越难。它与模型预测难度是不同字段。
- `discrimination index`：高分组正确率减低分组正确率，即 `D = P_high - P_low`。
- `point-biserial`：客观题 0/1 得分与“扣除该题后的总分”的 Pearson 相关，降低题目自身抬高相关性的影响。
- `Cronbach alpha`：`k/(k-1) * (1 - 各题得分方差之和 / 总分方差)`。使用样本方差。
- 标准差使用样本标准差；中位数按排序后的中点计算。

## 不确定性

样本少于配置阈值时，区分度、点二列和 Cronbach α 返回 `null`，状态为 `insufficient_sample`，UI 显示“样本不足，仅供参考”。系统不会用 0 替代未知指标，也不会将统计标记直接描述为“坏题”。

题目、分值与题序取自考试 attempt snapshot；后续题库编辑不会改写历史考试口径。
