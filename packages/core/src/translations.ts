import { randomUUID } from 'node:crypto';
import { getDatabase } from '@novel/db';
import { chunkParagraphs, PROMPT_VERSION, translateChunk } from '@novel/translation';
import { AppError } from './errors.js';
import { enqueueJob, type Job } from './jobs.js';
import { getProviderCredentials, getProviderSettings } from './settings.js';

interface ChapterTranslationRow { id: string; novel_id: string; paragraphs: string | null; source_hash: string | null }
interface RunRow { id: string; status: string }
interface ChunkRow { chunk_index: number; input: string; output: string | null; input_tokens: number | null; output_tokens: number | null }

function stringParagraphs(value: string | null): string[] {
  if (!value) throw new AppError('CHAPTER_NOT_DOWNLOADED', 'Chapter has not been downloaded', 409);
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) throw new AppError('CORRUPT_CHAPTER', 'Stored chapter content is invalid', 500);
  return [...parsed];
}

export function queueTranslation(chapterId: string, regenerate: boolean, origin: 'manual' | 'automatic' = 'manual'): Job {
  const sqlite = getDatabase().sqlite;
  const chapter = sqlite.prepare('SELECT id,paragraphs FROM chapters WHERE id=?').get(chapterId);
  if (!chapter || typeof chapter !== 'object' || !('paragraphs' in chapter) || chapter.paragraphs === null) throw new AppError('CHAPTER_NOT_DOWNLOADED', 'Chapter has not been downloaded', 409);
  const translated = sqlite.prepare('SELECT 1 FROM translations WHERE chapter_id=?').get(chapterId);
  if (translated && !regenerate) throw new AppError('ALREADY_TRANSLATED', 'Chapter already has an English translation', 409);
  const provider = getProviderSettings();
  if (!provider.baseUrl || !provider.model || !provider.hasApiKey) throw new AppError('PROVIDER_NOT_CONFIGURED', 'Configure the translation provider first', 409);
  return enqueueJob({ kind: 'translate_chapter', payload: { chapterId, regenerate, providerRevision: provider.revision }, dedupeKey: `translate:${chapterId}`, origin, chapterId });
}

function latestCompatibleRun(chapterId: string, revision: number, sourceHash: string): RunRow | undefined {
  return getDatabase().sqlite.prepare('SELECT id,status FROM translation_runs WHERE chapter_id=? AND provider_revision=? AND source_hash=? AND prompt_version=? ORDER BY created_at DESC LIMIT 1').get(chapterId, revision, sourceHash, PROMPT_VERSION) as RunRow | undefined;
}

export async function handleTranslationJob(job: Job, signal: AbortSignal): Promise<Record<string, unknown>> {
  const chapterId = job.chapterId ?? (typeof job.payload.chapterId === 'string' ? job.payload.chapterId : '');
  if (!chapterId) throw new AppError('INVALID_JOB', 'Translation job has no chapter', 500);
  const sqlite = getDatabase().sqlite;
  const chapter = sqlite.prepare('SELECT id,novel_id,paragraphs,source_hash FROM chapters WHERE id=?').get(chapterId) as ChapterTranslationRow | undefined;
  if (!chapter?.source_hash) throw new AppError('CHAPTER_NOT_DOWNLOADED', 'Chapter has not been downloaded', 409);
  const paragraphs = stringParagraphs(chapter.paragraphs);
  const provider = getProviderCredentials();
  const expectedRevision = typeof job.payload.providerRevision === 'number' ? job.payload.providerRevision : provider.revision;
  if (provider.revision !== expectedRevision) throw new AppError('PROVIDER_CHANGED', 'Provider settings changed; retry with the current configuration', 409);
  let run = latestCompatibleRun(chapterId, provider.revision, chapter.source_hash);
  if (!run) {
    const id = randomUUID();
    const chunks = chunkParagraphs(paragraphs, provider.chunkCharacters);
    const now = Date.now();
    sqlite.transaction(() => {
      sqlite.prepare('INSERT INTO translation_runs(id,chapter_id,model,base_url,provider_revision,source_hash,prompt_version,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,\'running\',?,?)').run(id, chapterId, provider.model, provider.baseUrl, provider.revision, chapter.source_hash, PROMPT_VERSION, now, now);
      const insert = sqlite.prepare('INSERT INTO translation_chunks(run_id,chunk_index,input) VALUES (?,?,?)');
      chunks.forEach((input, index) => insert.run(id, index, input));
    })();
    run = { id, status: 'running' };
  } else sqlite.prepare("UPDATE translation_runs SET status='running',updated_at=? WHERE id=?").run(Date.now(), run.id);
  try {
    const chunks = sqlite.prepare('SELECT chunk_index,input,output,input_tokens,output_tokens FROM translation_chunks WHERE run_id=? ORDER BY chunk_index').all(run.id) as ChunkRow[];
    for (const chunk of chunks) {
      if (chunk.output !== null) continue;
      if (getProviderSettings().revision !== expectedRevision) throw new AppError('PROVIDER_CHANGED', 'Provider settings changed during translation', 409);
      const result = await translateChunk({ text: chunk.input, model: provider.model, baseUrl: provider.baseUrl, apiKey: provider.apiKey, timeoutMs: provider.timeoutSeconds * 1000, signal });
      sqlite.prepare('UPDATE translation_chunks SET output=?,input_tokens=?,output_tokens=? WHERE run_id=? AND chunk_index=? AND output IS NULL').run(JSON.stringify(result.paragraphs), result.inputTokens, result.outputTokens, run.id, chunk.chunk_index);
    }
    const completed = sqlite.prepare('SELECT chunk_index,input,output,input_tokens,output_tokens FROM translation_chunks WHERE run_id=? ORDER BY chunk_index').all(run.id) as ChunkRow[];
    const output: string[] = [];
    let inputTokens = 0; let outputTokens = 0; let hasInputTokens = true; let hasOutputTokens = true;
    for (const chunk of completed) {
      if (!chunk.output) throw new Error('Translation run is incomplete');
      output.push(...stringParagraphs(chunk.output));
      if (chunk.input_tokens === null) hasInputTokens = false; else inputTokens += chunk.input_tokens;
      if (chunk.output_tokens === null) hasOutputTokens = false; else outputTokens += chunk.output_tokens;
    }
    sqlite.transaction(() => {
      const current = sqlite.prepare('SELECT source_hash FROM chapters WHERE id=?').get(chapterId);
      const settings = getProviderSettings();
      if (!current || typeof current !== 'object' || !('source_hash' in current) || current.source_hash !== chapter.source_hash || settings.revision !== expectedRevision) throw new AppError('TRANSLATION_STALE', 'Chapter or provider changed before publication', 409);
      sqlite.prepare(`INSERT INTO translations(chapter_id,target,paragraphs,source_hash,model,base_url,prompt_version,completed_at,input_tokens,output_tokens) VALUES (?,'en',?,?,?,?,?,?,?,?)
        ON CONFLICT(chapter_id) DO UPDATE SET paragraphs=excluded.paragraphs,source_hash=excluded.source_hash,model=excluded.model,base_url=excluded.base_url,prompt_version=excluded.prompt_version,completed_at=excluded.completed_at,input_tokens=excluded.input_tokens,output_tokens=excluded.output_tokens`).run(chapterId, JSON.stringify(output), chapter.source_hash, provider.model, provider.baseUrl, PROMPT_VERSION, Date.now(), hasInputTokens ? inputTokens : null, hasOutputTokens ? outputTokens : null);
      sqlite.prepare("UPDATE translation_runs SET status='succeeded',updated_at=? WHERE id=?").run(Date.now(), run.id);
    })();
    return { chunks: completed.length, inputTokens: hasInputTokens ? inputTokens : null, outputTokens: hasOutputTokens ? outputTokens : null };
  } catch (error) {
    sqlite.prepare("UPDATE translation_runs SET status='failed',updated_at=? WHERE id=?").run(Date.now(), run.id);
    throw error;
  }
}

export async function handleProviderCheckJob(_job: Job, signal: AbortSignal): Promise<Record<string, unknown>> {
  const provider = getProviderCredentials();
  const result = await translateChunk({ text: '你好。', model: provider.model, baseUrl: provider.baseUrl, apiKey: provider.apiKey, timeoutMs: provider.timeoutSeconds * 1000, signal });
  return { response: result.paragraphs.join(' '), inputTokens: result.inputTokens, outputTokens: result.outputTokens };
}

export function queueProviderCheck(): Job {
  const provider = getProviderSettings();
  if (!provider.hasApiKey || !provider.baseUrl || !provider.model) throw new AppError('PROVIDER_NOT_CONFIGURED', 'Configure the translation provider first', 409);
  return enqueueJob({ kind: 'provider_check', payload: { providerRevision: provider.revision }, dedupeKey: 'provider-check', origin: 'manual' });
}
