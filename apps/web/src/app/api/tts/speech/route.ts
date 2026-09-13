import { migrate } from '@novel/db';
import { AppError, createTtsSpeech, sanitizedError } from '@novel/core';
import { z, ZodError } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ text: z.string().trim().min(1).max(4096) }).strict();

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

export async function POST(request: Request): Promise<Response> {
  try {
    migrate();
    requireSameOrigin(request);
    const body: unknown = await request.json();
    const { text } = schema.parse(body);
    const audio = await createTtsSpeech(text, request.signal);
    const bytes = Uint8Array.from(audio.bytes);
    return new Response(bytes.buffer, {
      headers: {
        'Content-Type': audio.contentType,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof ZodError)
      return json({ error: { code: 'INVALID_BODY', message: error.issues[0]?.message ?? 'Request body is invalid' } }, 400);
    if (error instanceof AppError) return json({ error: { code: error.code, message: error.message } }, error.status);
    return json({ error: { code: 'TTS_FAILED', message: sanitizedError(error) } }, 502);
  }
}
