import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';

describe('chapter translation context', () => {
  it('sends the stored chapter number with every chunk and title, without reusing the old prompt output', async () => {
    const databasePath = join(tmpdir(), `novel-translation-context-${randomUUID()}.sqlite`);
    process.env.DATABASE_PATH = databasePath;
    process.env.APP_SECRET_KEY = Buffer.alloc(32, 9).toString('base64');
    const database = await import('@novel/db');
    const settings = await import('../src/settings.js');
    const translations = await import('../src/translations.js');
    database.migrate();
    const sqlite = database.getDatabase().sqlite;
    const requests: Array<{ messages: Array<{ role: string; content: string }> }> = [];
    const sourceTitle = '第6883章 神秘力量';
    const translatedTitle = 'Chapter 6843: Mysterious Power';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: unknown, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as (typeof requests)[number];
        requests.push(request);
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'stop',
                message: {
                  role: 'assistant',
                  content: request.messages[1]?.content === sourceTitle ? translatedTitle : 'Translated paragraph.',
                },
              },
            ],
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      }),
    );
    try {
      const provider = settings.updateProviderSettings({
        baseUrl: 'https://example.com/v1',
        model: 'test-model',
        apiKey: 'test-key',
        chunkCharacters: 500,
      });
      const now = Date.now();
      const paragraphs = ['文'.repeat(300), '字'.repeat(300)];
      sqlite
        .prepare(
          `INSERT INTO novels(id,source_id,source_novel_id,title,index_url,start_chapter_url,start_ordinal,include_start,created_at,updated_at)
           VALUES ('novel','test','source-novel','Novel','https://example.com/index','https://example.com/1',6843,1,?,?)`,
        )
        .run(now, now);
      sqlite
        .prepare(
          `INSERT INTO chapters(id,novel_id,source_chapter_id,canonical_url,ordinal,title,paragraphs,source_hash,created_at,updated_at)
           VALUES ('chapter','novel','source-chapter','https://example.com/1',6843,?,?,'hash',?,?)`,
        )
        .run(sourceTitle, JSON.stringify(paragraphs), now, now);
      sqlite
        .prepare(
          `INSERT INTO translation_runs(id,chapter_id,model,base_url,provider_revision,source_hash,prompt_version,status,created_at,updated_at)
           VALUES ('old-run','chapter','test-model','https://example.com/v1',?,'hash',2,'failed',?,?)`,
        )
        .run(provider.revision, now, now);
      sqlite
        .prepare('INSERT INTO translation_chunks(run_id,chunk_index,input,output) VALUES (?,?,?,?)')
        .run('old-run', 0, paragraphs[0]!, JSON.stringify(['Old translation with the wrong number.']));

      const job = translations.queueTranslation('chapter', false);
      await translations.handleTranslationJob(job, new AbortController().signal);

      expect(requests).toHaveLength(3);
      expect(requests.map((request) => request.messages[1]?.content)).toEqual([...paragraphs, sourceTitle]);
      for (const request of requests) {
        expect(request.messages[0]?.role).toBe('system');
        expect(request.messages[0]?.content).toContain('The novel name is "Novel"');
        expect(request.messages[0]?.content).toContain('The expected chapter number is 6843.');
        expect(request.messages[0]?.content).toContain('even if the source heading gives a different number');
        expect(request.messages[0]?.content).toContain('Do not add a chapter heading if none is present.');
        expect(request.messages[0]?.content).toContain('Preserve references to other chapters');
      }
      const saved = sqlite
        .prepare('SELECT translated_title,paragraphs FROM translations WHERE chapter_id=?')
        .get('chapter');
      expect(saved).toMatchObject({
        translated_title: translatedTitle,
        paragraphs: JSON.stringify(['Translated paragraph.', 'Translated paragraph.']),
      });

      await translations.handleProviderCheckJob(translations.queueProviderCheck(), new AbortController().signal);
      expect(requests[3]?.messages[0]?.content).not.toContain('expected chapter number');
    } finally {
      vi.unstubAllGlobals();
      sqlite.close();
      for (const suffix of ['', '-wal', '-shm']) rmSync(`${databasePath}${suffix}`, { force: true });
    }
  });
});
