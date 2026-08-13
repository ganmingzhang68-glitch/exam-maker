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
    { username: 'test_admin', email: 'admin@example.com', password: 'Admin123!', role: 'admin' as const },
  ];

  for (const account of accounts) {
    const existing = db.select().from(schema.users)
      .where(eq(schema.users.username, account.username))
      .get();
    let user = existing;
    if (!user) {
      const passwordHash = await bcrypt.hash(account.password, 10);
      user = db.insert(schema.users).values({ username: account.username, email: account.email, passwordHash, role: account.role }).returning().get();
      console.log(`✅ 测试${account.role}账号创建成功: ${account.username}`);
    } else {
      const passwordHash = await bcrypt.hash(account.password, 10);
      user = db.update(schema.users).set({ passwordHash, role: account.role, isActive: true, disabledAt: null,
        tokenVersion: user.tokenVersion + 1, updatedAt: new Date().toISOString() })
        .where(eq(schema.users.id, user.id)).returning().get();
      console.log(`✅ 测试账号已重置为 seed 配置: ${account.username}`);
    }
    db.insert(schema.userOrganizations).values({ userId: user.id, organizationId: 1,
      role: account.role === 'admin' ? 'admin' : 'member', isDefault: true })
      .onConflictDoUpdate({ target: [schema.userOrganizations.userId, schema.userOrganizations.organizationId],
        set: { role: account.role === 'admin' ? 'admin' : 'member', isDefault: true, updatedAt: new Date().toISOString() } }).run();
  }

  saveToDisk();
}

seed().catch(console.error);
