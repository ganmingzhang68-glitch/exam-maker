import assert from 'node:assert/strict';
import test from 'node:test';
import { isTooSimilar, questionSimilarity } from '../src/services/similarityValidator.js';

test('similarity normalizes number-only substitutions and punctuation', () => {
  const source = '已知函数 f(x)=x^2+3x，求 f\'(x)。';
  const copiedShape = '已知函数 f(x)=x^2+8x，求 f\'(x)！';
  assert.ok(questionSimilarity(source, copiedShape) >= 0.72);
  assert.equal(isTooSimilar(source, copiedShape), true);
});

test('similarity accepts a genuine change of task form', () => {
  const source = '已知函数 f(x)=x^2+3x，求 f\'(x)。';
  const transformed = '某物体位移满足二次函数。根据瞬时速度的几何意义，解释切线斜率如何随时间变化。';
  assert.ok(questionSimilarity(source, transformed) < 0.72);
  assert.equal(isTooSimilar(source, transformed), false);
});
