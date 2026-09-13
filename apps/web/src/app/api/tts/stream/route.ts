import { migrate } from '@novel/db';
import { AppError, createTtsSpeech, sanitizedError } from '@novel/core';
import { z, ZodError } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  segments: z.array(z.object({ index: z.number().int().min(0), part: z.number().int().min(0), text: z.string().trim().min(1).max(4096) }).strict()).min(1).max(200),
}).strict();

function requireSameOrigin(request: Request): void {
  const configured = process.env.APP_ORIGIN;
  if (!configured) throw new AppError('APP_ORIGIN_REQUIRED', 'APP_ORIGIN is required', 500);
  const expected = new URL(configured);
  if (request.headers.get('origin') !== expected.origin || request.headers.get('host') !== expected.host)
    throw new AppError('INVALID_ORIGIN', 'Cross-origin state changes are not allowed', 403);
}

function event(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`;
}

export async function POST(request: Request): Promise<Response> {
  try {
    migrate();
    requireSameOrigin(request);
    const body = schema.parse(await request.json());
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for (const segment of body.segments) {
            const audio = await createTtsSpeech(segment.text, request.signal);
            controller.enqueue(
              encoder.encode(
                event({
                  type: 'audio.segment',
                  index: segment.index,
                  part: segment.part,
                  audio: Buffer.from(audio.bytes).toString('base64'),
                }),
              ),
            );
          }
          controller.enqueue(encoder.encode(event({ type: 'audio.done' })));
          controller.close();
        } catch (error) {
          controller.enqueue(encoder.encode(event({ type: 'audio.error', message: sanitizedError(error) })));
          controller.close();
        }
      },
      cancel() {
        request.signal.throwIfAborted();
      },
    });
    return new Response(stream, { headers: { 'Cache-Control': 'no-store', Connection: 'keep-alive', 'Content-Type': 'text/event-stream' } });
  } catch (error) {
    if (error instanceof ZodError)
      return Response.json({ error: { code: 'INVALID_BODY', message: error.issues[0]?.message ?? 'Request body is invalid' } }, { status: 400 });
    if (error instanceof AppError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    return Response.json({ error: { code: 'TTS_STREAM_FAILED', message: sanitizedError(error) } }, { status: 502 });
  }
}