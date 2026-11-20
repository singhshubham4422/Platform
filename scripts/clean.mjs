// Removes reproducible build output only (never databases, storage, .env or source).
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const t of [
  'apps/api/dist',
  'apps/web/.next',
  'apps/web/test-results',
  'apps/web/playwright-report',
  'apps/student-desktop/dist',
  'apps/student-desktop/src-tauri/target',
]) {
  rmSync(join(root, t), { recursive: true, force: true });
  console.log(`removed ${t}`);
}
