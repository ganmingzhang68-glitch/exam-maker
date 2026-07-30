import { initDb, db, schema, saveToDisk } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';

async function seed() {
  await initDb();
  runMigrations();

  // Check if admin already exists
  const existing = db.select().from(schema.users)
    .where(eq(schema.users.username, 'admin'))
    .get();

  if (existing) {
    console.log('⚠ 用户 admin 已存在，跳过创建');
    return;
  }

  const hash = await bcrypt.hash('123456', 10);
  db.insert(schema.users).values({
    username: 'admin',
    email: 'admin@exam-maker.com',
    passwordHash: hash,
    role: 'teacher',
  }).run();

  saveToDisk();
  console.log('✅ 默认用户创建成功！');
  console.log('   用户名: admin');
  console.log('   密码:   123456');
}

seed().catch(console.error);
