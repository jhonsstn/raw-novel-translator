import { createHash, randomUUID } from 'node:crypto';
import { getDatabase } from '@novel/db';
import {
  createSourceTransport,
  type ChapterRef,
  type NovelRef,
  type SourceAdapter,
  type SourceContext,
} from '@novel/sources';
import { AppError } from './errors.js';
import { deferParentJob, enqueueJob, finalizeParentJob, type Job } from './jobs.js';
import { normalizeNovelText } from './novel-metadata.js';
import { configuredSourceById, configuredSourceForUrl } from './source-definitions.js';

interface NovelRow {
  id: string;
  source_id: string;
  source_novel_id: string;
  index_url: string;
  start_chapter_url: string;
  start_ordinal: number;
  include_start: number;
}
interface ChapterRow {
  id: string;
  novel_id: string;
  source_chapter_id: string;
  canonical_url: string;
  ordinal: number;
  title: string;
  paragraphs: string | null;
}
export interface ImportInput {
  url: string;
  includeStart: boolean;
  title: string;
  author?: string | null;
  description: string | null;
  chapterNumber: number;
}

function normalizeImport(input: Record<string, unknown>): ImportInput {
  if (typeof input.url !== 'string') throw new AppError('INVALID_URL', 'Enter a valid chapter URL');
  if (typeof input.includeStart !== 'boolean')
    throw new AppError('INVALID_IMPORT', 'Choose whether to include the starting chapter');
  if (typeof input.title !== 'string' || !input.title.trim())
    throw new AppError('INVALID_TITLE', 'Novel title is required');
  if (input.description !== null && input.description !== undefined && typeof input.description !== 'string')
    throw new AppError('INVALID_DESCRIPTION', 'Description must be text');
  if (input.author !== null && input.author !== undefined && typeof input.author !== 'string')
    throw new AppError('INVALID_AUTHOR', 'Author name must be text');
  const author = input.author?.trim() || null;
  if (author && Array.from(author).length > 300)
    throw new AppError('INVALID_AUTHOR', 'Author name is limited to 300 characters');
  if (typeof input.chapterNumber !== 'number' || !Number.isSafeInteger(input.chapterNumber) || input.chapterNumber < 1)
    throw new AppError('INVALID_CHAPTER_NUMBER', 'Chapter number must be a positive safe integer');
  const text = normalizeNovelText({ customTitle: input.title, description: input.description ?? null });
  return {
    url: input.url,
    includeStart: input.includeStart,
    title: text.customTitle!,
    author,
    description: text.description,
    chapterNumber: input.chapterNumber,
  };
}

function chapterOrdinal(anchor: number, offset: number): number {
  const ordinal = anchor + offset;
  if (!Number.isSafeInteger(ordinal) || ordinal < 1)
    throw new AppError(
      'INVALID_CHAPTER_NUMBER',
      'Chapter numbering would fall outside the positive safe integer range',
    );
  return ordinal;
}

function requireString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || !value) throw new AppError('INVALID_JOB', `Job is missing ${key}`, 500);
  return value;
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

async function reserveSourceRequest(sourceId: string, minimumDelayMs: number): Promise<void> {
  const sqlite = getDatabase().sqlite;
  const waitUntil = sqlite.transaction(() => {
    const row = sqlite
      .prepare('SELECT enabled,request_interval_ms,next_request_at FROM source_settings WHERE source_id=?')
      .get(sourceId);
    if (
      !row ||
      typeof row !== 'object' ||
      !('enabled' in row) ||
      !('request_interval_ms' in row) ||
      !('next_request_at' in row) ||
      typeof row.enabled !== 'number' ||
      typeof row.request_interval_ms !== 'number' ||
      typeof row.next_request_at !== 'number'
    ) {
      throw new AppError('SOURCE_DISABLED', 'Source settings are unavailable', 409);
    }
    if (row.enabled !== 1) throw new AppError('SOURCE_DISABLED', 'This source is disabled', 409);
    const now = Date.now();
    const reserved = Math.max(now, row.next_request_at);
    sqlite
      .prepare('UPDATE source_settings SET next_request_at=? WHERE source_id=?')
      .run(reserved + Math.max(minimumDelayMs, row.request_interval_ms), sourceId);
    return reserved;
  })();
  const remaining = waitUntil - Date.now();
  if (remaining > 0) await delay(remaining);
}

function contextFor(adapter: SourceAdapter, signal: AbortSignal): SourceContext {
  return {
    signal,
    fetchHtml: createSourceTransport({
      signal,
      allowedHosts: adapter.hosts,
      beforeRequest: (minimum) => reserveSourceRequest(adapter.id, minimum),
    }),
  };
}

export function startImport(input: ImportInput): Job {
  const normalized = normalizeImport({ ...input });
  const { url } = normalized;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError('INVALID_URL', 'Enter a valid chapter URL');
  }
  parsed.hash = '';
  const adapter = configuredSourceForUrl(parsed);
  const settings = getDatabase()
    .sqlite.prepare('SELECT enabled FROM source_settings WHERE source_id=?')
    .get(adapter.id);
  if (!settings || typeof settings !== 'object' || !('enabled' in settings) || settings.enabled !== 1)
    throw new AppError('SOURCE_DISABLED', 'This source is disabled', 409);
  const payload = { ...normalized, url: parsed.href };
  const key = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return enqueueJob({ kind: 'import', payload, dedupeKey: `import:${key}`, origin: 'manual' });
}

export function queueCheckUpdates(novelId: string, origin: 'manual' | 'automatic' = 'manual'): Job {
  const novel = getDatabase().sqlite.prepare('SELECT id FROM novels WHERE id=?').get(novelId);
  if (!novel) throw new AppError('NOVEL_NOT_FOUND', 'Novel not found', 404);
  return enqueueJob({ kind: 'check_updates', payload: { novelId }, dedupeKey: `check:${novelId}`, origin, novelId });
}

export function queueChapterFetch(chapterId: string): Job {
  const sqlite = getDatabase().sqlite;
  const chapter = sqlite.prepare('SELECT id,novel_id FROM chapters WHERE id=?').get(chapterId) as
    | { id: string; novel_id: string }
    | undefined;
  if (!chapter) throw new AppError('CHAPTER_NOT_FOUND', 'Chapter not found', 404);
  sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM translations WHERE chapter_id=?').run(chapterId);
    sqlite.prepare('DELETE FROM translation_runs WHERE chapter_id=?').run(chapterId);
    sqlite
      .prepare('UPDATE chapters SET paragraphs=NULL,source_hash=NULL,fetched_at=NULL,updated_at=? WHERE id=?')
      .run(Date.now(), chapterId);
  })();
  return enqueueJob({
    kind: 'fetch_chapter',
    payload: { chapterId },
    dedupeKey: `fetch:${chapterId}`,
    origin: 'manual',
    novelId: chapter.novel_id,
    chapterId,
  });
}

function saveDiscovery(
  adapter: SourceAdapter,
  input: ImportInput,
  novel: NovelRef,
  listed: ChapterRef[],
): { novelId: string; discovered: number; fetchChapterIds: string[] } {
  const inputBoundary = listed.findIndex((chapter) => chapter.url === input.url);
  if (inputBoundary < 0)
    throw new AppError('SEED_NOT_IN_DIRECTORY', 'Submitted chapter is not present in the directory');
  const sqlite = getDatabase().sqlite;
  return sqlite.transaction(() => {
    const now = Date.now();
    const existing = sqlite
      .prepare('SELECT * FROM novels WHERE source_id=? AND source_novel_id=?')
      .get(adapter.id, novel.sourceNovelId) as NovelRow | undefined;
    const novelId = existing?.id ?? randomUUID();
    let boundary = inputBoundary;
    let includeStart = input.includeStart;
    if (existing) {
      const previousBoundary = listed.findIndex((chapter) => chapter.url === existing.start_chapter_url);
      if (previousBoundary < 0)
        throw new AppError('IMPORT_BOUNDARY_MISSING', 'Saved import boundary is missing from the source');
      if (previousBoundary < boundary) {
        boundary = previousBoundary;
        includeStart = existing.include_start === 1;
      } else if (previousBoundary === boundary) {
        includeStart ||= existing.include_start === 1;
      }
    }
    const startOrdinal = chapterOrdinal(input.chapterNumber, boundary - inputBoundary);
    if (existing) {
      sqlite
        .prepare(
          'UPDATE novels SET title=?,custom_title=?,author=COALESCE(?,author),description=?,index_url=?,start_chapter_url=?,start_ordinal=?,include_start=?,updated_at=? WHERE id=?',
        )
        .run(
          input.title,
          input.title,
          input.author ?? null,
          input.description,
          novel.indexUrl,
          listed[boundary]!.url,
          startOrdinal,
          includeStart ? 1 : 0,
          now,
          novelId,
        );
    } else {
      sqlite
        .prepare(
          `INSERT INTO novels(id,source_id,source_novel_id,title,author,description,index_url,start_chapter_url,start_ordinal,include_start,auto_translate,auto_check,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,0,0,?,?)`,
        )
        .run(
          novelId,
          adapter.id,
          novel.sourceNovelId,
          input.title,
          input.author ?? null,
          input.description,
          novel.indexUrl,
          input.url,
          startOrdinal,
          includeStart ? 1 : 0,
          now,
          now,
        );
    }
    const first = boundary + (includeStart ? 0 : 1);
    const fetchChapterIds: string[] = [];
    for (let index = 0; index < listed.length; index += 1) {
      const reference = listed[index]!;
      const known = sqlite
        .prepare('SELECT * FROM chapters WHERE novel_id=? AND source_chapter_id=?')
        .get(novelId, reference.sourceChapterId) as ChapterRow | undefined;
      if (!known && index < first) continue;
      const ordinal = chapterOrdinal(input.chapterNumber, index - inputBoundary);
      if (known) {
        sqlite
          .prepare('UPDATE chapters SET canonical_url=?,ordinal=?,title=?,updated_at=? WHERE id=?')
          .run(reference.url, ordinal, reference.title, now, known.id);
        if (known.paragraphs === null && index >= first) fetchChapterIds.push(known.id);
      } else {
        const id = randomUUID();
        sqlite
          .prepare(
            'INSERT INTO chapters(id,novel_id,source_chapter_id,canonical_url,ordinal,title,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
          )
          .run(id, novelId, reference.sourceChapterId, reference.url, ordinal, reference.title, now, now);
        fetchChapterIds.push(id);
      }
    }
    return { novelId, discovered: listed.length - first, fetchChapterIds };
  })();
}

export async function handleImportJob(job: Job, signal: AbortSignal): Promise<{ deferred: boolean }> {
  if (!job.leaseToken) throw new AppError('INVALID_LEASE', 'Import job has no lease', 500);
  if (typeof job.payload.title !== 'string' || typeof job.payload.chapterNumber !== 'number') {
    throw new AppError(
      'INVALID_JOB',
      'This import predates manual novel details. Re-add it using the Add novel modal with a title and chapter number.',
    );
  }
  const input = normalizeImport(job.payload);
  const url = new URL(input.url);
  url.hash = '';
  input.url = url.href;
  const adapter = configuredSourceForUrl(url);
  const context = contextFor(adapter, signal);
  const novel = adapter.resolveNovel(url);
  const listed = await adapter.listChapters(novel, context);
  const result = saveDiscovery(adapter, input, novel, listed);
  for (const chapterId of result.fetchChapterIds)
    enqueueJob({
      kind: 'fetch_chapter',
      payload: { chapterId },
      dedupeKey: `fetch:${chapterId}`,
      parentJobId: job.id,
      novelId: result.novelId,
      chapterId,
    });
  const progress = {
    discovered: result.discovered,
    queued: result.fetchChapterIds.length,
    message: result.discovered === 0 ? 'No later chapters available' : undefined,
    novelId: result.novelId,
  };
  if (result.fetchChapterIds.length === 0) {
    deferParentJob(job.id, job.leaseToken, progress);
    finalizeParentJob(job.id);
    return { deferred: true };
  }
  deferParentJob(job.id, job.leaseToken, progress);
  return { deferred: true };
}

export async function handleCheckUpdatesJob(job: Job, signal: AbortSignal): Promise<{ deferred: boolean }> {
  if (!job.leaseToken) throw new AppError('INVALID_LEASE', 'Check job has no lease', 500);
  const novelId = job.novelId ?? requireString(job.payload, 'novelId');
  const sqlite = getDatabase().sqlite;
  const novel = sqlite.prepare('SELECT * FROM novels WHERE id=?').get(novelId) as NovelRow | undefined;
  if (!novel) throw new AppError('NOVEL_NOT_FOUND', 'Novel not found', 404);
  const adapter = configuredSourceById(novel.source_id);
  const context = contextFor(adapter, signal);
  const listed = await adapter.listChapters(
    { sourceNovelId: novel.source_novel_id, indexUrl: novel.index_url },
    context,
  );
  const boundary = listed.findIndex((chapter) => chapter.url === novel.start_chapter_url);
  if (boundary < 0) throw new AppError('IMPORT_BOUNDARY_MISSING', 'Saved import boundary is missing from the source');
  const selected = listed.slice(boundary + (novel.include_start ? 0 : 1));
  const now = Date.now();
  const missing = sqlite.transaction(() => {
    const ids: string[] = [];
    for (let index = 0; index < selected.length; index += 1) {
      const reference = selected[index]!;
      const ordinal = novel.start_ordinal + index + (novel.include_start ? 0 : 1);
      if (!Number.isSafeInteger(ordinal))
        throw new AppError('INVALID_CHAPTER_NUMBER', 'Chapter numbering exceeds the safe integer range');
      const row = sqlite
        .prepare('SELECT * FROM chapters WHERE novel_id=? AND source_chapter_id=?')
        .get(novelId, reference.sourceChapterId) as ChapterRow | undefined;
      if (row) {
        sqlite
          .prepare('UPDATE chapters SET canonical_url=?,ordinal=?,title=?,updated_at=? WHERE id=?')
          .run(reference.url, ordinal, reference.title, now, row.id);
        if (row.paragraphs === null) ids.push(row.id);
      } else {
        const id = randomUUID();
        sqlite
          .prepare(
            'INSERT INTO chapters(id,novel_id,source_chapter_id,canonical_url,ordinal,title,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
          )
          .run(id, novelId, reference.sourceChapterId, reference.url, ordinal, reference.title, now, now);
        ids.push(id);
      }
    }
    sqlite
      .prepare('UPDATE novels SET last_checked_at=?,next_check_at=?,updated_at=? WHERE id=?')
      .run(now, now + 6 * 60 * 60 * 1000, now, novelId);
    return ids;
  })();
  for (const chapterId of missing)
    enqueueJob({
      kind: 'fetch_chapter',
      payload: { chapterId },
      dedupeKey: `fetch:${chapterId}`,
      parentJobId: job.id,
      novelId,
      chapterId,
    });
  const progress = { discovered: selected.length, queued: missing.length };
  deferParentJob(job.id, job.leaseToken, progress);
  if (missing.length === 0) finalizeParentJob(job.id);
  return { deferred: true };
}

export async function handleFetchChapterJob(job: Job, signal: AbortSignal): Promise<void> {
  const chapterId = job.chapterId ?? requireString(job.payload, 'chapterId');
  const sqlite = getDatabase().sqlite;
  const row = sqlite
    .prepare('SELECT c.*,n.source_id FROM chapters c JOIN novels n ON n.id=c.novel_id WHERE c.id=?')
    .get(chapterId);
  if (
    !row ||
    typeof row !== 'object' ||
    !('source_id' in row) ||
    !('canonical_url' in row) ||
    !('source_chapter_id' in row) ||
    !('ordinal' in row) ||
    !('title' in row) ||
    typeof row.source_id !== 'string' ||
    typeof row.canonical_url !== 'string' ||
    typeof row.source_chapter_id !== 'string' ||
    typeof row.ordinal !== 'number' ||
    typeof row.title !== 'string'
  )
    throw new AppError('CHAPTER_NOT_FOUND', 'Chapter not found', 404);
  if ('paragraphs' in row && row.paragraphs !== null) return;
  const adapter = configuredSourceById(row.source_id);
  const result = await adapter.fetchChapter(
    { sourceChapterId: row.source_chapter_id, url: row.canonical_url, ordinal: row.ordinal, title: row.title },
    contextFor(adapter, signal),
  );
  const serialized = JSON.stringify(result.paragraphs);
  const hash = createHash('sha256').update(serialized).digest('hex');
  sqlite
    .prepare(
      'UPDATE chapters SET title=?,paragraphs=?,source_hash=?,fetched_at=?,updated_at=? WHERE id=? AND paragraphs IS NULL',
    )
    .run(result.title, serialized, hash, Date.now(), Date.now(), chapterId);
}

export async function handleSourceCheckJob(job: Job, signal: AbortSignal): Promise<Record<string, unknown>> {
  const sourceId = requireString(job.payload, 'sourceId');
  const adapter = configuredSourceById(sourceId);
  const sqlite = getDatabase().sqlite;
  const known = sqlite
    .prepare('SELECT source_novel_id,index_url FROM novels WHERE source_id=? ORDER BY created_at LIMIT 1')
    .get(sourceId);
  const context = contextFor(adapter, signal);
  try {
    let progress: Record<string, unknown>;
    if (
      known &&
      typeof known === 'object' &&
      'source_novel_id' in known &&
      'index_url' in known &&
      typeof known.source_novel_id === 'string' &&
      typeof known.index_url === 'string'
    ) {
      const chapters = await adapter.listChapters(
        { sourceNovelId: known.source_novel_id, indexUrl: known.index_url },
        context,
      );
      progress = { ok: true, checkedAt: Date.now(), chapters: chapters.length };
    } else {
      const html = await context.fetchHtml(`https://${adapter.hosts[0]}/`);
      if (!/<html[\s>]/i.test(html)) throw new AppError('SOURCE_LAYOUT_CHANGED', 'Source homepage did not return HTML');
      progress = { ok: true, checkedAt: Date.now(), bytes: html.length };
    }
    sqlite
      .prepare('UPDATE source_settings SET last_checked_at=?,last_error=NULL WHERE source_id=?')
      .run(Date.now(), sourceId);
    return progress;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Source check failed';
    sqlite
      .prepare('UPDATE source_settings SET last_checked_at=?,last_error=? WHERE source_id=?')
      .run(Date.now(), message, sourceId);
    throw error;
  }
}
