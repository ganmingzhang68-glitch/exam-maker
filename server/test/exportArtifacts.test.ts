import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExportArtifact, renderDocx, renderLatex, renderMarkdown, validateDocx, type CanonicalExportPaper } from '../src/services/exportArtifacts.js';
import { initDb, db, schema } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';

const paper: CanonicalExportPaper = {
  id: 1, version: 1, title: '脱敏测试卷', durationMinutes: 60, totalScore: 10, instructions: [],
  questions: [{ number: '1', type: 'calculation', score: 10, stem: '计算 $x^2$', answer: 'SECRET_ANSWER', explanation: 'HIDDEN_EXPLANATION', rubric: { totalScore: 10, items: [{ description: 'SCORING_ITEM', points: 10 }] } }],
};

test('student renderings from one canonical paper contain no answer or rubric fields', () => {
  const markdown = renderMarkdown(paper, 'question_paper', 'student');
  const latex = renderLatex(paper, 'question_paper', 'student');
  const docx = renderDocx(paper, 'question_paper', 'student');
  for (const content of [markdown, latex, docx.toString('utf8')]) {
    assert.equal(content.includes('SECRET_ANSWER'), false);
    assert.equal(content.includes('HIDDEN_EXPLANATION'), false);
    assert.equal(content.includes('SCORING_ITEM'), false);
  }
  assert.deepEqual(validateDocx(docx), { validZip: true, requiredParts: true, xmlDocument: true });
  assert.throws(() => renderMarkdown(paper, 'answer_key', 'student'));
});

test('artifact storage uses opaque names and records content validation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'exam-export-'));
  process.env.EXPORT_STORAGE_DIR = directory;
  try {
    await initDb({ filePath: null }); runMigrations();
    db.insert(schema.users).values({ id: 1, username: 't', email: 't@x.test', passwordHash: 'x', role: 'teacher' }).run();
    db.insert(schema.courses).values({ id: 1, ownerUserId: 1, name: '测试课' }).run();
    db.insert(schema.projects).values({ id: 1, title: 'p', course: '测试课', courseId: 1, userId: 1 }).run();
    db.insert(schema.generationJobs).values({ id: 1, projectId: 1, courseId: 1, requestedBy: 1, pipelineVersion: 'test' }).run();
    db.insert(schema.generatedPapers).values({ id: 1, generationJobId: 1, courseId: 1, title: paper.title, totalScore: 10, canonicalJson: JSON.stringify(paper), selectedAt: new Date().toISOString() }).run();
    const artifact = createExportArtifact(paper, 'question_paper', 'student', 'docx');
    assert.equal(artifact.storagePath.includes('answer'), false);
    assert.match(artifact.storagePath, /[0-9a-f-]{36}\.docx$/);
    assert.deepEqual(validateDocx(readFileSync(artifact.storagePath)), { validZip: true, requiredParts: true, xmlDocument: true });
    assert.equal(artifact.validationStatus, 'passed');
  } finally { delete process.env.EXPORT_STORAGE_DIR; rmSync(directory, { recursive: true, force: true }); }
});
