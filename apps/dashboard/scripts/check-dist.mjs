import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dist = join(process.cwd(), 'dist');
if (!existsSync(dist)) {
  console.error('dist/ does not exist; run the build first');
  process.exit(1);
}
const bad = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else {
      const text = readFileSync(path, 'latin1');
      if (/service_role|SERVICE_ROLE/i.test(text)) bad.push(path);
    }
  }
}
walk(dist);
if (bad.length) {
  console.error('Service-role material found in the client bundle:', bad.join(', '));
  process.exit(1);
}
console.log('dist/ contains no service-role material');
