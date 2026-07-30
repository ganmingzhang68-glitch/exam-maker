import { rawDb } from './index.js';

export function runMigrations() {
  rawDb.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'teacher' CHECK(role IN ('teacher','admin')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  rawDb.run(`CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    course TEXT NOT NULL,
    scope TEXT,
    difficulty TEXT NOT NULL DEFAULT '{"basic":60,"medium":30,"hard":10}',
    n_sets INTEGER NOT NULL DEFAULT 8,
    output_type TEXT NOT NULL DEFAULT 'latex' CHECK(output_type IN ('latex','docx','md')),
    verify_mode TEXT NOT NULL DEFAULT 'auto' CHECK(verify_mode IN ('auto','computational','conceptual','mixed')),
    status TEXT NOT NULL DEFAULT 'drafting',
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  rawDb.run(`CREATE TABLE IF NOT EXISTS project_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    filename TEXT NOT NULL,
    filepath TEXT NOT NULL,
    metadata TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  rawDb.run(`CREATE TABLE IF NOT EXISTS checkpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    step TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    teacher_notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  rawDb.run(`CREATE TABLE IF NOT EXISTS job_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    step TEXT NOT NULL,
    event_type TEXT NOT NULL,
    message TEXT NOT NULL,
    data TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  console.log('✅ Database tables verified');
}
