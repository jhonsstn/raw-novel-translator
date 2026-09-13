import { migrate } from '@novel/db';
import { AppError, getTtsSettings, sanitizedError, updateTtsSettings } from '@novel/core';
import { z, ZodError } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z
  .object({
    baseUrl: z.string().url().nullable().optional(),
    model: z.string().trim().max(200).nullable().optional(),
    language: z.string().trim().max(100).nullable().optional(),
    apiKey: z.string().max(1000).optional(),
    clearApiKey: z.boolean().optional(),
    voice: z.string().trim().min(1).max(100).optional(),
    speed: z.number().finite().min(0.25).max(4).optional(),
    pitch: z.number().int().min(-12).max(12).optional(),
    timeoutSeconds: z.number().int().min(10).max(300).optional(),
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

export async function GET(): Promise<Response> {
  try {
    migrate();
    return json(getTtsSettings());
  } catch (error) {
    if (error instanceof AppError) return json({ error: { code: error.code, message: error.message } }, error.status);
    return json({ error: { code: 'INTERNAL_ERROR', message: sanitizedError(error) } }, 500);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    migrate();
    requireSameOrigin(request);
    const body: unknown = await request.json();
    return json(updateTtsSettings(schema.parse(body)));
  } catch (error) {
    if (error instanceof ZodError)
      return json({ error: { code: 'INVALID_BODY', message: error.issues[0]?.message ?? 'Request body is invalid' } }, 400);
    if (error instanceof AppError) return json({ error: { code: error.code, message: error.message } }, error.status);
    return json({ error: { code: 'INTERNAL_ERROR', message: sanitizedError(error) } }, 500);
  }
}
