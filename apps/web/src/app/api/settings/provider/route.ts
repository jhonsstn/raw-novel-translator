import { AppError, getProviderSettings, sanitizedError, updateProviderSettings } from '@novel/core';
import { migrate } from '@novel/db';
import { z, ZodError } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z
  .object({
    baseUrl: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    apiKey: z.string().optional(),
    clearApiKey: z.boolean().optional(),
    timeoutSeconds: z.number().int().optional(),
    chunkCharacters: z.number().int().optional(),
    translationConcurrency: z.number().int().optional(),
  })
  .strict();

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

export function GET(): Response {
  try {
    migrate();
    return json(getProviderSettings());
  } catch (error) {
    if (error instanceof AppError) return json({ error: { code: error.code, message: error.message } }, error.status);
    return json({ error: { code: 'INTERNAL_ERROR', message: sanitizedError(error) } }, 500);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    migrate();
    requireSameOrigin(request);
    const length = Number(request.headers.get('content-length') ?? 0);
    if (length > 128 * 1024) throw new AppError('BODY_TOO_LARGE', 'JSON request is limited to 128 KiB', 413);
    const body: unknown = await request.json();
    return json(updateProviderSettings(schema.parse(body)));
  } catch (error) {
    if (error instanceof ZodError)
      return json({ error: { code: 'INVALID_BODY', message: error.issues[0]?.message ?? 'Request body is invalid' } }, 400);
    if (error instanceof AppError) return json({ error: { code: error.code, message: error.message } }, error.status);
    return json({ error: { code: 'INTERNAL_ERROR', message: sanitizedError(error) } }, 500);
  }
}
