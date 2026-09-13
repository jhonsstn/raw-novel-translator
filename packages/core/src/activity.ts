import { getDatabase } from '@novel/db';

export interface JobEvent {
  id: number;
  jobId: string;
  attempt: number;
  level: 'info' | 'error';
  message: string;
  details: string | null;
  createdAt: number;
}

export function listJobEvents(jobId: string): JobEvent[] {
  return getDatabase()
    .sqlite.prepare(
      `SELECT id,job_id AS jobId,attempt,level,message,details,created_at AS createdAt
    FROM (SELECT * FROM job_events WHERE job_id=? ORDER BY id DESC LIMIT 200) ORDER BY id`,
    )
    .all(jobId) as JobEvent[];
}

interface ActivityRow {
  id: string;
  kind: string;
  status: string;
  origin: string;
  attempt: number;
  progress: string | null;
  error: string | null;
  novel_id: string | null;
  chapter_id: string | null;
  created_at: number;
  updated_at: number;
  novel_title: string | null;
  chapter_title: string | null;
}

function objectOrNull(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  const parsed: unknown = JSON.parse(value);
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

export function listActivity(limit = 100) {
  const safeLimit = Math.min(250, Math.max(1, Math.trunc(limit)));
  const rows = getDatabase()
    .sqlite.prepare(
      `SELECT j.id,j.kind,j.status,j.origin,j.attempt,j.progress,j.error,j.novel_id,j.chapter_id,j.created_at,j.updated_at,
    COALESCE(n.custom_title,n.title) novel_title,c.title chapter_title FROM jobs j LEFT JOIN novels n ON n.id=j.novel_id LEFT JOIN chapters c ON c.id=j.chapter_id ORDER BY j.created_at DESC LIMIT ?`,
    )
    .all(safeLimit) as ActivityRow[];
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    status: row.status,
    origin: row.origin,
    attempt: row.attempt,
    progress: objectOrNull(row.progress),
    error: row.error,
    novelId: row.novel_id,
    chapterId: row.chapter_id,
    novelTitle: row.novel_title,
    chapterTitle: row.chapter_title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function getWorkerHealth() {
  const row = getDatabase().sqlite.prepare('SELECT heartbeat_at FROM worker_state WHERE id=1').get() as
    { heartbeat_at: number } | undefined;
  const heartbeatAt = row?.heartbeat_at ?? null;
  return { heartbeatAt, healthy: heartbeatAt !== null && Date.now() - heartbeatAt < 30_000 };
}
