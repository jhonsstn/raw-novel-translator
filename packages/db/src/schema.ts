import { sql } from 'drizzle-orm';
import {
  blob,
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

const timestamps = {
  createdAt: integer('created_at').notNull().$defaultFn(Date.now),
  updatedAt: integer('updated_at').notNull().$defaultFn(Date.now),
};

export const novels = sqliteTable(
  'novels',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id').notNull(),
    sourceNovelId: text('source_novel_id').notNull(),
    title: text('title').notNull(),
    customTitle: text('custom_title'),
    description: text('description'),
    author: text('author'),
    indexUrl: text('index_url').notNull(),
    startChapterUrl: text('start_chapter_url').notNull(),
    startOrdinal: integer('start_ordinal').notNull(),
    includeStart: integer('include_start', { mode: 'boolean' }).notNull(),
    autoTranslate: integer('auto_translate', { mode: 'boolean' }).notNull().default(false),
    autoCheck: integer('auto_check', { mode: 'boolean' }).notNull().default(false),
    nextCheckAt: integer('next_check_at'),
    lastCheckedAt: integer('last_checked_at'),
    ...timestamps,
  },
  (t) => [uniqueIndex('novels_source_identity').on(t.sourceId, t.sourceNovelId)],
);

export const novelCovers = sqliteTable('novel_covers', {
  novelId: text('novel_id')
    .primaryKey()
    .references(() => novels.id, { onDelete: 'cascade' }),
  image: blob('image', { mode: 'buffer' }).notNull(),
  contentHash: text('content_hash').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const chapters = sqliteTable(
  'chapters',
  {
    id: text('id').primaryKey(),
    novelId: text('novel_id')
      .notNull()
      .references(() => novels.id, { onDelete: 'cascade' }),
    sourceChapterId: text('source_chapter_id').notNull(),
    canonicalUrl: text('canonical_url').notNull(),
    ordinal: integer('ordinal').notNull(),
    title: text('title').notNull(),
    paragraphs: text('paragraphs', { mode: 'json' }).$type<string[] | null>(),
    sourceHash: text('source_hash'),
    fetchedAt: integer('fetched_at'),
    readAt: integer('read_at'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('chapters_novel_source').on(t.novelId, t.sourceChapterId),
    uniqueIndex('chapters_canonical_url').on(t.canonicalUrl),
    index('chapters_novel_ordinal').on(t.novelId, t.ordinal),
  ],
);

export const readingProgress = sqliteTable(
  'reading_progress',
  {
    novelId: text('novel_id')
      .primaryKey()
      .references(() => novels.id, { onDelete: 'cascade' }),
    currentChapterId: text('current_chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
    sourceScrollRatio: real('source_scroll_ratio').notNull().default(0),
    englishScrollRatio: real('english_scroll_ratio').notNull().default(0),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    check('source_scroll_ratio_range', sql`${t.sourceScrollRatio} >= 0 AND ${t.sourceScrollRatio} <= 1`),
    check('english_scroll_ratio_range', sql`${t.englishScrollRatio} >= 0 AND ${t.englishScrollRatio} <= 1`),
  ],
);

export const translations = sqliteTable('translations', {
  chapterId: text('chapter_id')
    .primaryKey()
    .references(() => chapters.id, { onDelete: 'cascade' }),
  target: text('target').notNull().default('en'),
  paragraphs: text('paragraphs', { mode: 'json' }).notNull().$type<string[]>(),
  sourceHash: text('source_hash').notNull(),
  model: text('model').notNull(),
  baseUrl: text('base_url').notNull(),
  promptVersion: integer('prompt_version').notNull(),
  completedAt: integer('completed_at').notNull(),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
});

export const translationRuns = sqliteTable('translation_runs', {
  id: text('id').primaryKey(),
  chapterId: text('chapter_id')
    .notNull()
    .references(() => chapters.id, { onDelete: 'cascade' }),
  model: text('model').notNull(),
  baseUrl: text('base_url').notNull(),
  providerRevision: integer('provider_revision').notNull(),
  sourceHash: text('source_hash').notNull(),
  promptVersion: integer('prompt_version').notNull(),
  status: text('status').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const translationChunks = sqliteTable(
  'translation_chunks',
  {
    runId: text('run_id')
      .notNull()
      .references(() => translationRuns.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    input: text('input').notNull(),
    output: text('output'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
  },
  (t) => [uniqueIndex('translation_chunks_run_index').on(t.runId, t.chunkIndex)],
);

export const sourceDefinitions = sqliteTable('source_definitions', {
  sourceId: text('source_id').primaryKey(),
  name: text('name').notNull(),
  siteUrl: text('site_url').notNull(),
  chapterPathPattern: text('chapter_path_pattern').notNull(),
  indexPathTemplate: text('index_path_template').notNull(),
  novelIdTemplate: text('novel_id_template'),
  chapterIdTemplate: text('chapter_id_template'),
  chapterLinkSelector: text('chapter_link_selector').notNull(),
  chapterTitleSelector: text('chapter_title_selector').notNull(),
  chapterTitleExcludeSelector: text('chapter_title_exclude_selector'),
  chapterContentSelector: text('chapter_content_selector').notNull(),
  chapterContentStartSelector: text('chapter_content_start_selector'),
  chapterContentEndSelector: text('chapter_content_end_selector'),
  chapterContentEndText: text('chapter_content_end_text'),
  chapterContentExcludeSelector: text('chapter_content_exclude_selector'),
  ...timestamps,
});

export const sourceSettings = sqliteTable(
  'source_settings',
  {
    sourceId: text('source_id').primaryKey(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    requestIntervalMs: integer('request_interval_ms').notNull().default(2000),
    nextRequestAt: integer('next_request_at').notNull().default(0),
    lastError: text('last_error'),
    lastCheckedAt: integer('last_checked_at'),
  },
  (t) => [check('source_interval_min', sql`${t.requestIntervalMs} >= 2000`)],
);

export const providerSettings = sqliteTable(
  'provider_settings',
  {
    id: integer('id').primaryKey().default(1),
    baseUrl: text('base_url'),
    model: text('model'),
    encryptedApiKey: text('encrypted_api_key'),
    revision: integer('revision').notNull().default(1),
    timeoutSeconds: integer('timeout_seconds').notNull().default(120),
    chunkCharacters: integer('chunk_characters').notNull().default(10000),
    automaticPaused: integer('automatic_paused', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    check('provider_singleton', sql`${t.id} = 1`),
    check('provider_timeout_range', sql`${t.timeoutSeconds} BETWEEN 30 AND 600`),
    check('provider_chunk_range', sql`${t.chunkCharacters} BETWEEN 500 AND 15000`),
  ],
);

export const ttsSettings = sqliteTable(
  'tts_settings',
  {
    id: integer('id').primaryKey().default(1),
    baseUrl: text('base_url'),
    model: text('model'),
    encryptedApiKey: text('encrypted_api_key'),
    language: text('language'),
    voice: text('voice').notNull().default('alloy'),
    speed: real('speed').notNull().default(1),
    pitch: integer('pitch').notNull().default(0),
    timeoutSeconds: integer('timeout_seconds').notNull().default(60),
    revision: integer('revision').notNull().default(1),
  },
  (t) => [
    check('tts_singleton', sql`${t.id} = 1`),
    check('tts_speed_range', sql`${t.speed} BETWEEN 0.25 AND 4.0`),
    check('tts_pitch_range', sql`${t.pitch} BETWEEN -12 AND 12`),
    check('tts_timeout_range', sql`${t.timeoutSeconds} BETWEEN 10 AND 300`),
  ],
);

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    payload: text('payload', { mode: 'json' }).notNull().$type<Record<string, unknown>>(),
    dedupeKey: text('dedupe_key'),
    status: text('status').notNull().default('queued'),
    origin: text('origin').notNull().default('manual'),
    attempt: integer('attempt').notNull().default(0),
    runAfter: integer('run_after').notNull(),
    leaseToken: text('lease_token'),
    leaseExpiresAt: integer('lease_expires_at'),
    progress: text('progress', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    error: text('error'),
    parentJobId: text('parent_job_id').references((): AnySQLiteColumn => jobs.id, { onDelete: 'set null' }),
    novelId: text('novel_id').references(() => novels.id, { onDelete: 'cascade' }),
    chapterId: text('chapter_id').references(() => chapters.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (t) => [
    index('jobs_status_run_after').on(t.status, t.runAfter),
    index('jobs_parent').on(t.parentJobId),
    index('jobs_novel').on(t.novelId),
  ],
);

export const jobEvents = sqliteTable(
  'job_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    attempt: integer('attempt').notNull(),
    level: text('level', { enum: ['info', 'error'] }).notNull(),
    message: text('message').notNull(),
    details: text('details'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('job_events_job_id_id').on(t.jobId, t.id),
    check('job_events_level', sql`${t.level} IN ('info', 'error')`),
  ],
);

export const workerState = sqliteTable(
  'worker_state',
  {
    id: integer('id').primaryKey().default(1),
    heartbeatAt: integer('heartbeat_at').notNull(),
  },
  (t) => [check('worker_singleton', sql`${t.id} = 1`)],
);

export type Novel = typeof novels.$inferSelect;
export type Chapter = typeof chapters.$inferSelect;
export type Job = typeof jobs.$inferSelect;
