import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = await readFile(path.join(root, 'packages/pack-format/index.js'), 'utf8');
const generated = `// GENERATED from packages/pack-format/index.js by pnpm check:edge-sync. Do not edit.\n${source}`;
const target = path.join(root, 'supabase/functions/_shared/pack-format.js');
if (process.argv.includes('--write')) { await writeFile(target, generated); console.log('Synced edge pack-format copy.'); }
else {
  let current = ''; try { current = await readFile(target, 'utf8'); } catch {}
  if (current !== generated) { console.error('Edge pack-format copy is stale. Run node supabase/scripts/sync-pack-format.mjs --write.'); process.exitCode = 1; }
  else console.log('Edge pack-format copy matches source.');
}
