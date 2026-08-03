import type { Database } from 'sql.js';

function hasColumn(database: Database, table: string, column: string): boolean {
  const result = database.exec(`PRAGMA table_info(${table})`);
  return (result[0]?.values ?? []).some((row) => String(row[1]) === column);
}

export const examDeliveryMigration = {
  id: '003_exam_delivery',
  up(database: Database): void {
    if (!hasColumn(database, 'exams', 'allowed_attempts')) {
      database.run(`ALTER TABLE exams ADD COLUMN allowed_attempts INTEGER NOT NULL DEFAULT 1
        CHECK(allowed_attempts > 0 AND allowed_attempts <= 20)`);
    }
    if (!hasColumn(database, 'attempts', 'paper_snapshot')) {
      database.run('ALTER TABLE attempts ADD COLUMN paper_snapshot TEXT');
    }
  },
};
