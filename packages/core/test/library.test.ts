import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

describe('reading progress', () => {
  it('tracks each language independently and only changes completion explicitly', async () => {
    const databasePath = join(tmpdir(), `novel-library-${randomUUID()}.sqlite`);
    process.env.DATABASE_PATH = databasePath;
    process.env.APP_SECRET_KEY = Buffer.alloc(32, 7).toString('base64');
    // Dynamic imports are required because DATABASE_PATH must be set before the database singleton initializes.
    const database = await import('@novel/db');
    const library = await import('../src/library.js');
    database.migrate();
    const sqlite = database.getDatabase().sqlite;
    const now = Date.now();
    sqlite
      .prepare(
        `INSERT INTO novels(id,source_id,source_novel_id,title,index_url,start_chapter_url,start_ordinal,include_start,auto_translate,auto_check,created_at,updated_at)
      VALUES ('novel','piaotia','source','Title','https://www.piaotia.com/html/1/1/index.html','https://www.piaotia.com/html/1/1/1.html',0,1,0,0,?,?)`,
      )
      .run(now, now);
    for (const [id, ordinal] of [
      ['chapter-1', 0],
      ['chapter-2', 1],
    ] as const) {
      sqlite
        .prepare(
          `INSERT INTO chapters(id,novel_id,source_chapter_id,canonical_url,ordinal,title,created_at,updated_at)
        VALUES (?,'novel',?,?,?,'Chapter',?,?)`,
        )
        .run(id, id, `https://www.piaotia.com/html/1/1/${ordinal + 1}.html`, ordinal, now, now);
    }
    try {
      library.updateReadingProgress({ novelId: 'novel', chapterId: 'chapter-1', mode: 'source', scrollRatio: 0.4 });
      library.updateReadingProgress({ novelId: 'novel', chapterId: 'chapter-1', mode: 'en', scrollRatio: 0.7 });
      expect(library.getNovel('novel').progress).toMatchObject({
        current_chapter_id: 'chapter-1',
        source_scroll_ratio: 0.4,
        english_scroll_ratio: 0.7,
      });
      expect(library.getChapter('chapter-1').readAt).toBeNull();

      library.updateReadingProgress({
        novelId: 'novel',
        chapterId: 'chapter-2',
        mode: 'en',
        scrollRatio: 0.2,
        completed: true,
      });
      expect(library.getNovel('novel').progress).toMatchObject({
        current_chapter_id: 'chapter-2',
        source_scroll_ratio: 0,
        english_scroll_ratio: 0.2,
      });
      expect(library.getChapter('chapter-2').readAt).not.toBeNull();
      library.updateReadingProgress({
        novelId: 'novel',
        chapterId: 'chapter-2',
        mode: 'source',
        scrollRatio: 0.1,
        completed: false,
      });
      expect(library.getChapter('chapter-2').readAt).toBeNull();
    } finally {
      sqlite.close();
      for (const suffix of ['', '-wal', '-shm']) {
        try {
          unlinkSync(`${databasePath}${suffix}`);
        } catch {}
      }
    }
  });
});
