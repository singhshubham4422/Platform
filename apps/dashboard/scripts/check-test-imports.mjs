import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = join(process.cwd(), 'src');
const allowed = new Set([join('src', 'runtime.ts')]);
const bad = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (path.split(sep).includes('test')) continue;
      walk(path);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(name) || /\.test\.(ts|tsx)$/.test(name)) continue;
    const rel = relative(process.cwd(), path);
    const text = readFileSync(path, 'utf8');
    if (allowed.has(rel)) continue;
    if (/from\s+['"][^'"]*\/test\/|import\(\s*['"][^'"]*\/test\//.test(text)) bad.push(rel);
  }
}
walk(root);
if (bad.length) {
  console.error('Application code imports test-only modules:', bad.join(', '));
  process.exit(1);
}
console.log('Application code does not import src/test modules');
