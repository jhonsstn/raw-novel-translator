import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

describe('durable job queue', () => {
  it('deduplicates active work and finalizes deferred parents after their children', async () => {
    process.env.DATABASE_PATH = join(tmpdir(), `novel-jobs-${randomUUID()}.sqlite`);
    process.env.APP_SECRET_KEY = Buffer.alloc(32, 7).toString('base64');
    // Dynamic imports are required here because DATABASE_PATH must be set before the database singleton initializes.
    const database = await import('@novel/db');
    const jobs = await import('../src/jobs.js');
    database.migrate();
    try {
      const first = jobs.enqueueJob({ kind: 'source_check', dedupeKey: 'same-source' });
      expect(jobs.enqueueJob({ kind: 'source_check', dedupeKey: 'same-source' }).id).toBe(first.id);
      const claimed = jobs.claimJob('source', Date.now());
      expect(claimed?.id).toBe(first.id);
      expect(jobs.finishJob(first.id, claimed!.leaseToken!)).toBe(true);
      expect(jobs.enqueueJob({ kind: 'source_check', dedupeKey: 'same-source' }).id).not.toBe(first.id);

      const pendingStandalone = jobs.claimJob('source', Date.now());
      jobs.finishJob(pendingStandalone!.id, pendingStandalone!.leaseToken!);
      const parent = jobs.enqueueJob({ kind: 'import' });
      const claimedParent = jobs.claimJob('source', Date.now());
      expect(claimedParent?.id).toBe(parent.id);
      jobs.enqueueJob({ kind: 'fetch_chapter', parentJobId: parent.id });
      jobs.deferParentJob(parent.id, claimedParent!.leaseToken!, { queued: 1 });
      jobs.finalizeParentJob(parent.id);
      expect(jobs.getJob(parent.id)?.status).toBe('running');
      const child = jobs.claimJob('source', Date.now());
      expect(child?.parentJobId).toBe(parent.id);
      jobs.finishJob(child!.id, child!.leaseToken!);
      jobs.finalizeParentJob(parent.id);
      expect(jobs.getJob(parent.id)?.status).toBe('succeeded');
    } finally {
      database.getDatabase().sqlite.close();
    }
  });
});
