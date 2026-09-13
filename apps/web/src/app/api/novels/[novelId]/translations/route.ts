import { AppError, queueNovelTranslations, sanitizedError } from '@novel/core';
import { migrate } from '@novel/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

function requireSameOrigin(request: Request): void {
  const configured = process.env.APP_ORIGIN;
  if (!configured) throw new AppError('APP_ORIGIN_REQUIRED', 'APP_ORIGIN is required', 500);
  let expected: URL;
  try {
    expected = new URL(configured);
  } catch {
    throw new AppError('APP_ORIGIN_INVALID', 'APP_ORIGIN must be an absolute URL', 500);
  }
  if (request.headers.get('origin') !== expected.origin || request.headers.get('host') !== expected.host)
    throw new AppError('INVALID_ORIGIN', 'Cross-origin state changes are not allowed', 403);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ novelId: string }> },
): Promise<Response> {
  try {
    migrate();
    requireSameOrigin(request);
    const { novelId } = await context.params;
    return json(queueNovelTranslations(novelId), 202);
  } catch (error) {
    if (error instanceof AppError) return json({ error: { code: error.code, message: error.message } }, error.status);
    return json({ error: { code: 'INTERNAL_ERROR', message: sanitizedError(error) } }, 500);
  }
}
