import { migrate } from '@novel/db';
import {
  AppError,
  cancelJob,
  createSourceDefinition,
  deleteSourceDefinition,
  getChapter,
  getCover,
  getJob,
  getNovel,
  getProviderSettings,
  getWorkerHealth,
  listActivity,
  listJobEvents,
  listJobs,
  listNovels,
  listSourceSettings,
  queueCheckUpdates,
  queueProviderCheck,
  queueSourceCheck,
  queueTranslation,
  removeNovel,
  retryJob,
  sanitizedError,
  setAutomaticPause,
  setNovelAutomation,
  startImport,
  updateNovelMetadata,
  updateProviderSettings,
  updateReadingProgress,
  updateSourceDefinition,
  updateSourceSettings,
} from '@novel/core';
import { z, ZodError, type ZodType } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext { params: Promise<{ path: string[] }> }
const JSON_LIMIT = 128 * 1024;
const MULTIPART_LIMIT = 6 * 1024 * 1024;
const COVER_LIMIT = 5 * 1024 * 1024;

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

function requireSameOrigin(request: Request): void {
  const configured = process.env.APP_ORIGIN;
  if (!configured) throw new AppError('APP_ORIGIN_REQUIRED', 'APP_ORIGIN is required', 500);
  let expected: URL;
  try { expected = new URL(configured); } catch { throw new AppError('APP_ORIGIN_INVALID', 'APP_ORIGIN must be an absolute URL', 500); }
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (origin !== expected.origin || host !== expected.host) throw new AppError('INVALID_ORIGIN', 'Cross-origin state changes are not allowed', 403);
}

async function boundedBytes(request: Request, limit: number, message: string): Promise<Uint8Array> {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > limit) throw new AppError('BODY_TOO_LARGE', message, 413);
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new AppError('BODY_TOO_LARGE', message, 413);
    }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function jsonBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const bytes = await boundedBytes(request, JSON_LIMIT, 'JSON request is limited to 128 KiB');
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new AppError('INVALID_JSON', 'Request body must be valid JSON'); }
  return schema.parse(value);
}

function jobResponse(job: { id: string }): Response { return json({ jobId: job.id }, 202); }

const importSchema = z.object({
  url: z.string().url(),
  includeStart: z.boolean(),
  title: z.string().trim().min(1, 'Novel title is required').max(300, 'Novel title must be 300 characters or fewer'),
  description: z.string().trim().max(10000, 'Description must be 10,000 characters or fewer').nullish().transform(value => value || null),
  chapterNumber: z.number().int('Chapter number must be a whole number').min(1, 'Chapter number must be positive').max(Number.MAX_SAFE_INTEGER, 'Chapter number must be a safe integer'),
}).strict();
const automationSchema = z.object({ autoTranslate: z.boolean().optional(), autoCheck: z.boolean().optional() }).strict();
const progressSchema = z.object({ chapterId: z.string().min(1), mode: z.enum(['source', 'en']), scrollRatio: z.number().finite(), completed: z.boolean().optional() }).strict();
const translationSchema = z.object({ regenerate: z.boolean().optional() }).strict();
const providerSchema = z.object({ baseUrl: z.string().nullable().optional(), model: z.string().nullable().optional(), apiKey: z.string().optional(), clearApiKey: z.boolean().optional(), timeoutSeconds: z.number().int().optional(), chunkCharacters: z.number().int().optional() }).strict();
const pauseSchema = z.object({ paused: z.boolean() }).strict();
const sourceSchema = z.object({ enabled: z.boolean().optional(), requestIntervalMs: z.number().int().optional() }).strict();
const optionalSourceText = z.string().max(1000).nullable().optional();
const sourceDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(100),
  siteUrl: z.string().url().max(1000),
  chapterPathPattern: z.string().min(1).max(1000),
  indexPathTemplate: z.string().min(1).max(1000),
  novelIdTemplate: optionalSourceText,
  chapterIdTemplate: optionalSourceText,
  chapterLinkSelector: z.string().min(1).max(1000),
  chapterTitleSelector: z.string().min(1).max(1000),
  chapterTitleExcludeSelector: optionalSourceText,
  chapterContentSelector: optionalSourceText,
  chapterContentStartSelector: optionalSourceText,
  chapterContentEndSelector: optionalSourceText,
  chapterContentEndText: optionalSourceText,
  chapterContentExcludeSelector: optionalSourceText,
}).strict();

async function metadataBody(request: Request) {
  const bytes = await boundedBytes(request, MULTIPART_LIMIT, 'Metadata request is limited to 6 MiB');
  const headers = new Headers(request.headers);
  headers.set('content-length', String(bytes.byteLength));
  const form = await new Request(request.url, { method: 'POST', headers, body: Uint8Array.from(bytes).buffer }).formData();
  const allowed = new Set(['customTitle', 'useSourceTitle', 'description', 'coverAction', 'cover']);
  const seen = new Set<string>();
  for (const [key] of form.entries()) {
    if (!allowed.has(key)) throw new AppError('INVALID_BODY', `Unrecognized metadata field: ${key}`);
    if (seen.has(key)) throw new AppError('INVALID_BODY', `Duplicate metadata field: ${key}`);
    seen.add(key);
  }
  const useSourceTitle = form.get('useSourceTitle');
  const customTitle = form.get('customTitle');
  const description = form.get('description');
  const coverAction = form.get('coverAction');
  const file = form.get('cover');
  if (useSourceTitle !== 'true' && useSourceTitle !== 'false') throw new AppError('INVALID_BODY', 'useSourceTitle must be true or false');
  if (typeof customTitle !== 'string' || typeof description !== 'string' || !['keep', 'remove', 'replace'].includes(String(coverAction))) throw new AppError('INVALID_BODY', 'Metadata fields are invalid');
  if (useSourceTitle === 'true' && customTitle.trim()) throw new AppError('INVALID_BODY', 'A custom title cannot be combined with useSourceTitle');
  if (coverAction === 'replace') {
    if (!(file instanceof File)) throw new AppError('INVALID_BODY', 'A replacement cover file is required');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new AppError('INVALID_COVER', 'Cover must be JPEG, PNG, or WebP');
    if (file.size > COVER_LIMIT) throw new AppError('BODY_TOO_LARGE', 'Cover image is limited to 5 MiB', 413);
  } else if (file instanceof File && file.size > 0) {
    throw new AppError('INVALID_BODY', 'A cover file is only valid with coverAction=replace');
  }
  const cover = coverAction === 'remove'
    ? { action: 'remove' as const }
    : coverAction === 'replace' && file instanceof File
      ? { action: 'replace' as const, bytes: new Uint8Array(await file.arrayBuffer()) }
      : { action: 'keep' as const };
  return { customTitle: useSourceTitle === 'true' ? null : customTitle.trim() || null, description: description.trim() || null, cover };
}

async function dispatch(request: Request, context: RouteContext): Promise<Response> {
  migrate();
  const { path } = await context.params;
  const url = new URL(request.url);
  const method = request.method;
  if (!['GET', 'HEAD'].includes(method)) requireSameOrigin(request);

  if (method === 'GET' && path.length === 1 && path[0] === 'novels') return json(listNovels(url.searchParams.get('search') ?? ''));
  if (method === 'POST' && path.length === 1 && path[0] === 'imports') {
    const body = await jsonBody(request, importSchema);
    return jobResponse(startImport(body));
  }
  if (path[0] === 'novels' && path.length === 2) {
    if (method === 'GET') return json(getNovel(path[1]!));
    if (method === 'DELETE') { removeNovel(path[1]!); return new Response(null, { status: 204 }); }
    if (method === 'PATCH') {
      const body = await jsonBody(request, automationSchema);
      setNovelAutomation(path[1]!, body);
      return json(getNovel(path[1]!));
    }
  }
  if (method === 'POST' && path[0] === 'novels' && path.length === 3 && path[2] === 'check') return jobResponse(queueCheckUpdates(path[1]!));
  if (method === 'PUT' && path[0] === 'novels' && path.length === 3 && path[2] === 'progress') {
    const body = await jsonBody(request, progressSchema);
    return json(updateReadingProgress({ novelId: path[1]!, ...body }));
  }
  if (method === 'GET' && path[0] === 'novels' && path.length === 3 && path[2] === 'cover') {
    const cover = getCover(path[1]!);
    const etag = `"${cover.etag}"`;
    const headers = { 'Content-Type': 'image/webp', ETag: etag, 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff' };
    if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
    return new Response(new Uint8Array(cover.image), { headers });
  }
  if (method === 'PUT' && path[0] === 'novels' && path.length === 3 && path[2] === 'metadata') {
    await updateNovelMetadata(path[1]!, await metadataBody(request));
    return json(getNovel(path[1]!));
  }
  if (method === 'GET' && path[0] === 'chapters' && path.length === 2) return json(getChapter(path[1]!));
  if (method === 'POST' && path[0] === 'chapters' && path.length === 3 && path[2] === 'translation') {
    const body = await jsonBody(request, translationSchema);
    return jobResponse(queueTranslation(path[1]!, body.regenerate ?? false));
  }
  if (method === 'GET' && path.length === 1 && path[0] === 'jobs') {
    const filter = url.searchParams.get('filter');
    return json(listJobs(Number(url.searchParams.get('page') ?? 1), filter === 'active' || filter === 'failed' ? filter : 'all'));
  }
  if (method === 'GET' && path[0] === 'jobs' && path.length === 2) {
    const job = getJob(path[1]!);
    if (!job) throw new AppError('JOB_NOT_FOUND', 'Job not found', 404);
    return json(job);
  }
  if (method === 'GET' && path[0] === 'jobs' && path.length === 3 && path[2] === 'events') {
    if (!getJob(path[1]!)) throw new AppError('JOB_NOT_FOUND', 'Job not found', 404);
    return json(listJobEvents(path[1]!));
  }
  if (method === 'POST' && path[0] === 'jobs' && path.length === 3 && path[2] === 'retry') return jobResponse(retryJob(path[1]!));
  if (method === 'POST' && path[0] === 'jobs' && path.length === 3 && path[2] === 'cancel') return json({ cancelled: cancelJob(path[1]!) });
  if (method === 'GET' && path.length === 1 && path[0] === 'activity') return json(listActivity(Number(url.searchParams.get('limit') ?? 100)));
  if (path.join('/') === 'settings/provider') {
    if (method === 'GET') return json(getProviderSettings());
    if (method === 'PATCH') return json(updateProviderSettings(await jsonBody(request, providerSchema)));
  }
  if (method === 'POST' && path.join('/') === 'settings/provider/test') return jobResponse(queueProviderCheck());
  if (method === 'PATCH' && path.join('/') === 'settings/automation') {
    const body = await jsonBody(request, pauseSchema);
    return json(setAutomaticPause(body.paused));
  }
  if (path.length === 1 && path[0] === 'sources') {
    if (method === 'GET') return json(listSourceSettings());
    if (method === 'POST') {
      const created = createSourceDefinition(await jsonBody(request, sourceDefinitionSchema));
      return json(listSourceSettings().find((item) => item.sourceId === created.id), 201);
    }
  }
  if (path[0] === 'sources' && path.length === 2) {
    if (method === 'PATCH') return json(updateSourceSettings(path[1]!, await jsonBody(request, sourceSchema)));
    if (method === 'PUT') {
      updateSourceDefinition(path[1]!, await jsonBody(request, sourceDefinitionSchema));
      return json(listSourceSettings().find((item) => item.sourceId === path[1]));
    }
    if (method === 'DELETE') { deleteSourceDefinition(path[1]!); return new Response(null, { status: 204 }); }
  }
  if (method === 'POST' && path[0] === 'sources' && path.length === 3 && path[2] === 'check') return jobResponse(queueSourceCheck(path[1]!));
  if (method === 'GET' && path.length === 1 && path[0] === 'health') return json(getWorkerHealth());
  throw new AppError('NOT_FOUND', 'API route not found', 404);
}

async function handle(request: Request, context: RouteContext): Promise<Response> {
  try { return await dispatch(request, context); }
  catch (error) {
    if (error instanceof ZodError) return json({ error: { code: 'INVALID_BODY', message: error.issues[0]?.message ?? 'Request body is invalid' } }, 400);
    if (error instanceof AppError) return json({ error: { code: error.code, message: error.message } }, error.status);
    return json({ error: { code: 'INTERNAL_ERROR', message: sanitizedError(error) } }, 500);
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
