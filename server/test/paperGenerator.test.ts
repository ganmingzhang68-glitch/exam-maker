import assert from 'node:assert/strict';
import test from 'node:test';
import { escapeLatexText, isDifficultyDistributionFinding, parseLegacyGenerationSlots, questionHasUnstructuredSubquestions, renderBlocks, stripAnswerSections } from '../src/services/paperGenerator.js';

test('generation references exclude LaTeX answer and explanation sections', () => {
  const source = '\\section{试题}\n1. 新题面\n\\subsection{参考答案}\n1. A。答案解释';
  const sanitized = stripAnswerSections(source);
  assert.match(sanitized, /新题面/);
  assert.doesNotMatch(sanitized, /参考答案|答案解释/);
});

test('generation references exclude Markdown answer sections', () => {
  const source = '# 试题\n\n1. 新题面\n\n## 答案与解析\n\n1. A';
  const sanitized = stripAnswerSections(source);
  assert.match(sanitized, /新题面/);
  assert.doesNotMatch(sanitized, /答案与解析|1\. A/);
});

test('LaTeX rendering preserves inline math and escapes surrounding text', () => {
  const rendered = escapeLatexText('若 \\(l = 0\\)，比较 a_n 与 100% 的关系。');
  assert.match(rendered, /\\\(l = 0\\\)/);
  assert.doesNotMatch(rendered, /textbackslash/);
  assert.match(rendered, /100\\%/);
});

test('LaTeX rendering preserves display math instead of escaping its commands', () => {
  const rendered = escapeLatexText('标准化：$$\\hat{x}=\\frac{x-\\mu_B}{\\sqrt{\\sigma_B^2+\\varepsilon}}$$。');
  assert.match(rendered, /\$\$\\hat\{x\}=\\frac/);
  assert.doesNotMatch(rendered, /textbackslash|textasciicircum/);
});

test('table content is rendered as a LaTeX tabular instead of literal Markdown pipes', () => {
  const rendered = renderBlocks([{ type: 'table', content: '| 性质 | \\(f(x)\\) |\n|---|---|\n| 连续 | 是 |' }]);
  assert.match(rendered, /\\begin\{tabular\}/);
  assert.match(rendered, /\\\(f\(x\)\\\)/);
  assert.doesNotMatch(rendered, /^\|/m);
});

test('table rendering does not split LaTeX absolute-value bars into columns', () => {
  const rendered = renderBlocks([{ type: 'table', content: '| 范围 | 条件 |\n|---|---|\n| 全域 | \\(\\forall x,\\|f(x)|\\le M\\) |' }]);
  assert.match(rendered, /\\begin\{tabular\}\{\|l\|l\|\}/);
  assert.match(rendered, /\\\(\\forall x,\\\|f\(x\)\|\\le M\\\)/);
});

test('generation slots retain every knowledge point from the matching blueprint question', () => {
  const difficulty = JSON.stringify({ slots: [{ sectionType: 'short_answer', score: 10, difficulty: '中等' }] });
  const blueprint = JSON.stringify({ kp: ['不平衡学习', '高基数编码', '分类评估'], cognition: '应用' });
  const [slot] = parseLegacyGenerationSlots(difficulty, 1, blueprint);
  assert.deepEqual(slot.knowledgePointIds, ['不平衡学习', '高基数编码', '分类评估']);
});

test('only known target/actual difficulty distribution deviations are non-blocking', () => {
  assert.equal(isDifficultyDistributionFinding('DIFFICULTY_DISTRIBUTION_DEVIATION'), true);
  assert.equal(isDifficultyDistributionFinding('DIFFICULTY_DISTRIBUTION_VIOLATION'), true);
  assert.equal(isDifficultyDistributionFinding('DIFFICULTY_DISTRIBUTION_MISMATCH'), true);
  assert.equal(isDifficultyDistributionFinding('DIFFICULTY_MISMATCH'), true);
  assert.equal(isDifficultyDistributionFinding('RUBRIC_SCORE_MISMATCH'), false);
  assert.equal(isDifficultyDistributionFinding('QUESTION_DIFFICULTY_MISMATCH'), false);
  assert.equal(isDifficultyDistributionFinding('ANSWER_MISSING'), false);
});

test('detects numbered subquestions embedded in the main stem', () => {
  assert.equal(questionHasUnstructuredSubquestions({
    stem: [{ type: 'paragraph', content: '回答：\n(1) 第一问\n(2) 第二问', assetId: null }],
    subquestions: [],
  }), true);
  assert.equal(questionHasUnstructuredSubquestions({
    stem: [{ type: 'paragraph', content: '说明一个核心概念。', assetId: null }],
    subquestions: [],
  }), false);
});
