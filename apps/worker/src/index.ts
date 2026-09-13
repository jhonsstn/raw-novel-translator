import { getDatabase, migrate } from '@novel/db';
import {
  assertEncryptionConfiguration,
  claimJob,
  failJob,
  finalizeParentJob,
  finishJob,
  handleCheckUpdatesJob,
  handleFetchChapterJob,
  handleImportJob,
  handleProviderCheckJob,
  handleSourceCheckJob,
  handleTranslationJob,
  heartbeatJob,
  queueCheckUpdates,
  reconcileTranslationWindow,
  type Job,
} from '@novel/core';

const shutdown = new AbortController();
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function execute(
  job: Job,
  signal: AbortSignal,
): Promise<{ deferred?: boolean; progress?: Record<string, unknown> }> {
  switch (job.kind) {
    case 'import':
      return handleImportJob(job, signal);
    case 'check_updates':
      return handleCheckUpdatesJob(job, signal);
    case 'fetch_chapter':
      await handleFetchChapterJob(job, signal);
      return {};
    case 'translate_chapter':
      return { progress: await handleTranslationJob(job, signal) };
    case 'provider_check':
      return { progress: await handleProviderCheckJob(job, signal) };
    case 'source_check':
      return { progress: await handleSourceCheckJob(job, signal) };
  }
}

async function runJob(job: Job): Promise<void> {
  if (!job.leaseToken) return;
  const controller = new AbortController();
  const abort = () => controller.abort(shutdown.signal.reason);
  shutdown.signal.addEventListener('abort', abort, { once: true });
  const heartbeat = setInterval(() => {
    if (!heartbeatJob(job.id, job.leaseToken!)) controller.abort(new Error('Job lease lost or cancelled'));
  }, 20_000);
  try {
    const result = await execute(job, controller.signal);
    if (!result.deferred) finishJob(job.id, job.leaseToken, result.progress);
  } catch (error) {
    failJob(job.id, job.leaseToken, error);
  } finally {
    clearInterval(heartbeat);
    shutdown.signal.removeEventListener('abort', abort);
    if (job.parentJobId) finalizeParentJob(job.parentJobId);
    if (job.novelId) reconcileTranslationWindow(job.novelId);
  }
}

async function laneLoop(lane: 'source' | 'translation'): Promise<void> {
  while (!shutdown.signal.aborted) {
    const job = claimJob(lane, Date.now());
    if (job) await runJob(job);
    else await sleep(300);
  }
}

function recordHeartbeat(): void {
  const now = Date.now();
  getDatabase()
    .sqlite.prepare(
      `INSERT INTO worker_state(id,heartbeat_at) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET heartbeat_at=excluded.heartbeat_at`,
    )
    .run(now);
}

function schedulerTick(): void {
  const sqlite = getDatabase().sqlite;
  const now = Date.now();
  const due = sqlite
    .prepare('SELECT id FROM novels WHERE auto_check=1 AND COALESCE(next_check_at,0)<=?')
    .all(now) as Array<{ id: string }>;
  for (const novel of due) queueCheckUpdates(novel.id, 'automatic');
  const translating = sqlite.prepare('SELECT id FROM novels WHERE auto_translate=1').all() as Array<{ id: string }>;
  for (const novel of translating) reconcileTranslationWindow(novel.id);
}

async function main(): Promise<void> {
  assertEncryptionConfiguration();
  migrate();
  recordHeartbeat();
  schedulerTick();
  const heartbeat = setInterval(recordHeartbeat, 20_000);
  const scheduler = setInterval(schedulerTick, 60_000);
  const stop = () => shutdown.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  console.log('Worker ready');
  await Promise.all([laneLoop('source'), laneLoop('translation')]);
  clearInterval(heartbeat);
  clearInterval(scheduler);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
