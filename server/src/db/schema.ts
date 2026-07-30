import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['teacher', 'admin'] }).notNull().default('teacher'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  course: text('course').notNull(),
  scope: text('scope'),
  difficulty: text('difficulty').notNull().default('{"basic":60,"medium":30,"hard":10}'),
  nSets: integer('n_sets').notNull().default(8),
  outputType: text('output_type', { enum: ['latex', 'docx', 'md'] }).notNull().default('latex'),
  verifyMode: text('verify_mode', { enum: ['auto', 'computational', 'conceptual', 'mixed'] }).notNull().default('auto'),
  status: text('status').notNull().default('drafting'),
  userId: integer('user_id').notNull().references(() => users.id),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

export const projectFiles = sqliteTable('project_files', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id),
  type: text('type').notNull(),
  filename: text('filename').notNull(),
  filepath: text('filepath').notNull(),
  metadata: text('metadata'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const checkpoints = sqliteTable('checkpoints', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id),
  step: text('step').notNull(),
  status: text('status').notNull().default('pending'),
  teacherNotes: text('teacher_notes'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

export const jobEvents = sqliteTable('job_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id),
  step: text('step').notNull(),
  eventType: text('event_type').notNull(),
  message: text('message').notNull(),
  data: text('data'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});
