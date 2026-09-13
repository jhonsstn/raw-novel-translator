import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

describe('parallel translation queue', () => {
  it('defaults to one worker, preserves provider revision for concurrency-only changes, and queues chapters in ordinal order', async () => {
    process.env.DATABASE_PATH = join(tmpdir(), `novel-parallel-translations-${randomUUID()}.sqlite`);
    process.env.APP_SECRET_KEY = Buffer.alloc(32, 9).toString('base64');
    const database = await import('@novel/db');
    const settings = await import('../src/settings.js');
    const translations = await import('../src/translations.js');
    const jobs = await import('../src/jobs.js');
    database.migrate();
    const sqlite = database.getDatabase().sqlite;
    try {
      const initial = settings.getProviderSettings();
      expect(initial.translationConcurrency).toBe(1);
      const configured = settings.updateProviderSettings({
        baseUrl: 'https://example.com/v1',
        model: 'test-model',
        apiKey: 'test-key',
      });
      const revision = configured.revision;
      const concurrent = settings.updateProviderSettings({ translationConcurrency: 3 });
      expect(concurrent.translationConcurrency).toBe(3);
      expect(concurrent.revision).toBe(revision);

      const now = Date.now();
      sqlite
        .prepare(
          `INSERT INTO novels(id,source_id,source_novel_id,title,index_url,start_chapter_url,start_ordinal,include_start,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .run('novel-1', 'test', 'source-novel', 'Novel', 'https://example.com/index', 'https://example.com/1', 1, 1, now, now);
      const insertChapter = sqlite.prepare(
        `INSERT INTO chapters(id,novel_id,source_chapter_id,canonical_url,ordinal,title,paragraphs,source_hash,fetched_at,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      );
      insertChapter.run('chapter-3', 'novel-1', '3', 'https://example.com/3', 3, 'Three', '["三"]', 'hash-3', now, now, now);
      insertChapter.run('chapter-1', 'novel-1', '1', 'https://example.com/1', 1, 'One', '["一"]', 'hash-1', now, now, now);
      insertChapter.run('chapter-2', 'novel-1', '2', 'https://example.com/2', 2, 'Two', '["二"]', 'hash-2', now, now, now);

      const result = translations.queueNovelTranslations('novel-1');
      expect(result).toMatchObject({ queued: 3, alreadyActive: 0, waitingForDownload: 0, concurrency: 3 });

      const claimed = [
        jobs.claimJob('translation', Date.now() + 10_000),
        jobs.claimJob('translation', Date.now() + 10_000),
        jobs.claimJob('translation', Date.now() + 10_000),
      ];
      expect(claimed.map((job) => job?.chapterId)).toEqual(['chapter-1', 'chapter-2', 'chapter-3']);
    } finally {
      sqlite.close();
    }
  });
});
