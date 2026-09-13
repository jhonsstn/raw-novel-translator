import { createHash } from 'node:crypto';
import { getDatabase } from '@novel/db';
import sharp from 'sharp';
import { AppError } from './errors.js';

export type CoverAction = { action: 'keep' } | { action: 'remove' } | { action: 'replace'; bytes: Uint8Array };
export interface NovelMetadataInput {
  customTitle: string | null;
  author: string | null;
  description: string | null;
  cover: CoverAction;
}
interface NormalizedCover {
  bytes: Buffer;
  hash: string;
  width: number;
  height: number;
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

export function normalizeNovelText(input: Pick<NovelMetadataInput, 'customTitle' | 'description'>): {
  customTitle: string | null;
  description: string | null;
} {
  const customTitle = input.customTitle?.trim() ?? null;
  if (input.customTitle !== null && !customTitle)
    throw new AppError('INVALID_TITLE', 'Custom title cannot be blank; use source title instead');
  if (customTitle && codePointLength(customTitle) > 300)
    throw new AppError('INVALID_TITLE', 'Custom title is limited to 300 characters');
  const description = input.description?.replace(/\r\n?/g, '\n').trim() || null;
  if (description && codePointLength(description) > 10_000)
    throw new AppError('INVALID_DESCRIPTION', 'Description is limited to 10,000 characters');
  return { customTitle, description };
}

function detectedSignature(bytes: Uint8Array): 'jpeg' | 'png' | 'webp' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (
    bytes.length >= 8 &&
    Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'png';
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' &&
    Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP'
  )
    return 'webp';
  return null;
}

export async function normalizeCover(bytes: Uint8Array): Promise<NormalizedCover> {
  if (bytes.byteLength > 5 * 1024 * 1024) throw new AppError('COVER_TOO_LARGE', 'Cover input is limited to 5 MiB', 413);
  const signature = detectedSignature(bytes);
  if (!signature) throw new AppError('INVALID_COVER', 'Cover must be a JPEG, PNG, or WebP image');
  try {
    const image = sharp(bytes, { failOn: 'warning', limitInputPixels: 20_000_000, animated: false });
    const metadata = await image.metadata();
    if (metadata.format !== signature || !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1)
      throw new AppError('INVALID_COVER', 'Cover must be one valid static JPEG, PNG, or WebP image');
    const result = await image
      .rotate()
      .resize({ width: 800, height: 1200, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    if (result.data.byteLength > 2 * 1024 * 1024)
      throw new AppError('COVER_TOO_LARGE', 'Normalized cover exceeds 2 MiB', 413);
    if (!result.info.width || !result.info.height) throw new AppError('INVALID_COVER', 'Cover dimensions are invalid');
    return {
      bytes: result.data,
      hash: createHash('sha256').update(result.data).digest('hex'),
      width: result.info.width,
      height: result.info.height,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('INVALID_COVER', 'Cover image is malformed, truncated, animated, or too large');
  }
}

export async function updateNovelMetadata(novelId: string, input: NovelMetadataInput): Promise<void> {
  const sqlite = getDatabase().sqlite;
  if (!sqlite.prepare('SELECT 1 FROM novels WHERE id=?').get(novelId))
    throw new AppError('NOVEL_NOT_FOUND', 'Novel not found', 404);
  const text = normalizeNovelText(input);
  const author = input.author?.trim() || null;
  if (author && codePointLength(author) > 300)
    throw new AppError('INVALID_AUTHOR', 'Author name is limited to 300 characters');
  const cover = input.cover.action === 'replace' ? await normalizeCover(input.cover.bytes) : null;
  sqlite.transaction(() => {
    const now = Date.now();
    const changed = sqlite
      .prepare('UPDATE novels SET custom_title=?,author=?,description=?,updated_at=? WHERE id=?')
      .run(text.customTitle, author, text.description, now, novelId);
    if (changed.changes !== 1) throw new AppError('NOVEL_NOT_FOUND', 'Novel not found', 404);
    if (input.cover.action === 'remove') sqlite.prepare('DELETE FROM novel_covers WHERE novel_id=?').run(novelId);
    if (cover)
      sqlite
        .prepare(
          `INSERT INTO novel_covers(novel_id,image,content_hash,width,height,updated_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(novel_id) DO UPDATE SET image=excluded.image,content_hash=excluded.content_hash,width=excluded.width,height=excluded.height,updated_at=excluded.updated_at`,
        )
        .run(novelId, cover.bytes, cover.hash, cover.width, cover.height, now);
  })();
}
