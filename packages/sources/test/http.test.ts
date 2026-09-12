import { afterEach, expect, it, vi } from 'vitest';
import { fetch } from 'undici';
import type * as Undici from 'undici';
import { createSourceTransport } from '../src/http.js';

vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof Undici>();
  return { ...actual, fetch: vi.fn() };
});

afterEach(() => vi.resetAllMocks());

it('identifies a failed robots request and preserves its underlying network cause', async () => {
  const cause = Object.assign(new Error('getaddrinfo ENOTFOUND www.piaotia.com'), { code: 'ENOTFOUND' });
  const failure = new TypeError('fetch failed', { cause });
  vi.mocked(fetch).mockRejectedValueOnce(failure);
  const transport = createSourceTransport({ signal: new AbortController().signal });
  await expect(transport('https://www.piaotia.com/html/1/2/3.html?token=private')).rejects.toMatchObject({
    message: 'GET https://www.piaotia.com/robots.txt failed',
    cause: failure,
  });
});
