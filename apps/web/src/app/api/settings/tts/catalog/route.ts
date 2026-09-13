import { migrate } from '@novel/db';
import { AppError, getTtsCatalog, sanitizedError } from '@novel/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: Request): Promise<Response> {
  try {
    migrate();
    const language = new URL(request.url).searchParams.get('language')?.trim() || undefined;
    return json(await getTtsCatalog(language));
  } catch (error) {
    if (error instanceof AppError) return json({ error: { code: error.code, message: error.message } }, error.status);
    return json({ error: { code: 'TTS_CATALOG_FAILED', message: sanitizedError(error) } }, 502);
  }
}