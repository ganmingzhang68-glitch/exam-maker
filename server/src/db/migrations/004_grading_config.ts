import type { Database } from 'sql.js';

function hasColumn(database: Database, table: string, column: string): boolean {
  const result = database.exec(`PRAGMA table_info(${table})`);
  return (result[0]?.values ?? []).some((row) => String(row[1]) === column);
}

export const gradingConfigMigration = {
  id: '004_grading_config',
  up(database: Database): void {
    const columns = [
      ['fill_blank_ignore_case', 'INTEGER NOT NULL DEFAULT 0 CHECK(fill_blank_ignore_case IN (0,1))'],
      ['show_answers', 'INTEGER NOT NULL DEFAULT 0 CHECK(show_answers IN (0,1))'],
      ['show_analysis', 'INTEGER NOT NULL DEFAULT 0 CHECK(show_analysis IN (0,1))'],
    ] as const;
    for (const [name, definition] of columns) {
      if (!hasColumn(database, 'exams', name)) {
        database.run(`ALTER TABLE exams ADD COLUMN ${name} ${definition}`);
      }
    }
  },
};
