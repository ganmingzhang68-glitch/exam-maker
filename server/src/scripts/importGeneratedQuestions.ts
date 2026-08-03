import { db, initDb, saveToDisk, schema } from '../db/index.js';
import { runMigrations } from '../db/migrate.js';
import { importGeneratedQuestionsFromProject } from '../services/questionImporter.js';

await initDb();
runMigrations();

let imported = 0;
let skipped = 0;
for (const project of db.select({ id: schema.projects.id }).from(schema.projects).all()) {
  const result = importGeneratedQuestionsFromProject(project.id);
  imported += result.imported;
  skipped += result.skipped;
}

saveToDisk();
console.log(`✅ AI题目回填完成: 新增${imported}题, 已存在${skipped}题`);
