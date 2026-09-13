import { randomUUID } from 'node:crypto';
import { getDatabase } from '@novel/db';
import { AppError, errorDiagnostics, sanitizedDiagnosticText, sanitizedError } from './errors.js';

export type JobKind =
  'import' | 'check_updates' | 'fetch_chapter' | 'translate_chapter' | 'source_check' | 'provider_check';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export interface Job {
  id: string;
  kind: JobKind;
  payload: Record<string, unknown>;
  dedupeKey: string | null;
  status: JobStatus;
  origin: 'manual' | 'automatic';
  attempt: number;
  runAfter: number;
  leaseToken: string | null;
  leaseExpiresAt: number | null;
  progress: Record<string, unknown> | null;
  error: string | null;
  parentJobId: string | null;
  novelId: string | null;
  chapterId: string | null;
  createdAt: number;
  updatedAt: number;
}
export interface EnqueueJobInput {
  kind: JobKind;
  payload?: Record<string, unknown>;
  dedupeKey?: string | null;
  origin?: 'manual' | 'automatic';
  runAfter?: number;
  parentJobId?: string | null;
  novelId?: string | null;
  chapterId?: string | null;
}

interface JobRow {
  id: string;
  kind: string;
  payload: string;
  dedupe_key: string | null;
  status: string;
  origin: string;
  attempt: number;
  run_after: number;
  lease_token: string | null;
  lease_expires_at: number | null;
  progress: string | null;
  error: string | null;
  parent_job_id: string | null;
  novel_id: string | null;
  chapter_id: string | null;
  created_at: number;
  updated_at: number;
}

function objectJson(value: string | null): Record<string, unknown> | null {
  if (value === null) return null;
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new AppError('CORRUPT_JOB', 'Stored job data is invalid', 500);
  return { ...parsed };
}

function hydrate(row: JobRow): Job {
  return {
    id: row.id,
    kind: row.kind as JobKind,
    payload: objectJson(row.payload) ?? {},
    dedupeKey: row.dedupe_key,
    status: row.status as JobStatus,
    origin: row.origin as 'manual' | 'automatic',
    attempt: row.attempt,
    runAfter: row.run_after,
    leaseToken: row.lease_token,
    leaseExpiresAt: row.lease_expires_at,
    progress: objectJson(row.progress),
    error: row.error,
    parentJobId: row.parent_job_id,
    novelId: row.novel_id,
    chapterId: row.chapter_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getJob(id: string): Job | null {
  const row = getDatabase().sqlite.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  return row ? hydrate(row as JobRow) : null;
}

export function enqueueJob(input: EnqueueJobInput): Job {
  const sqlite = getDatabase().sqlite;
  const now = Date.now();
  const id = randomUUID();
  try {
    sqlite
      .prepare(
        `INSERT INTO jobs(id,kind,payload,dedupe_key,status,origin,attempt,run_after,parent_job_id,novel_id,chapter_id,created_at,updated_at)
      VALUES (?,?,?,?, 'queued', ?,0,?,?,?,?,?,?)`,
      )
      .run(
        id,
        input.kind,
        JSON.stringify(input.payload ?? {}),
        input.dedupeKey ?? null,
        input.origin ?? 'manual',
        input.runAfter ?? now,
        input.parentJobId ?? null,
        input.novelId ?? null,
        input.chapterId ?? null,
        now,
        now,
      );
  } catch (error) {
    if (input.dedupeKey && error instanceof Error && /unique/i.test(error.message)) {
      const existing = sqlite
        .prepare("SELECT * FROM jobs WHERE dedupe_key = ? AND status IN ('queued','running')")
        .get(input.dedupeKey);
      if (existing) return hydrate(existing as JobRow);
    }
    throw error;
  }
  const created = getJob(id);
  if (!created) throw new AppError('JOB_CREATE_FAILED', 'Job could not be created', 500);
  return created;
}

const laneKinds: Record<'source' | 'translation', readonly JobKind[]> = {
  source: ['import', 'check_updates', 'fetch_chapter', 'source_check'],
  translation: ['translate_chapter', 'provider_check'],
};

export function claimJob(lane: 'source' | 'translation', now: number): Job | null {
  const sqlite = getDatabase().sqlite;
  return sqlite.transaction(() => {
    const placeholders = laneKinds[lane].map(() => '?').join(',');
    sqlite
      .prepare(
        `UPDATE jobs SET status='queued', lease_token=NULL, lease_expires_at=NULL, updated_at=? WHERE status='running' AND lease_expires_at < ? AND kind IN (${placeholders})`,
      )
      .run(now, now, ...laneKinds[lane]);
    const row = sqlite
      .prepare(
        `SELECT * FROM jobs WHERE status='queued' AND run_after <= ? AND kind IN (${placeholders}) ORDER BY created_at,id LIMIT 1`,
      )
      .get(now, ...laneKinds[lane]);
    if (!row) return null;
    const candidate = hydrate(row as JobRow);
    const token = randomUUID();
    const changed = sqlite
      .prepare(
        "UPDATE jobs SET status='running', attempt=attempt+1, lease_token=?, lease_expires_at=?, updated_at=? WHERE id=? AND status='queued'",
      )
      .run(token, now + 90_000, now, candidate.id);
    if (changed.changes !== 1) return null;
    if (typeof candidate.payload.sourceId === 'string') {
      recordJobEvent(candidate.id, token, 'Source selected', `Source: ${candidate.payload.sourceId}`);
    }
    return getJob(candidate.id);
  })();
}

export function heartbeatJob(id: string, token: string, now = Date.now()): boolean {
  return (
    getDatabase()
      .sqlite.prepare(
        "UPDATE jobs SET lease_expires_at=?, updated_at=? WHERE id=? AND status='running' AND lease_token=?",
      )
      .run(now + 90_000, now, id, token).changes === 1
  );
}

export function updateJobProgress(id: string, token: string, progress: Record<string, unknown>): boolean {
  return (
    getDatabase()
      .sqlite.prepare("UPDATE jobs SET progress=?, updated_at=? WHERE id=? AND status='running' AND lease_token=?")
      .run(JSON.stringify(progress), Date.now(), id, token).changes === 1
  );
}

/** Context must be explicitly selected by callers, not serialized payloads or requests. */
export function recordJobEvent(jobId: string, token: string, message: string, details?: string): boolean {
  return (
    getDatabase()
      .sqlite.prepare(
        `INSERT INTO job_events(job_id,attempt,level,message,details,created_at)
    SELECT id,attempt,'info',?,?,? FROM jobs WHERE id=? AND status='running' AND lease_token=?`,
      )
      .run(
        sanitizedDiagnosticText(message, 1000),
        details === undefined ? null : sanitizedDiagnosticText(details),
        Date.now(),
        jobId,
        token,
      ).changes === 1
  );
}

export function finishJob(id: string, token: string, progress?: Record<string, unknown>): boolean {
  return (
    getDatabase()
      .sqlite.prepare(
        "UPDATE jobs SET status='succeeded', progress=COALESCE(?,progress), lease_token=NULL, lease_expires_at=NULL, error=NULL, updated_at=? WHERE id=? AND status='running' AND lease_token=?",
      )
      .run(progress ? JSON.stringify(progress) : null, Date.now(), id, token).changes === 1
  );
}

export function deferParentJob(id: string, token: string, progress: Record<string, unknown>): boolean {
  return (
    getDatabase()
      .sqlite.prepare(
        "UPDATE jobs SET progress=?, lease_token=NULL, lease_expires_at=NULL, updated_at=? WHERE id=? AND status='running' AND lease_token=?",
      )
      .run(JSON.stringify(progress), Date.now(), id, token).changes === 1
  );
}

export function finalizeParentJob(id: string): void {
  const sqlite = getDatabase().sqlite;
  const rows = sqlite
    .prepare('SELECT status, count(*) AS count FROM jobs WHERE parent_job_id=? GROUP BY status')
    .all(id);
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (
      row &&
      typeof row === 'object' &&
      'status' in row &&
      'count' in row &&
      typeof row.status === 'string' &&
      typeof row.count === 'number'
    )
      counts[row.status] = row.count;
  }
  if ((counts.queued ?? 0) + (counts.running ?? 0) > 0) return;
  const failed = counts.failed ?? 0;
  const progress = { downloaded: counts.succeeded ?? 0, failed, cancelled: counts.cancelled ?? 0 };
  sqlite
    .prepare(
      "UPDATE jobs SET status=?, progress=?, error=?, updated_at=? WHERE id=? AND status='running' AND lease_token IS NULL",
    )
    .run(
      failed > 0 ? 'failed' : 'succeeded',
      JSON.stringify(progress),
      failed > 0 ? `${failed} chapter download(s) failed` : null,
      Date.now(),
      id,
    );
}

export function failJob(id: string, token: string, error: unknown): boolean {
  const sqlite = getDatabase().sqlite;
  return sqlite.transaction(() => {
    const now = Date.now();
    const summary = sanitizedError(error);
    const changed =
      sqlite
        .prepare(
          "UPDATE jobs SET status='failed', error=?, lease_token=NULL, lease_expires_at=NULL, updated_at=? WHERE id=? AND status='running' AND lease_token=?",
        )
        .run(summary, now, id, token).changes === 1;
    if (!changed) return false;
    sqlite
      .prepare(
        `INSERT INTO job_events(job_id,attempt,level,message,details,created_at)
      SELECT id,attempt,'error',?,?,? FROM jobs WHERE id=?`,
      )
      .run(summary, errorDiagnostics(error), now, id);
    return true;
  })();
}

export function cancelJob(id: string): boolean {
  const sqlite = getDatabase().sqlite;
  return sqlite.transaction(() => {
    const changed =
      sqlite
        .prepare(
          "UPDATE jobs SET status='cancelled', lease_token=NULL, lease_expires_at=NULL, updated_at=? WHERE id=? AND status IN ('queued','running')",
        )
        .run(Date.now(), id).changes === 1;
    sqlite
      .prepare("UPDATE jobs SET status='cancelled', updated_at=? WHERE parent_job_id=? AND status='queued'")
      .run(Date.now(), id);
    return changed;
  })();
}

export function retryJob(id: string): Job {
  const sqlite = getDatabase().sqlite;
  return sqlite.transaction(() => {
    const original = getJob(id);
    if (!original || original.status !== 'failed')
      throw new AppError('NOT_RETRYABLE', 'Only failed jobs can be retried', 409);
    const retried = enqueueJob({
      kind: original.kind,
      payload: original.payload,
      dedupeKey: original.dedupeKey,
      origin: 'manual',
      parentJobId: original.parentJobId,
      novelId: original.novelId,
      chapterId: original.chapterId,
    });
    const insert = sqlite.prepare(
      "INSERT INTO job_events(job_id,attempt,level,message,details,created_at) VALUES (?,?,'info',?,?,?)",
    );
    const now = Date.now();
    insert.run(original.id, original.attempt, 'Retry requested', `Retry job: ${retried.id}`, now);
    insert.run(retried.id, retried.attempt, 'Retry of failed job', `Previous job: ${original.id}`, now);
    return retried;
  })();
}

export function listJobs(page = 1, filter: 'active' | 'failed' | 'all' = 'all'): { items: Job[]; total: number } {
  const sqlite = getDatabase().sqlite;
  const where =
    filter === 'active' ? "WHERE status IN ('queued','running')" : filter === 'failed' ? "WHERE status='failed'" : '';
  const rows = sqlite
    .prepare(`SELECT * FROM jobs ${where} ORDER BY created_at DESC LIMIT 50 OFFSET ?`)
    .all((Math.max(page, 1) - 1) * 50);
  const totalRow = sqlite.prepare(`SELECT count(*) AS count FROM jobs ${where}`).get();
  const total =
    totalRow && typeof totalRow === 'object' && 'count' in totalRow && typeof totalRow.count === 'number'
      ? totalRow.count
      : 0;
  return { items: rows.map((row) => hydrate(row as JobRow)), total };
}
