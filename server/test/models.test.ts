import assert from 'node:assert/strict';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { initialMigration } from '../src/db/migrations/001_initial.js';
import { runMigrations } from '../src/db/migrate.js';

test('foundation migration preserves old users and projects', async () => {
  const SQL = await initSqlJs();
  const database = new SQL.Database();
  initialMigration.up(database);
  database.run("INSERT INTO users(id, username, email, password_hash, role) VALUES (7, 'legacy_teacher', 'legacy@example.com', 'hash', 'teacher')");
  database.run("INSERT INTO projects(id, title, course, user_id) VALUES (9, 'Legacy', 'Math', 7)");

  runMigrations(database);

  assert.deepEqual(database.exec('SELECT id, username, role FROM users')[0].values, [[7, 'legacy_teacher', 'teacher']]);
  assert.deepEqual(database.exec('SELECT id, user_id FROM projects')[0].values, [[9, 7]]);
  const tables = new Set(database.exec("SELECT name FROM sqlite_master WHERE type='table'")[0].values.flat().map(String));
  for (const name of ['questions', 'papers', 'paper_questions', 'exams', 'exam_assignments', 'attempts', 'answers']) {
    assert.ok(tables.has(name), `missing table ${name}`);
  }
  assert.equal(database.exec('PRAGMA foreign_key_check').length, 0);
  database.close();
});

test('model statuses, role checks and assignment uniqueness are enforced', async () => {
  const SQL = await initSqlJs();
  const database = new SQL.Database();
  runMigrations(database);
  database.run("INSERT INTO users(id, username, email, password_hash, role) VALUES (1, 'teacher', 't@example.com', 'x', 'teacher')");
  database.run("INSERT INTO users(id, username, email, password_hash,role) VALUES (2, 'student', 's@example.com', 'x', 'student')");
  database.run("INSERT INTO questions(id, created_by, type, stem, status) VALUES (1, 1, 'true_false', '1+1=2', 'generated')");
  database.run("INSERT INTO papers(id, created_by, title, course, status) VALUES (1, 1, 'P1', 'Math', 'ready')");
  database.run("INSERT INTO paper_questions(id, paper_id, question_id, order_no, score) VALUES (1, 1, 1, 1, 5)");
  database.run("INSERT INTO exams(id, paper_id, created_by, title, status) VALUES (1, 1, 1, 'E1', 'published')");
  database.run("INSERT INTO exam_assignments(id, exam_id, student_id) VALUES (1, 1, 2)");
  database.run("INSERT INTO attempts(id, exam_id, assignment_id, student_id, status) VALUES (1, 1, 1, 2, 'not_started')");
  database.run("INSERT INTO answers(attempt_id, paper_question_id, grading_status) VALUES (1, 1, 'ungraded')");

  assert.throws(() => database.run("UPDATE questions SET status='published' WHERE id=1"));
  assert.throws(() => database.run("UPDATE attempts SET status='unknown' WHERE id=1"));
  assert.throws(() => database.run("INSERT INTO exam_assignments(exam_id, student_id) VALUES (1, 2)"));
  assert.deepEqual(database.exec('SELECT status FROM attempts WHERE id=1')[0].values, [['not_started']]);
  database.close();
});
