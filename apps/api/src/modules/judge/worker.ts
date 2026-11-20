// Judge worker process: `pnpm --filter @lplatform/api judge:worker`.
// Separate OS process from the API. Claims queued execution jobs, sends them to the configured
// provider (Judge0 in production) and persists authentic results.
import '../../load-env.js';
import os from 'node:os';
import { pool } from '../../db/connection.js';
import { claimNextJob, createJudgeProvider, processJob } from './judge.service.js';

const workerId = `${os.hostname()}:${process.pid}`;
const concurrency = Math.max(1, Number(process.env.JUDGE_WORKER_CONCURRENCY || 2));
const idleMs = Math.max(100, Number(process.env.JUDGE_WORKER_POLL_MS || 500));
let stopping = false;

const provider = createJudgeProvider();
if (!provider) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Production judge worker cannot start without a sandboxed execution provider.');
  }
  console.warn('[judge] JUDGE_PROVIDER is not set: every job will be marked JUDGE_UNAVAILABLE.');
} else {
  const status = await provider.status();
  console.log(`[judge] provider=${status.provider} available=${status.available} sandboxed=${status.sandboxed}`);
  console.log(`[judge] languages: ${JSON.stringify(status.languages)}`);
  if (process.env.NODE_ENV === 'production' && (!status.available || !status.sandboxed)) {
    throw new Error(`Production requires an available sandboxed judge; provider status: ${status.detail}`);
  }
  if (!status.sandboxed) console.warn('[judge] WARNING: development provider without isolation. Never expose to untrusted users.');
}

async function loop(slot: number) {
  while (!stopping) {
    try {
      const job = await claimNextJob(`${workerId}#${slot}`);
      if (!job) {
        await new Promise((r) => setTimeout(r, idleMs));
        continue;
      }
      const verdict = await processJob(provider, job);
      console.log(`[judge] job=${job.id} kind=${job.kind} lang=${job.language} verdict=${verdict}`);
    } catch (error) {
      console.error('[judge] worker error:', (error as Error).message);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

const shutdown = async () => {
  stopping = true;
  setTimeout(() => process.exit(0), 3000).unref();
  await pool.end().catch(() => undefined);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`[judge] worker ${workerId} started with concurrency ${concurrency}`);
await Promise.all(Array.from({ length: concurrency }, (_, i) => loop(i)));
