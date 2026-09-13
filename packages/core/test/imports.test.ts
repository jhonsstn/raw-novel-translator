import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type * as Sources from '@novel/sources';
import type { Job } from '../src/jobs.js';

import * as database from '@novel/db';
import * as jobs from '../src/jobs.js';
import * as imports from '../src/imports.js';
import * as library from '../src/library.js';
import * as metadata from '../src/novel-metadata.js';
const source = vi.hoisted(() => ({ ids: ['902', '17', '600'], requested: [] as string[] }));
vi.mock('@novel/sources', async (importOriginal) => {
  const actual = await importOriginal<typeof Sources>();
  return {
    ...actual,
    createSourceTransport: () => async (url: string) => {
      source.requested.push(url);
      if (!url.endsWith('/index.html')) throw new Error('Import must not fetch a chapter to infer novel metadata');
      return `<div class="centent"><ul>${source.ids.map((id) => `<li><a href="${id}.html">Source chapter ${id}</a></li>`).join('')}</ul></div>`;
    },
  };
});

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'novel-manual-test-'));
  process.env.DATABASE_PATH = join(directory, 'library.sqlite');
  process.env.APP_SECRET_KEY = Buffer.alloc(32, 7).toString('base64');
  database.migrate();
  source.ids = ['902', '17', '600'];
  source.requested = [];
});
afterEach(() => {
  database.closeDatabase();
  rmSync(directory, { recursive: true });
});

async function runImport(includeStart = true) {
  const queued = imports.startImport({
    url: 'https://www.piaotia.com/html/10/20/17.html',
    includeStart,
    title: ' My title ',
    description: ' My description\r\nSecond line ',
    chapterNumber: 42,
  });
  const job = jobs.claimJob('source', Date.now())!;
  expect(job.id).toBe(queued.id);
  await imports.handleImportJob(job, new AbortController().signal);
  jobs.cancelJob(job.id);
  return library.listNovels()[0]!.id;
}

it('uses manual metadata and numbering, preserving them when directory positions shift', async () => {
  const id = await runImport();
  let novel = library.getNovel(id);
  expect(novel).toMatchObject({
    displayTitle: 'My title',
    description: 'My description\nSecond line',
    author: null,
    coverUrl: null,
  });
  expect(novel.chapters.map((chapter) => [chapter.ordinal, chapter.canonicalUrl])).toEqual([
    [42, 'https://www.piaotia.com/html/10/20/17.html'],
    [43, 'https://www.piaotia.com/html/10/20/600.html'],
  ]);
  await metadata.updateNovelMetadata(id, {
    customTitle: 'Edited title',
    author: '  Edited author  ',
    description: 'Edited description',
    cover: { action: 'keep' },
  });
  source.ids = ['888', '902', '17', '600', '3'];
  imports.queueCheckUpdates(id);
  const check = jobs.claimJob('source', Date.now())!;
  await imports.handleCheckUpdatesJob(check, new AbortController().signal);
  jobs.cancelJob(check.id);
  novel = library.getNovel(id);
  expect(novel).toMatchObject({
    displayTitle: 'Edited title',
    author: 'Edited author',
    description: 'Edited description',
  });
  expect(novel.chapters.map((chapter) => chapter.ordinal)).toEqual([42, 43, 44]);
  expect(novel.chapters[2]!.canonicalUrl).toBe('https://www.piaotia.com/html/10/20/3.html');
});

it('starts at the next entered number when the supplied chapter is excluded', async () => {
  const id = await runImport(false);
  expect(library.getNovel(id).chapters.map((chapter) => [chapter.ordinal, chapter.canonicalUrl])).toEqual([
    [43, 'https://www.piaotia.com/html/10/20/600.html'],
  ]);
});

it('rejects legacy import jobs instead of scraping missing manual metadata', async () => {
  const legacy: Job = {
    ...jobs.enqueueJob({
      kind: 'import',
      payload: { url: 'https://www.piaotia.com/html/10/20/17.html', includeStart: true },
    }),
    leaseToken: 'lease',
  };
  await expect(imports.handleImportJob(legacy, new AbortController().signal)).rejects.toMatchObject({
    code: 'INVALID_JOB',
  });
  expect(library.listNovels()).toEqual([]);
  expect(source.requested).toEqual([]);
});
