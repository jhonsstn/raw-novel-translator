import { getDatabase } from '@novel/db';
import { AppError } from './errors.js';

interface NovelListRow {
  id: string;
  title: string;
  custom_title: string | null;
  author: string | null;
  description: string | null;
  source_id: string;
  auto_translate: number;
  auto_check: number;
  chapter_count: number;
  downloaded_count: number;
  translated_count: number;
  current_chapter_id: string | null;
  cover_hash: string | null;
  updated_at: number;
  last_activity: number;
}

interface ChapterListRow {
  id: string;
  novel_id: string;
  ordinal: number;
  title: string;
  paragraphs: string | null;
  translated_paragraphs: string | null;
  translated_model: string | null;
  read_at: number | null;
  canonical_url: string;
  source_hash: string | null;
}

function decodeParagraphs(value: string | null): string[] | null {
  if (value === null) return null;
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string'))
    throw new AppError('CORRUPT_CONTENT', 'Stored chapter content is invalid', 500);
  return parsed;
}

export function listNovels(search = '') {
  const term = search.trim();
  const query = `%${term}%`;
  const rows = getDatabase()
    .sqlite.prepare(
      `SELECT n.id,n.title,n.custom_title,n.author,n.description,n.source_id,n.auto_translate,n.auto_check,n.updated_at,
    COUNT(c.id) chapter_count,COUNT(CASE WHEN c.paragraphs IS NOT NULL THEN 1 END) downloaded_count,COUNT(t.chapter_id) translated_count,
    p.current_chapter_id,cv.content_hash cover_hash,COALESCE(p.updated_at,n.created_at) last_activity
    FROM novels n LEFT JOIN chapters c ON c.novel_id=n.id LEFT JOIN translations t ON t.chapter_id=c.id
    LEFT JOIN reading_progress p ON p.novel_id=n.id LEFT JOIN novel_covers cv ON cv.novel_id=n.id
    WHERE ?='' OR n.title LIKE ? OR COALESCE(n.custom_title,'') LIKE ? OR COALESCE(n.author,'') LIKE ?
    GROUP BY n.id ORDER BY last_activity DESC,n.created_at DESC`,
    )
    .all(term, query, query, query) as NovelListRow[];
  return rows.map((row) => ({
    id: row.id,
    displayTitle: row.custom_title ?? row.title,
    sourceTitle: row.title,
    author: row.author,
    description: row.description,
    sourceId: row.source_id,
    autoTranslate: row.auto_translate === 1,
    autoCheck: row.auto_check === 1,
    chapterCount: row.chapter_count,
    downloadedCount: row.downloaded_count,
    translatedCount: row.translated_count,
    currentChapterId: row.current_chapter_id,
    coverUrl: row.cover_hash ? `/api/novels/${row.id}/cover?v=${row.cover_hash}` : null,
    updatedAt: row.updated_at,
  }));
}

export function getNovel(novelId: string) {
  const novel = listNovels().find((item) => item.id === novelId);
  if (!novel) throw new AppError('NOVEL_NOT_FOUND', 'Novel not found', 404);
  const chapters = getDatabase()
    .sqlite.prepare(
      `SELECT c.id,c.novel_id,c.ordinal,c.title,c.paragraphs,c.read_at,c.canonical_url,c.source_hash,t.paragraphs translated_paragraphs,t.model translated_model
    FROM chapters c LEFT JOIN translations t ON t.chapter_id=c.id WHERE c.novel_id=? ORDER BY c.ordinal`,
    )
    .all(novelId) as ChapterListRow[];
  const progress =
    getDatabase()
      .sqlite.prepare(
        'SELECT current_chapter_id,source_scroll_ratio,english_scroll_ratio,updated_at FROM reading_progress WHERE novel_id=?',
      )
      .get(novelId) ?? null;
  return {
    ...novel,
    chapters: chapters.map((chapter) => ({
      id: chapter.id,
      ordinal: chapter.ordinal,
      title: chapter.title,
      fetched: chapter.paragraphs !== null,
      translated: chapter.translated_paragraphs !== null,
      readAt: chapter.read_at,
      canonicalUrl: chapter.canonical_url,
    })),
    progress,
  };
}

export function getChapter(chapterId: string) {
  const row = getDatabase()
    .sqlite.prepare(
      `SELECT c.id,c.novel_id,c.ordinal,c.title,c.paragraphs,c.read_at,c.canonical_url,c.source_hash,t.paragraphs translated_paragraphs,t.model translated_model
    FROM chapters c LEFT JOIN translations t ON t.chapter_id=c.id WHERE c.id=?`,
    )
    .get(chapterId) as ChapterListRow | undefined;
  if (!row) throw new AppError('CHAPTER_NOT_FOUND', 'Chapter not found', 404);
  return {
    id: row.id,
    novelId: row.novel_id,
    ordinal: row.ordinal,
    title: row.title,
    sourceParagraphs: decodeParagraphs(row.paragraphs),
    englishParagraphs: decodeParagraphs(row.translated_paragraphs),
    translatedModel: row.translated_model,
    fetched: row.paragraphs !== null,
    translated: row.translated_paragraphs !== null,
    readAt: row.read_at,
    canonicalUrl: row.canonical_url,
  };
}

export function updateReadingProgress(input: {
  novelId: string;
  chapterId: string;
  mode: 'source' | 'en';
  scrollRatio: number;
  completed?: boolean | undefined;
}) {
  const scrollRatio = Math.min(1, Math.max(0, Number.isFinite(input.scrollRatio) ? input.scrollRatio : 0));
  const sqlite = getDatabase().sqlite;
  const chapter = sqlite.prepare('SELECT novel_id FROM chapters WHERE id=?').get(input.chapterId) as
    { novel_id: string } | undefined;
  if (!chapter || chapter.novel_id !== input.novelId)
    throw new AppError('CHAPTER_NOT_FOUND', 'Chapter not found in novel', 404);
  const now = Date.now();
  sqlite.transaction(() => {
    const current = sqlite
      .prepare(
        'SELECT current_chapter_id,source_scroll_ratio,english_scroll_ratio FROM reading_progress WHERE novel_id=?',
      )
      .get(input.novelId) as
      { current_chapter_id: string | null; source_scroll_ratio: number; english_scroll_ratio: number } | undefined;
    const sameChapter = current?.current_chapter_id === input.chapterId;
    const sourceRatio = input.mode === 'source' ? scrollRatio : sameChapter ? (current?.source_scroll_ratio ?? 0) : 0;
    const englishRatio = input.mode === 'en' ? scrollRatio : sameChapter ? (current?.english_scroll_ratio ?? 0) : 0;
    sqlite
      .prepare(
        `INSERT INTO reading_progress(novel_id,current_chapter_id,source_scroll_ratio,english_scroll_ratio,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(novel_id) DO UPDATE SET current_chapter_id=excluded.current_chapter_id,source_scroll_ratio=excluded.source_scroll_ratio,english_scroll_ratio=excluded.english_scroll_ratio,updated_at=excluded.updated_at`,
      )
      .run(input.novelId, input.chapterId, sourceRatio, englishRatio, now);
    if (input.completed !== undefined)
      sqlite
        .prepare('UPDATE chapters SET read_at=?,updated_at=? WHERE id=?')
        .run(input.completed ? now : null, now, input.chapterId);
  })();
  return { updatedAt: now };
}

export function removeNovel(novelId: string): void {
  const result = getDatabase().sqlite.prepare('DELETE FROM novels WHERE id=?').run(novelId);
  if (result.changes === 0) throw new AppError('NOVEL_NOT_FOUND', 'Novel not found', 404);
}

export function getCover(novelId: string) {
  const cover = getDatabase()
    .sqlite.prepare('SELECT image,content_hash,width,height,updated_at FROM novel_covers WHERE novel_id=?')
    .get(novelId) as
    { image: Buffer; content_hash: string; width: number; height: number; updated_at: number } | undefined;
  if (!cover) throw new AppError('COVER_NOT_FOUND', 'Cover not found', 404);
  return {
    image: cover.image,
    etag: cover.content_hash,
    width: cover.width,
    height: cover.height,
    updatedAt: cover.updated_at,
  };
}
