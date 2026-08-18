import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:5173';
const username = process.env.E2E_TEACHER_USERNAME || 'test_teacher';
const password = process.env.E2E_TEACHER_PASSWORD || 'Teacher123!';
const fixturePath = resolve(process.env.E2E_QUESTION_FIXTURE || 'server/test/fixtures/similar-question-basic.md');
const edgePath = process.env.E2E_BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const timeoutMs = Number(process.env.E2E_AI_TIMEOUT_MS || 720000);

assert.ok(existsSync(fixturePath), `fixture missing: ${fixturePath}`);
assert.ok(existsSync(edgePath), `browser missing: ${edgePath}`);

const browser = await chromium.launch({ executablePath: edgePath, headless: true });
const page = await browser.newPage();

try {
  await page.goto(`${baseUrl}/questions/generate`);
  if (page.url().includes('/login') || await page.getByPlaceholder('用户名').count()) {
    await page.getByPlaceholder('用户名').fill(username);
    await page.getByPlaceholder('密码').fill(password);
    await page.getByRole('button', { name: '登 录' }).click();
  }
  await page.waitForURL(/\/questions\/generate/);
  await page.getByLabel('课程名称').fill('机器学习 E2E');
  await page.getByLabel('课程范围（可选）').fill('类别不平衡与类别特征编码');
  await page.locator('input[type=file]').setInputFiles(fixturePath);
  await page.waitForFunction(() => {
    const textarea = document.querySelector('textarea');
    return Boolean(textarea && textarea.value.length > 20);
  });

  const createResponsePromise = page.waitForResponse(response =>
    response.url().includes('/api/similar-question-jobs') &&
    response.request().method() === 'POST' &&
    !response.url().endsWith('/retry') && !response.url().endsWith('/save'));
  await page.getByRole('button', { name: '开始生成类似题目' }).click();
  const createResponse = await createResponsePromise;
  assert.equal(createResponse.status(), 202);
  const created = await createResponse.json();
  const jobId = Number(created.data.id);
  assert.ok(jobId > 0);

  const deadline = Date.now() + timeoutMs;
  let job;
  while (Date.now() < deadline) {
    job = await page.evaluate(async id => {
      const token = localStorage.getItem('token');
      return await (await fetch(`/api/similar-question-jobs/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })).json();
    }, jobId);
    if (['succeeded', 'failed'].includes(job.data.status)) break;
    await page.waitForTimeout(2000);
  }
  assert.ok(job, 'job was never returned');
  assert.notEqual(job.data.status, 'failed', job.data.errorSummary || 'similar-question job failed');
  assert.equal(job.data.status, 'succeeded', `job did not finish before ${timeoutMs}ms`);
  assert.ok(job.data.result.items.length >= 1);
  assert.ok(job.data.result.items.every(item => item.validation.passed));
  assert.ok(job.data.result.items.every(item => item.rubric.totalScore === item.score));
  assert.ok(job.data.result.items.every(item => item.originality.similarity < 0.72));

  await page.waitForFunction(id => document.body.innerText.includes(`任务 #${id}`) && document.body.innerText.includes('succeeded'), jobId);
  const saveResponsePromise = page.waitForResponse(response =>
    response.url().endsWith(`/api/similar-question-jobs/${jobId}/save`) && response.request().method() === 'POST');
  await page.getByRole('button', { name: /保存所选题目到 AI 题目审核/ }).click();
  const saveResponse = await saveResponsePromise;
  assert.equal(saveResponse.status(), 200);
  const saved = await saveResponse.json();

  await page.getByText('AI 题目审核', { exact: true }).click();
  await page.waitForURL(/\/questions\/review/);
  await page.waitForFunction(id => document.body.innerText.includes(`快速仿题 #${id}`), jobId);
  console.log(JSON.stringify({
    success: true,
    jobId,
    generatedCount: job.data.result.items.length,
    savedQuestionIds: saved.data.result.items.map(item => item.savedQuestionId),
  }));
} finally {
  await browser.close();
}
