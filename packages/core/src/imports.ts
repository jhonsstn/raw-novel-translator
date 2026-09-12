import { createHash, randomUUID } from 'node:crypto';
import { getDatabase } from '@novel/db';
import { createSourceTransport, sourceById, sourceForUrl, type ChapterRef, type NovelRef, type SourceAdapter, type SourceContext } from '@novel/sources';
import { AppError } from './errors.js';
import { deferParentJob, enqueueJob, finalizeParentJob, type Job } from './jobs.js';

interface NovelRow {
  id: string; source_id: string; source_novel_id: string; title: string; author: string | null; index_url: string;
  start_chapter_url: string; start_ordinal: number; include_start: number;
}
interface ChapterRow { id: string; novel_id: string; source_chapter_id: string; canonical_url: string; ordinal: number; title: string; paragraphs: string | null }
interface ResolvedChapter { novel: NovelRef; chapter: ChapterRef }

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
    const row = sqlite.prepare('SELECT enabled,request_interval_ms,next_request_at FROM source_settings WHERE source_id=?').get(sourceId);
    if (!row || typeof row !== 'object' || !('enabled' in row) || !('request_interval_ms' in row) || !('next_request_at' in row) || typeof row.enabled !== 'number' || typeof row.request_interval_ms !== 'number' || typeof row.next_request_at !== 'number') {
      throw new AppError('SOURCE_DISABLED', 'Source settings are unavailable', 409);
    }
    if (row.enabled !== 1) throw new AppError('SOURCE_DISABLED', 'This source is disabled', 409);
    const now = Date.now();
    const reserved = Math.max(now, row.next_request_at);
    sqlite.prepare('UPDATE source_settings SET next_request_at=? WHERE source_id=?').run(reserved + Math.max(minimumDelayMs, row.request_interval_ms), sourceId);
    return reserved;
  })();
  const remaining = waitUntil - Date.now();
  if (remaining > 0) await delay(remaining);
}

function contextFor(adapter: SourceAdapter, signal: AbortSignal): SourceContext {
  return { signal, fetchHtml: createSourceTransport({ signal, beforeRequest: (minimum) => reserveSourceRequest(adapter.id, minimum) }) };
}

export function startImport({ url, includeStart }: { url: string; includeStart: boolean }): Job {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new AppError('INVALID_URL', 'Enter a valid chapter URL'); }
  const adapter = sourceForUrl(parsed);
  const settings = getDatabase().sqlite.prepare('SELECT enabled FROM source_settings WHERE source_id=?').get(adapter.id);
  if (!settings || typeof settings !== 'object' || !('enabled' in settings) || settings.enabled !== 1) throw new AppError('SOURCE_DISABLED', 'This source is disabled', 409);
  return enqueueJob({ kind: 'import', payload: { url: parsed.href, includeStart }, dedupeKey: `import:${parsed.href}:${includeStart}`, origin: 'manual' });
}

export function queueCheckUpdates(novelId: string, origin: 'manual' | 'automatic' = 'manual'): Job {
  const novel = getDatabase().sqlite.prepare('SELECT id FROM novels WHERE id=?').get(novelId);
  if (!novel) throw new AppError('NOVEL_NOT_FOUND', 'Novel not found', 404);
  return enqueueJob({ kind: 'check_updates', payload: { novelId }, dedupeKey: `check:${novelId}`, origin, novelId });
}

function saveDiscovery(adapter: SourceAdapter, inputUrl: string, includeStart: boolean, resolved: ResolvedChapter, listed: ChapterRef[]): { novelId: string; discovered: number; fetchChapterIds: string[] } {
  const sqlite = getDatabase().sqlite;
  return sqlite.transaction(() => {
    const now = Date.now();
    const existing = sqlite.prepare('SELECT * FROM novels WHERE source_id=? AND source_novel_id=?').get(adapter.id, resolved.novel.sourceNovelId) as NovelRow | undefined;
    const novelId = existing?.id ?? randomUUID();
    if (existing) {
      sqlite.prepare('UPDATE novels SET title=?,author=?,index_url=?,updated_at=? WHERE id=?').run(resolved.novel.title, resolved.novel.author, resolved.novel.indexUrl, now, novelId);
    } else {
      sqlite.prepare(`INSERT INTO novels(id,source_id,source_novel_id,title,author,index_url,start_chapter_url,start_ordinal,include_start,auto_translate,auto_check,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,0,0,?,?)`).run(novelId, adapter.id, resolved.novel.sourceNovelId, resolved.novel.title, resolved.novel.author, resolved.novel.indexUrl, inputUrl, resolved.chapter.ordinal, includeStart ? 1 : 0, now, now);
    }
    const boundary = listed.findIndex((chapter) => chapter.url === resolved.chapter.url);
    if (boundary < 0) throw new AppError('SEED_NOT_IN_DIRECTORY', 'Submitted chapter is not present in the directory');
    const selected = listed.slice(boundary + (includeStart ? 0 : 1));
    const fetchChapterIds: string[] = [];
    for (const reference of selected) {
      const known = sqlite.prepare('SELECT * FROM chapters WHERE novel_id=? AND source_chapter_id=?').get(novelId, reference.sourceChapterId) as ChapterRow | undefined;
      if (known) {
        sqlite.prepare('UPDATE chapters SET canonical_url=?,ordinal=?,title=?,updated_at=? WHERE id=?').run(reference.url, reference.ordinal, reference.title, now, known.id);
        if (known.paragraphs === null) fetchChapterIds.push(known.id);
      } else {
        const id = randomUUID();
        sqlite.prepare('INSERT INTO chapters(id,novel_id,source_chapter_id,canonical_url,ordinal,title,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id, novelId, reference.sourceChapterId, reference.url, reference.ordinal, reference.title, now, now);
        fetchChapterIds.push(id);
      }
    }
    return { novelId, discovered: selected.length, fetchChapterIds };
  })();
}

export async function handleImportJob(job: Job, signal: AbortSignal): Promise<{ deferred: boolean }> {
  if (!job.leaseToken) throw new AppError('INVALID_LEASE', 'Import job has no lease', 500);
  const url = requireString(job.payload, 'url');
  const includeStart = job.payload.includeStart === true;
  const adapter = sourceForUrl(new URL(url));
  const context = contextFor(adapter, signal);
  const resolved = await adapter.resolveChapter(new URL(url), context);
  const listed = await adapter.listChapters(resolved.novel, context);
  const result = saveDiscovery(adapter, url, includeStart, resolved, listed);
  for (const chapterId of result.fetchChapterIds) enqueueJob({ kind: 'fetch_chapter', payload: { chapterId }, dedupeKey: `fetch:${chapterId}`, parentJobId: job.id, novelId: result.novelId, chapterId });
  const progress = { discovered: result.discovered, queued: result.fetchChapterIds.length, message: result.discovered === 0 ? 'No later chapters available' : undefined, novelId: result.novelId };
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
  const adapter = sourceById(novel.source_id);
  const context = contextFor(adapter, signal);
  const listed = await adapter.listChapters({ sourceNovelId: novel.source_novel_id, title: novel.title, author: novel.author, indexUrl: novel.index_url }, context);
  const boundary = listed.findIndex((chapter) => chapter.url === novel.start_chapter_url);
  if (boundary < 0) throw new AppError('IMPORT_BOUNDARY_MISSING', 'Saved import boundary is missing from the source');
  const selected = listed.slice(boundary + (novel.include_start ? 0 : 1));
  const now = Date.now();
  const missing = sqlite.transaction(() => {
    const ids: string[] = [];
    for (const reference of selected) {
      const row = sqlite.prepare('SELECT * FROM chapters WHERE novel_id=? AND source_chapter_id=?').get(novelId, reference.sourceChapterId) as ChapterRow | undefined;
      if (row) {
        sqlite.prepare('UPDATE chapters SET canonical_url=?,ordinal=?,title=?,updated_at=? WHERE id=?').run(reference.url, reference.ordinal, reference.title, now, row.id);
        if (row.paragraphs === null) ids.push(row.id);
      } else {
        const id = randomUUID();
        sqlite.prepare('INSERT INTO chapters(id,novel_id,source_chapter_id,canonical_url,ordinal,title,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id, novelId, reference.sourceChapterId, reference.url, reference.ordinal, reference.title, now, now);
        ids.push(id);
      }
    }
    sqlite.prepare('UPDATE novels SET last_checked_at=?,next_check_at=?,updated_at=? WHERE id=?').run(now, now + 6 * 60 * 60 * 1000, now, novelId);
    return ids;
  })();
  for (const chapterId of missing) enqueueJob({ kind: 'fetch_chapter', payload: { chapterId }, dedupeKey: `fetch:${chapterId}`, parentJobId: job.id, novelId, chapterId });
  const progress = { discovered: selected.length, queued: missing.length };
  deferParentJob(job.id, job.leaseToken, progress);
  if (missing.length === 0) finalizeParentJob(job.id);
  return { deferred: true };
}

export async function handleFetchChapterJob(job: Job, signal: AbortSignal): Promise<void> {
  const chapterId = job.chapterId ?? requireString(job.payload, 'chapterId');
  const sqlite = getDatabase().sqlite;
  const row = sqlite.prepare('SELECT c.*,n.source_id FROM chapters c JOIN novels n ON n.id=c.novel_id WHERE c.id=?').get(chapterId);
  if (!row || typeof row !== 'object' || !('source_id' in row) || !('canonical_url' in row) || !('source_chapter_id' in row) || !('ordinal' in row) || !('title' in row) || typeof row.source_id !== 'string' || typeof row.canonical_url !== 'string' || typeof row.source_chapter_id !== 'string' || typeof row.ordinal !== 'number' || typeof row.title !== 'string') throw new AppError('CHAPTER_NOT_FOUND', 'Chapter not found', 404);
  if ('paragraphs' in row && row.paragraphs !== null) return;
  const adapter = sourceById(row.source_id);
  const result = await adapter.fetchChapter({ sourceChapterId: row.source_chapter_id, url: row.canonical_url, ordinal: row.ordinal, title: row.title }, contextFor(adapter, signal));
  const serialized = JSON.stringify(result.paragraphs);
  const hash = createHash('sha256').update(serialized).digest('hex');
  sqlite.prepare('UPDATE chapters SET title=?,paragraphs=?,source_hash=?,fetched_at=?,updated_at=? WHERE id=? AND paragraphs IS NULL').run(result.title, serialized, hash, Date.now(), Date.now(), chapterId);
}

export async function handleSourceCheckJob(job: Job, signal: AbortSignal): Promise<Record<string, unknown>> {
  const sourceId = requireString(job.payload, 'sourceId');
  const adapter = sourceById(sourceId);
  const sqlite = getDatabase().sqlite;
  const known = sqlite.prepare('SELECT source_novel_id,title,author,index_url FROM novels WHERE source_id=? ORDER BY created_at LIMIT 1').get(sourceId);
  const context = contextFor(adapter, signal);
  try {
    let progress: Record<string, unknown>;
    if (known && typeof known === 'object' && 'source_novel_id' in known && 'title' in known && 'author' in known && 'index_url' in known && typeof known.source_novel_id === 'string' && typeof known.title === 'string' && (known.author === null || typeof known.author === 'string') && typeof known.index_url === 'string') {
      const chapters = await adapter.listChapters({ sourceNovelId: known.source_novel_id, title: known.title, author: known.author, indexUrl: known.index_url }, context);
      progress = { ok: true, checkedAt: Date.now(), chapters: chapters.length };
    } else {
      const html = await context.fetchHtml(`https://${adapter.hosts[0]}/`);
      if (!/<html[\s>]/i.test(html)) throw new AppError('SOURCE_LAYOUT_CHANGED', 'Source homepage did not return HTML');
      progress = { ok: true, checkedAt: Date.now(), bytes: html.length };
    }
    sqlite.prepare('UPDATE source_settings SET last_checked_at=?,last_error=NULL WHERE source_id=?').run(Date.now(), sourceId);
    return progress;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Source check failed';
    sqlite.prepare('UPDATE source_settings SET last_checked_at=?,last_error=? WHERE source_id=?').run(Date.now(), message, sourceId);
    throw error;
  }
}
