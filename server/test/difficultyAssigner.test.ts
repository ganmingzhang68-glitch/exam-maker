import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSlots } from '../src/services/difficultyAssigner.js';

test('large assessment questions remain one generation slot each', () => {
  const slots = buildSlots({
    sections: [{ type: 'proof', count: 4, pointsPerQuestion: 25 }],
  }, []);

  assert.equal(slots.length, 4);
  assert.deepEqual(slots.map(slot => slot.score), [25, 25, 25, 25]);
  assert.deepEqual(slots.map(slot => slot.questionIndex), [1, 2, 3, 4]);
});

test('generation-plan English difficulty levels are normalized', () => {
  const slots = buildSlots({
    sections: [{ type: 'proof', count: 3, pointsPerQuestion: 10 }],
  }, [
    { difficulty: 'basic', points: 10, no: '1' },
    { difficulty: 'medium', points: 10, no: '2' },
    { difficulty: 'hard', points: 10, no: '3' },
  ]);

  assert.deepEqual(slots.map(slot => slot.difficulty), ['基础', '中等', '难']);
});
