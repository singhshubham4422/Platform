// Production bootstrap: creates the first platform owner and nothing else.
//
// Unlike `db:seed` (development demo tenants and fixture accounts, refused in production),
// this script inserts no colleges, users, courses or sample data. Run once after `db:migrate`:
//
//   PLATFORM_OWNER_EMAIL=owner@yourcompany.com PLATFORM_OWNER_FIRST_NAME=Asha \
//   PLATFORM_OWNER_LAST_NAME=Rao PLATFORM_OWNER_PASSWORD='<16+ chars>' pnpm db:bootstrap
//
// Optional: IMPORT_PRACTICE_BANK=true imports the recovered J_Platform Java practice bank as
// platform practice questions marked IMPORTED_UNREVIEWED (not assignable for grades until reviewed).
import '../load-env.js';
import crypto from 'node:crypto';
import pg from 'pg';
import { getDatabaseUrl } from '../lib/env.js';
import { hashPassword } from '../lib/auth.js';
import { importJPlatformQuestionBank } from './seed-college.js';

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is required`);
  return v;
}

export async function bootstrap(): Promise<void> {
  const email = required('PLATFORM_OWNER_EMAIL').toLowerCase();
  const firstName = required('PLATFORM_OWNER_FIRST_NAME');
  const lastName = required('PLATFORM_OWNER_LAST_NAME');
  const password = required('PLATFORM_OWNER_PASSWORD');
  if (password.length < 16 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    throw new Error('PLATFORM_OWNER_PASSWORD must be at least 16 characters with upper, lower case and digits.');
  }
  if (/@(lplatform\.dev|riverside\.edu|demo-college\.test)$/.test(email) || email.endsWith('.test')) {
    throw new Error('Refusing to bootstrap with a demo/test e-mail domain.');
  }

  const pool = new pg.Pool({ connectionString: getDatabaseUrl(), ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const owners = await client.query<{ n: string }>(`SELECT COUNT(*) n FROM users WHERE role = 'PLATFORM_OWNER'`);
    if (Number(owners.rows[0].n) > 0) {
      console.log('A platform owner already exists; nothing to do.');
      await client.query('ROLLBACK');
      return;
    }
    const id = crypto.randomUUID();
    await client.query(
      `INSERT INTO users (id, organization_id, first_name, last_name, email, role, status) VALUES ($1, NULL, $2, $3, $4, 'PLATFORM_OWNER', 'ACTIVE')`,
      [id, firstName, lastName, email],
    );
    await client.query(`INSERT INTO credentials (user_id, password_hash) VALUES ($1, $2)`, [id, await hashPassword(password)]);
    await client.query(
      `INSERT INTO platform_settings (id, platform_name, support_email) VALUES ('default', 'L_Platform', $1) ON CONFLICT (id) DO NOTHING`,
      [process.env.PLATFORM_SUPPORT_EMAIL?.trim() || email],
    );
    await client.query(
      `INSERT INTO audit_logs (id, organization_id, user_id, user_email, action, entity_type, entity_id, details)
       VALUES (gen_random_uuid()::text, NULL, $1, $2, 'PLATFORM_BOOTSTRAP', 'user', $1, '{}'::jsonb)`,
      [id, email],
    );
    if (process.env.IMPORT_PRACTICE_BANK === 'true') {
      const n = await importJPlatformQuestionBank(client);
      console.log(`Imported ${n} practice questions (IMPORTED_UNREVIEWED).`);
    }
    await client.query('COMMIT');
    console.log(`Platform owner created: ${email}. Sign in to the web console and onboard your first college.`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1]?.endsWith('bootstrap.ts') || process.argv[1]?.endsWith('bootstrap.js')) {
  bootstrap().catch((err) => {
    console.error('Bootstrap failed:', (err as Error).message);
    process.exit(1);
  });
}
