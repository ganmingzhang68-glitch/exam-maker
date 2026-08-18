import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { db, initDb, schema } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { buildDocumentChunks, selectChunksForStage } from '../services/documentChunking.js';
import { alignSourceQuestionAnswers } from '../services/answerAlignment.js';
import { createExportArtifact, type CanonicalExportPaper } from '../services/exportArtifacts.js';
import { finishGenerationStage, getAiRunMetrics, getGenerationJobChain, startGenerationStage } from '../services/generationJobService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const defaultFixtureDir = join(__dirname, '..', '..', 'test', 'fixtures', 'question-generation');
const stages = ['document_extraction','exam_structure_parsing','question_answer_alignment','question_normalization','knowledge_taxonomy_building','question_classification','exam_template_extraction','historical_blueprint_generation','target_blueprint_creation','paper_generation_planning','question_generation','answer_and_rubric_generation','paper_validation','paper_export'] as const;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

function recordStage(jobId: number, stage: string, input: unknown, output: unknown) { const run = startGenerationStage(jobId, stage, input); finishGenerationStage(run.id, output); return run; }

export async function runQuestionGenerationFixture(options: { fixtureDir?: string; outputDir?: string } = {}) {
  const fixtureDir = options.fixtureDir ?? defaultFixtureDir;
  const outputDir = options.outputDir ?? mkdtempSync(join(tmpdir(), 'question-generation-e2e-'));
  const examPath = join(fixtureDir, 'exam.md'); const answerPath = join(fixtureDir, 'answers.md');
  const examText = readFileSync(examPath, 'utf8'); const answerText = readFileSync(answerPath, 'utf8');
  await initDb({ filePath: null }); runMigrations(); process.env.EXPORT_STORAGE_DIR = outputDir;
  db.insert(schema.users).values({ id: 1, username: 'fixture-teacher', email: 'fixture@example.test', passwordHash: 'fixture', role: 'teacher' }).run();
  db.insert(schema.courses).values({ id: 1, ownerUserId: 1, name: '脱敏综合课程', status: 'active' }).run();
  db.insert(schema.projects).values({ id: 1, title: '结构化出题 E2E', course: '脱敏综合课程', courseId: 1, userId: 1, nSets: 1 }).run();
  db.insert(schema.generationJobs).values({ id: 1, projectId: 1, courseId: 1, requestedBy: 1, pipelineVersion: 'fixture-e2e@1', numberOfSets: 1 }).run();
  db.insert(schema.sourceDocuments).values([
    { id: 1, projectId: 1, courseId: 1, documentKind: 'exam', filename: 'exam.md', storagePath: examPath, mimeType: 'text/markdown', sha256: hash(examText), pageCount: 2, status: 'extracted' },
    { id: 2, projectId: 1, courseId: 1, documentKind: 'answer', filename: 'answers.md', storagePath: answerPath, mimeType: 'text/markdown', sha256: hash(answerText), pageCount: 2, status: 'extracted' },
  ]).run();
  const pages = examText.split(/# 第 2 页/).map((text, index) => ({ pageNumber: index + 1, text }));
  const chunks = buildDocumentChunks(1, pages, { targetTokens: 80, overlapBlocks: 1 });
  const batches = selectChunksForStage(chunks, 'question_parsing', 'fixture prompt', 3600);
  recordStage(1, 'document_extraction', { documentIds: [1, 2] }, { pageCount: 4, textHashes: [hash(examText), hash(answerText)] });
  recordStage(1, 'exam_structure_parsing', { chunkIds: chunks.map((c) => c.id) }, { batches: batches.length, sections: 3, questionCount: 4 });
  db.insert(schema.sourceExams).values({ id: 1, courseId: 1, sourceDocumentId: 1, title: '脱敏综合能力测试', totalScore: 30, durationMinutes: 60, status: 'parsed' }).run();
  const sourceQuestionRows = [
    { id: 1, pageStart: 1, originalQuestionNo: '1', rawStem: '若集合 A={1,2}，则元素个数为多少？', questionType: 'single_choice', options: JSON.stringify(['A.1','B.2','C.3','D.4']), originalScore: 5 },
    { id: 2, pageStart: 1, originalQuestionNo: '2', rawStem: '下列哪些是偶数？', questionType: 'multiple_choice', options: JSON.stringify(['A.1','B.2','C.3','D.4']), originalScore: 5 },
    { id: 3, pageStart: 2, originalQuestionNo: '3', rawStem: '计算 $\\int_0^1 2x\\,dx$。', questionType: 'calculation', originalScore: 10 },
    { id: 4, pageStart: 2, originalQuestionNo: '4', rawStem: '阅读材料并回答两个子题。', questionType: 'material', subquestions: JSON.stringify([{ no: '4(1)', score: 4 }, { no: '4(2)', score: 6 }]), originalScore: 10 },
  ];
  db.insert(schema.sourceQuestions).values(sourceQuestionRows.map((q) => ({ ...q, sourceExamId: 1, sourceDocumentId: 1, pageEnd: q.pageStart, extractionConfidence: 0.98, status: 'parsed' }))).run();
  const answers = ['B','B,D','1','（1）明确目标、约束和步骤。（2）记录风险、处置与结果。'];
  db.insert(schema.sourceAnswerCandidates).values(answers.map((answer, index) => ({ id: index + 1, sourceDocumentId: 2, page: index < 2 ? 1 : 2, rawNumber: String(index + 1), normalizedNumber: String(index + 1), answerType: index < 2 ? 'choice' : 'worked', answerContent: answer, explanationContent: index < 2 ? 'fixture explanation' : 'fixture solution', sourceText: `${index + 1}. ${answer}`, extractionConfidence: 0.99 }))).run();
  const alignments = await alignSourceQuestionAnswers(1, [1,2,3,4], [1,2,3,4], { maxRetries: 0, transport: async () => ({ text: JSON.stringify({ status: 'ok', alignments: sourceQuestionRows.map((q) => ({ questionTemporaryId: String(q.id), answerCandidateId: String(q.id), alignmentStatus: 'aligned', rawAnswer: answers[q.id - 1], rawAnalysis: null, confidence: 0.99, evidence: [{ sourceDocumentId: 2, pageNumber: q.pageStart, blockId: null, quote: `${q.id}. ${answers[q.id - 1]}` }], reason: '规范化题号及子题结构一致' })), issues: [] }), inputTokens: 420, outputTokens: 240, totalTokens: 660 }) });
  recordStage(1, 'question_normalization', { sourceQuestionIds: [1,2,3,4] }, { normalized: 4, preservedFormula: true, preservedSubquestions: true });
  db.insert(schema.knowledgePoints).values([{ id: 1, courseId: 1, code: 'KP-SET', name: '集合基础', status: 'confirmed' }, { id: 2, courseId: 1, code: 'KP-CALC', name: '积分计算', status: 'confirmed' }, { id: 3, courseId: 1, code: 'KP-ARG', name: '材料分析', status: 'confirmed' }]).run();
  recordStage(1, 'knowledge_taxonomy_building', { courseId: 1 }, { knowledgePointIds: [1,2,3] });
  for (const [index, kp] of [1,1,2,3].entries()) db.insert(schema.questionClassifications).values({ questionKind: 'source', sourceQuestionId: index + 1, knowledgePointId: kp, role: 'primary', cognitiveLevel: index < 2 ? 'remember' : 'apply', difficultyLevel: index < 2 ? 'basic' : 'medium', difficultyScore: index < 2 ? 0.25 : 0.55, difficultySource: 'predicted', difficultyReason: 'fixture deterministic classification', confidence: 0.95, status: 'confirmed' }).run();
  recordStage(1, 'question_classification', { sourceQuestionIds: [1,2,3,4] }, { classified: 4, difficultySource: 'predicted' });
  db.insert(schema.examTemplates).values({ id: 1, courseId: 1, projectId: 1, name: '综合结构', assessmentTemplate: JSON.stringify({ totalScore: 30, durationMinutes: 60, sections: [{ type: 'single_choice', count: 1, score: 5 }, { type: 'multiple_choice', count: 1, score: 5 }, { type: 'subjective', count: 2, score: 20 }] }), renderingTemplate: JSON.stringify({ title: '脱敏综合能力测试' }), sourceExamIds: '[1]', status: 'confirmed' }).run();
  recordStage(1, 'exam_template_extraction', { sourceExamId: 1 }, { examTemplateId: 1, totalScore: 30 });
  db.insert(schema.blueprints).values([{ id: 1, courseId: 1, projectId: 1, kind: 'historical', totalScore: 30, sourceExamIds: '[1]', status: 'confirmed' }, { id: 2, courseId: 1, projectId: 1, kind: 'target', totalScore: 30, historicalBlueprintId: 1, isTeacherConfirmed: true, status: 'confirmed' }]).run();
  recordStage(1, 'historical_blueprint_generation', { sourceExamId: 1 }, { historicalBlueprintId: 1, totalScore: 30 });
  recordStage(1, 'target_blueprint_creation', { historicalBlueprintId: 1 }, { targetBlueprintId: 2, teacherConfirmed: true });
  db.insert(schema.generationPlans).values({ id: 1, projectId: 1, courseId: 1, examTemplateId: 1, targetBlueprintId: 2, numberOfSets: 1, totalScorePerSet: 30, isTeacherConfirmed: true, status: 'confirmed' }).run();
  const planTypes = ['single_choice','multiple_choice','calculation','essay']; const scores = [5,5,10,10];
  db.insert(schema.generationPlanItems).values(planTypes.map((type, index) => ({ id: index + 1, generationPlanId: 1, slotKey: `slot-${index + 1}`, setNo: 1, sectionId: index < 2 ? 'objective' : 'subjective', orderNo: index + 1, knowledgePointIds: JSON.stringify([[1],[1],[2],[3]][index]), questionType: type, score: scores[index], difficulty: JSON.stringify({ level: index < 2 ? 'basic' : 'medium', score: index < 2 ? .25 : .55, source: 'predicted' }), cognitiveLevel: index < 2 ? 'remember' : 'apply', expectedAnswerKind: index < 2 ? 'choice' : 'worked', contentRequirements: JSON.stringify({ formula: index === 2, material: index === 3 }) }))).run();
  recordStage(1, 'paper_generation_planning', { targetBlueprintId: 2 }, { generationPlanId: 1, slots: 4, totalScore: 30 });
  db.insert(schema.promptVersions).values({ id: 99, key: 'fixture-deterministic-generator', promptId: 'fixture-deterministic-generator', version: '1.0.0', stage: 'question_generation', pipelineStage: 'question_generation', template: 'No AI: deterministic fixture', inputSchemaVersion: 'fixture-1', outputSchemaVersion: 'fixture-1', sha256: hash('fixture'), templateHash: hash('fixture'), schemaHash: hash('fixture-schema'), status: 'test' }).run();
  const generated = [
    { id: 11, questionType: 'single_choice', stem: '集合 {a,b,c} 的元素个数是？', options: [{ id: 'A', content: '2' }, { id: 'B', content: '3' }, { id: 'C', content: '4' }], score: 5, answer: { kind: 'single_choice', optionId: 'B' }, explanation: '共有三个元素。' },
    { id: 12, questionType: 'multiple_choice', stem: '下列哪些数能被 3 整除？', options: [{ id: 'A', content: '3' }, { id: 'B', content: '4' }, { id: 'C', content: '6' }], score: 5, answer: { kind: 'multiple_choice', optionIds: ['A','C'] }, explanation: '3 和 6 符合。' },
    { id: 13, questionType: 'calculation', stem: '计算 $\\int_0^2 x\\,dx$。', score: 10, answer: { kind: 'worked', content: '$[x^2/2]_0^2=2$' }, explanation: '代入上下限。', rubric: { totalScore: 10, items: [{ description: '写出原函数', points: 4 }, { description: '正确代入并得出 2', points: 6 }] } },
    { id: 14, questionType: 'essay', stem: '阅读新的项目复盘材料：（1）概括目标；（2）说明风险记录价值。', score: 10, answer: { kind: 'essay', content: '目标用于统一方向；风险记录支持追踪与改进。' }, explanation: '按两个子题作答。', rubric: { totalScore: 10, items: [{ description: '目标概括准确', points: 4 }, { description: '风险价值说明完整', points: 6 }] } },
  ];
  db.insert(schema.generatedQuestions).values(generated.map((q, index) => ({ id: q.id, generationPlanId: 1, generationPlanItemId: index + 1, setNo: 1, questionType: q.questionType, stem: JSON.stringify(q.stem), options: q.options ? JSON.stringify(q.options) : null, score: q.score, answer: JSON.stringify(q.answer), explanation: JSON.stringify(q.explanation), knowledgePointIds: JSON.stringify([[1],[1],[2],[3]][index]), cognitiveLevel: index < 2 ? 'remember' : 'apply', difficulty: JSON.stringify({ level: index < 2 ? 'basic' : 'medium', source: 'predicted' }), provider: 'deterministic-fixture', model: 'none', promptVersionId: 99, generationParameters: JSON.stringify({ fixture: true }), status: 'generated' }))).run();
  recordStage(1, 'question_generation', { generationPlanId: 1 }, { generatedQuestionIds: generated.map((q) => q.id), provider: 'deterministic-fixture' });
  for (const q of generated.filter((item) => item.rubric)) db.insert(schema.rubrics).values({ generatedQuestionId: q.id, totalScore: q.score, items: JSON.stringify(q.rubric!.items), provider: 'deterministic-fixture', model: 'none', promptVersionId: 99, generationParameters: '{"fixture":true}', status: 'validated' }).run();
  recordStage(1, 'answer_and_rubric_generation', { generatedQuestionIds: generated.map((q) => q.id) }, { answers: 4, rubrics: 2, rubricScoreValid: true });
  const canonical: CanonicalExportPaper = { id: 1, version: 1, title: '脱敏综合课程新卷', durationMinutes: 60, totalScore: 30, instructions: ['请独立作答'], questions: generated.map((q, index) => ({ number: String(index + 1), type: q.questionType, score: q.score, stem: q.stem, options: q.options, answer: q.answer, explanation: q.explanation, rubric: q.rubric ?? null })) };
  db.insert(schema.generatedPapers).values({ id: 1, generationPlanId: 1, generationJobId: 1, courseId: 1, title: canonical.title, totalScore: 30, durationMinutes: 60, canonicalJson: JSON.stringify(canonical), selectedAt: new Date().toISOString(), status: 'selected' }).run();
  db.insert(schema.blueprints).values({ id: 3, courseId: 1, projectId: 1, kind: 'actual', totalScore: 30, targetBlueprintId: 2, generatedPaperId: 1, status: 'generated' }).run();
  db.update(schema.generatedPapers).set({ actualBlueprintId: 3 }).where(eq(schema.generatedPapers.id, 1)).run();
  const findings: Array<{ severity: string; message: string }> = [];
  if (generated.reduce((sum, q) => sum + q.score, 0) !== 30) findings.push({ severity: 'critical', message: '总分不一致' });
  if (generated.some((q) => !q.answer)) findings.push({ severity: 'critical', message: '缺少答案' });
  if (generated.filter((q) => ['calculation','essay'].includes(q.questionType)).some((q) => !q.rubric || q.rubric.items.reduce((sum, item) => sum + item.points, 0) !== q.score)) findings.push({ severity: 'critical', message: 'Rubric 分值不一致' });
  db.insert(schema.validationReports).values({ id: 1, generatedPaperId: 1, targetBlueprintId: 2, actualBlueprintId: 3, passed: findings.length === 0, findings: JSON.stringify(findings), metrics: JSON.stringify({ targetActualScoreDeviation: 0, questionCount: 4 }), validatorVersion: 'deterministic@1', status: findings.length ? 'blocked' : 'passed' }).run();
  db.update(schema.generatedPapers).set({ validationReportId: 1 }).where(eq(schema.generatedPapers.id, 1)).run();
  recordStage(1, 'paper_validation', { generatedPaperId: 1, targetBlueprintId: 2 }, { validationReportId: 1, blockingErrors: findings.length });
  const artifacts = [];
  for (const format of ['markdown','latex','docx'] as const) {
    artifacts.push(createExportArtifact(canonical, 'question_paper', 'student', format));
    artifacts.push(createExportArtifact(canonical, 'answer_key', 'teacher', format));
    artifacts.push(createExportArtifact(canonical, 'rubric', 'grader', format));
  }
  recordStage(1, 'paper_export', { generatedPaperId: 1 }, { artifactIds: artifacts.map((a) => a.id), formats: ['markdown','latex','docx'], latexCompiled: false });
  db.update(schema.generationJobs).set({ status: 'succeeded', currentStage: null, lastSuccessfulStage: 'paper_export' }).where(eq(schema.generationJobs.id, 1)).run();
  const chain = getGenerationJobChain(1); const metrics = getAiRunMetrics(1);
  return { fixtureDir, outputDir, input: { examPath, answerPath }, chunks: { count: chunks.length, batches: batches.length }, alignments, paper: canonical, validation: { passed: findings.length === 0, findings }, artifacts, stages: chain.stages.map((s) => ({ stage: s.stage, status: s.status })), metrics, latex: { compiled: false, reason: 'compile check performed separately by E2E test' } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runQuestionGenerationFixture().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(error); process.exitCode = 1; });
}
