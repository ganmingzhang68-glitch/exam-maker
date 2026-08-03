import { initDb, db, schema, saveToDisk } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

async function seed() {
  await initDb();
  runMigrations();

  const accounts = [
    { username: 'test_teacher', email: 'teacher@example.com', password: 'Teacher123!', role: 'teacher' as const },
    { username: 'test_student', email: 'student@example.com', password: 'Student123!', role: 'student' as const },
  ];

  for (const account of accounts) {
    const existing = db.select().from(schema.users)
      .where(eq(schema.users.username, account.username))
      .get();
    if (existing) {
      console.log(`⚠ 用户 ${account.username} 已存在，跳过创建`);
      continue;
    }

    const passwordHash = await bcrypt.hash(account.password, 10);
    db.insert(schema.users).values({
      username: account.username,
      email: account.email,
      passwordHash,
      role: account.role,
    }).run();
    console.log(`✅ 测试${account.role === 'teacher' ? '教师' : '学生'}账号创建成功: ${account.username}`);
  }

  saveToDisk();
}

seed().catch(console.error);
