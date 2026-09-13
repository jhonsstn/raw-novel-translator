import { getDatabase } from '@novel/db';
import { AppError } from './errors.js';
import { queueTranslation } from './translations.js';

interface WindowChapter {
  id: string;
  paragraphs: string | null;
  ordinal: number;
  translated: number;
  job_status: string | null;
}

export function reconcileTranslationWindow(novelId: string): void {
  const sqlite = getDatabase().sqlite;
  const novel = sqlite.prepare('SELECT auto_translate FROM novels WHERE id=?').get(novelId);
  if (!novel || typeof novel !== 'object' || !('auto_translate' in novel))
    throw new AppError('NOVEL_NOT_FOUND', 'Novel not found', 404);
  const settings = sqlite
    .prepare(
      'SELECT base_url,model,encrypted_api_key,automatic_paused,translation_concurrency FROM provider_settings WHERE id=1',
    )
    .get();
  const enabled =
    novel.auto_translate === 1 &&
    settings &&
    typeof settings === 'object' &&
    'automatic_paused' in settings &&
    'base_url' in settings &&
    'model' in settings &&
    'encrypted_api_key' in settings &&
    settings.automatic_paused === 0 &&
    typeof settings.base_url === 'string' &&
    typeof settings.model === 'string' &&
    typeof settings.encrypted_api_key === 'string';
  const concurrency =
    settings &&
    typeof settings === 'object' &&
    'translation_concurrency' in settings &&
    typeof settings.translation_concurrency === 'number'
      ? settings.translation_concurrency
      : 1;
  const current = sqlite
    .prepare('SELECT c.ordinal FROM reading_progress p JOIN chapters c ON c.id=p.current_chapter_id WHERE p.novel_id=?')
    .get(novelId);
  const startOrdinal =
    current && typeof current === 'object' && 'ordinal' in current && typeof current.ordinal === 'number'
      ? current.ordinal
      : -1;
  const windowSize = Math.max(5, concurrency);
  const window = sqlite
    .prepare(
      `SELECT c.id,c.paragraphs,c.ordinal,EXISTS(SELECT 1 FROM translations t WHERE t.chapter_id=c.id) AS translated,
      (SELECT j.status FROM jobs j WHERE j.chapter_id=c.id AND j.kind='translate_chapter' ORDER BY j.created_at DESC LIMIT 1) AS job_status
    FROM chapters c WHERE c.novel_id=? AND c.read_at IS NULL AND c.ordinal>=? ORDER BY c.ordinal LIMIT ?`,
    )
    .all(novelId, startOrdinal, windowSize) as WindowChapter[];
  const ids = window.map((chapter) => chapter.id);
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    sqlite
      .prepare(
        `UPDATE jobs SET status='cancelled',updated_at=? WHERE novel_id=? AND kind='translate_chapter' AND origin='automatic' AND status='queued' AND chapter_id NOT IN (${placeholders})`,
      )
      .run(Date.now(), novelId, ...ids);
  } else
    sqlite
      .prepare(
        "UPDATE jobs SET status='cancelled',updated_at=? WHERE novel_id=? AND kind='translate_chapter' AND origin='automatic' AND status='queued'",
      )
      .run(Date.now(), novelId);
  if (!enabled) return;
  const baseRunAfter = Date.now();
  let queueOffset = 0;
  for (const chapter of window) {
    if (
      chapter.paragraphs !== null &&
      chapter.translated === 0 &&
      chapter.job_status !== 'failed' &&
      chapter.job_status !== 'queued' &&
      chapter.job_status !== 'running'
    ) {
      queueTranslation(chapter.id, false, 'automatic', baseRunAfter + queueOffset);
      queueOffset += 1;
    }
  }
}

export function setNovelAutomation(
  novelId: string,
  input: { autoTranslate?: boolean | undefined; autoCheck?: boolean | undefined },
): void {
  const sqlite = getDatabase().sqlite;
  const exists = sqlite.prepare('SELECT 1 FROM novels WHERE id=?').get(novelId);
  if (!exists) throw new AppError('NOVEL_NOT_FOUND', 'Novel not found', 404);
  if (input.autoTranslate === true) {
    const settings = sqlite.prepare('SELECT base_url,model,encrypted_api_key FROM provider_settings WHERE id=1').get();
    if (
      !settings ||
      typeof settings !== 'object' ||
      !('base_url' in settings) ||
      !('model' in settings) ||
      !('encrypted_api_key' in settings) ||
      !settings.base_url ||
      !settings.model ||
      !settings.encrypted_api_key
    )
      throw new AppError('PROVIDER_NOT_CONFIGURED', 'Configure the translation provider first', 409);
  }
  const updates: string[] = [];
  const values: number[] = [];
  if (input.autoTranslate !== undefined) {
    updates.push('auto_translate=?');
    values.push(input.autoTranslate ? 1 : 0);
  }
  if (input.autoCheck !== undefined) {
    updates.push('auto_check=?', 'next_check_at=?');
    values.push(input.autoCheck ? 1 : 0, input.autoCheck ? Date.now() + 6 * 60 * 60 * 1000 : 0);
  }
  if (updates.length > 0)
    sqlite
      .prepare(`UPDATE novels SET ${updates.join(',')},updated_at=? WHERE id=?`)
      .run(...values, Date.now(), novelId);
  if (input.autoTranslate === false)
    sqlite
      .prepare(
        "UPDATE jobs SET status='cancelled',updated_at=? WHERE novel_id=? AND kind='translate_chapter' AND origin='automatic' AND status='queued'",
      )
      .run(Date.now(), novelId);
  reconcileTranslationWindow(novelId);
}
