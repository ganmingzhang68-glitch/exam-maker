import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { db, initDb, schema } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { authMiddleware, generateToken, requireAuth } from '../src/middleware/auth.js';

test('query tokens are accepted only for project event and download endpoints', async () => {
  await initDb({ filePath: null }); runMigrations();
  db.insert(schema.users).values({ id: 1, username: 'teacher', email: 'query-token@test.local', passwordHash: 'x', role: 'teacher' }).run();
  const app = express(); app.use(authMiddleware);
  app.get('/api/private', requireAuth, (_req, res) => res.json({ success: true }));
  app.get('/api/projects/:id/events', requireAuth, (_req, res) => res.json({ success: true }));
  app.get('/api/projects/:id/download/:fileId', requireAuth, (_req, res) => res.json({ success: true }));
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`; const token = generateToken(1, 'teacher');
  try {
    assert.equal((await fetch(`${base}/api/private?token=${encodeURIComponent(token)}`)).status, 401);
    assert.equal((await fetch(`${base}/api/projects/1/events?token=${encodeURIComponent(token)}`)).status, 200);
    assert.equal((await fetch(`${base}/api/projects/1/download/2?token=${encodeURIComponent(token)}`)).status, 200);
    assert.equal((await fetch(`${base}/api/private`, { headers: { Authorization: `Bearer ${token}` } })).status, 200);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
