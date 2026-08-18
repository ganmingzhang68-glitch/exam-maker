import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runQuestionGenerationFixture } from '../src/scripts/runQuestionGenerationE2E.js';
import { validateDocx } from '../src/services/exportArtifacts.js';

test('complete fixture reaches validated paper and audience-safe exports', async (t) => {
  const result = await runQuestionGenerationFixture();
  try {
    assert.equal(result.stages.length, 14);
    assert.deepEqual(result.stages.map((stage) => stage.status), Array(14).fill('succeeded'));
    assert.equal(result.alignments.length, 4);
    assert.ok(result.alignments.every((item) => item.alignmentStatus === 'matched' && !item.requiresTeacherReview));
    assert.equal(result.paper.questions.length, 4);
    assert.ok(result.paper.questions.every((question) => question.answer != null));
    assert.ok(result.paper.questions.filter((q) => ['calculation', 'essay'].includes(q.type)).every((q) => q.rubric?.items.reduce((sum, item) => sum + item.points, 0) === q.score));
    assert.equal(result.validation.passed, true);
    assert.equal(result.artifacts.length, 9);
    for (const artifact of result.artifacts) {
      assert.ok(existsSync(artifact.storagePath));
      const content = readFileSync(artifact.storagePath);
      if (artifact.format === 'docx') assert.ok(Object.values(validateDocx(content)).every(Boolean));
      if (artifact.audience === 'student') {
        const text = content.toString('utf8');
        assert.equal(text.includes('参考答案'), false);
        assert.equal(text.includes('评分标准'), false);
      }
      const integrity = JSON.parse(artifact.integrity) as { questionCount: number; totalScore: number };
      assert.equal(integrity.questionCount, 4); assert.equal(integrity.totalScore, 30);
    }
    const latexEngine = ['xelatex', 'lualatex'].find((engine) => spawnSync('where.exe', [engine], { encoding: 'utf8', windowsHide: true }).status === 0);
    if (latexEngine) {
      for (const artifact of result.artifacts.filter((item) => item.format === 'latex')) {
        const compiled = spawnSync(latexEngine, ['-interaction=nonstopmode', '-halt-on-error', `-output-directory=${result.outputDir}`, artifact.storagePath], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
        assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr);
        assert.ok(existsSync(`${artifact.storagePath.slice(0, -4)}.pdf`));
      }
      t.diagnostic(`LaTeX: ${latexEngine} actual compilation passed for 3 artifacts`);
    } else {
      t.diagnostic('LaTeX: xelatex/lualatex unavailable; source generated but compilation not claimed');
    }
    t.diagnostic(`artifacts: ${result.artifacts.map((item) => basename(item.storagePath)).join(', ')}`);
  } finally { delete process.env.EXPORT_STORAGE_DIR; rmSync(result.outputDir, { recursive: true, force: true }); }
});
