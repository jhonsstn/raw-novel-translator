import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@novel/db', () => ({ migrate: vi.fn() }));
vi.mock('@novel/core', () => ({
  AppError: class extends Error {},
  createTtsSpeech: vi.fn(),
  sanitizedError: (error: unknown) => (error instanceof Error ? error.message : 'Unknown error'),
}));

import { createTtsSpeech } from '@novel/core';
import { POST } from '../src/app/api/tts/stream/route';

async function narrate(paragraphs: string[]) {
  const response = await POST(
    new Request('http://localhost/api/tts/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        origin: 'http://localhost',
        host: 'localhost',
      },
      body: JSON.stringify({ segments: paragraphs.map((text, index) => ({ index, part: 0, text })) }),
    }),
  );
  expect(response.status).toBe(200);
  return (await response.text())
    .trim()
    .split('\n\n')
    .map((event) => JSON.parse(event.slice('data: '.length)));
}

describe('TTS stream', () => {
  beforeEach(() => {
    vi.stubEnv('APP_ORIGIN', 'http://localhost');
    vi.mocked(createTtsSpeech).mockReset();
    vi.mocked(createTtsSpeech).mockImplementation(async (text) => {
      if (!/[\p{L}\p{N}]/u.test(text)) throw new Error('Provider cannot narrate punctuation');
      return { bytes: new Uint8Array([1, 2, 3]), contentType: 'audio/mpeg' };
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('continues narration across separators without sending them to the provider', async () => {
    const events = await narrate(['…', 'Before.', '...', '***', '之后。', '……']);
    expect(vi.mocked(createTtsSpeech).mock.calls.map(([text]) => text)).toEqual(['Before.', '之后。']);
    expect(events).toEqual([
      { type: 'audio.segment', index: 1, part: 0, audio: 'AQID' },
      { type: 'audio.segment', index: 4, part: 0, audio: 'AQID' },
      { type: 'audio.done' },
    ]);
  });

  it('completes a stream containing only punctuation without requesting audio', async () => {
    expect(await narrate(['…', '...', '——'])).toEqual([{ type: 'audio.done' }]);
    expect(createTtsSpeech).not.toHaveBeenCalled();
  });

  it('still reports provider failures for spoken text', async () => {
    vi.mocked(createTtsSpeech).mockRejectedValue(new Error('Speech provider unavailable'));
    expect(await narrate(['Hello.'])).toEqual([{ type: 'audio.error', message: 'Speech provider unavailable' }]);
  });
});
