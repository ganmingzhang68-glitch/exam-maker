import { initDb, db, schema, saveToDisk } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { and, eq } from 'drizzle-orm';
import { readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Register compiled outputs in the database so the frontend can list/download them.
async function registerOutputs() {
  await initDb();
  runMigrations();

  const projectsDir = resolve(process.cwd(), 'data', 'projects');
  if (!existsSync(projectsDir)) {
    console.log('⚠ 无 projects 目录');
    return;
  }

  for (const projectIdStr of readdirSync(projectsDir)) {
    const projectId = Number(projectIdStr);
    if (isNaN(projectId)) continue;

    const outputDir = join(projectsDir, projectIdStr, 'output');
    if (!existsSync(outputDir)) continue;

    // Check project exists
    const project = db.select().from(schema.projects)
      .where(eq(schema.projects.id, projectId)).get();
    if (!project) continue;

    let added = 0;
    for (const filename of readdirSync(outputDir)) {
      // Skip aux/log files, only register deliverable files
      if (!/\.(pdf|docx|md|tex)$/i.test(filename)) continue;
      if (filename.includes('.conv.')) continue;

      const filepath = join(outputDir, filename);
      const existing = db.select().from(schema.projectFiles)
        .where(and(
          eq(schema.projectFiles.projectId, projectId),
          eq(schema.projectFiles.filename, filename),
        ))
        .get();
      if (existing) continue;

      db.insert(schema.projectFiles).values({
        projectId,
        type: 'final_output',
        filename,
        filepath,
        metadata: JSON.stringify({ format: 'compiled', registered: true }),
      }).run();
      added++;
    }

    if (added > 0) {
      console.log(`✅ 项目${projectId}: 注册 ${added} 个编译产物`);
    }
  }

  saveToDisk();
  console.log('完成');
}

registerOutputs().catch((err) => { console.error(err); process.exit(1); });
