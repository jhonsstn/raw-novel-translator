import { afterEach, expect, it, vi } from 'vitest';
import { fetch, Response } from 'undici';
import type * as Undici from 'undici';
import { createSourceTransport } from '../src/http.js';

const dnsState = vi.hoisted(() => ({ addresses: [{ address: '93.184.215.14', family: 4 }] }));

vi.mock('node:dns', () => ({
  lookup: (_host: string, _options: unknown, callback: (error: null, addresses: unknown[]) => void) =>
    callback(null, dnsState.addresses),
}));

vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof Undici>();
  return { ...actual, fetch: vi.fn() };
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
  dnsState.addresses = [{ address: '93.184.215.14', family: 4 }];
});

let sourceNumber = 0;
function source() {
  const host = `source-${++sourceNumber}.example`;
  const url = `https://${host}/html/1/2/3.html`;
  return { host, url };
}

function solverResult(url: string, status = 200, html = '<html>Chapter</html>') {
  return { status: 'ok', solution: { status, url, response: html } };
}

function transport(
  host: string,
  signal = new AbortController().signal,
  beforeRequest?: (minimum: number) => Promise<void>,
) {
  return createSourceTransport({
    signal,
    allowedHosts: [host],
    flaresolverrUrl: 'http://flaresolverr:8191',
    ...(beforeRequest ? { beforeRequest } : {}),
  });
}

it('identifies a failed page request and preserves its underlying network cause', async () => {
  vi.useFakeTimers();
  const cause = Object.assign(new Error('getaddrinfo ENOTFOUND www.piaotia.com'), { code: 'ENOTFOUND' });
  const failure = new TypeError('fetch failed', { cause });
  vi.mocked(fetch).mockRejectedValue(failure);
  const transport = createSourceTransport({ signal: new AbortController().signal });
  const assertion = expect(transport('https://www.piaotia.com/html/1/2/3.html?token=private')).rejects.toMatchObject({
    message: 'GET https://www.piaotia.com/html/1/2/3.html failed',
    cause: failure,
  });
  await vi.runAllTimersAsync();
  await assertion;
});

it('sends pages through FlareSolverr after request spacing without fetching robots.txt', async () => {
  const { host, url } = source();
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(solverResult(url))));
  const beforeRequest = vi.fn(async (minimum: number) => {
    expect(minimum).toBe(2000);
    expect(fetch).not.toHaveBeenCalled();
  });

  await expect(transport(host, undefined, beforeRequest)(url)).resolves.toBe('<html>Chapter</html>');
  expect(beforeRequest).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledOnce();
  expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe('http://flaresolverr:8191/v1');
  const init = vi.mocked(fetch).mock.calls[0]![1]!;
  expect(init.method).toBe('POST');
  expect(JSON.parse(String(init.body))).toMatchObject({ cmd: 'request.get', url });
});

it('rejects FlareSolverr redirects outside the approved host', async () => {
  const { host, url } = source();
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(solverResult('http://127.0.0.1/private'))));
  await expect(transport(host)(url)).rejects.toMatchObject({ code: 'SOURCE_REDIRECT' });
});

it.each([
  [403, 'SOURCE_BLOCKED'],
  [404, 'SOURCE_NOT_FOUND'],
])('maps source HTTP %i from FlareSolverr to %s', async (status, code) => {
  const { host, url } = source();
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(solverResult(url, status))));
  await expect(transport(host)(url)).rejects.toMatchObject({ code });
});

it('rejects challenge HTML even when FlareSolverr reports HTTP 200', async () => {
  const { host, url } = source();
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify(solverResult(url, 200, '<html>Attention Required cf-chl-</html>'))),
  );
  await expect(transport(host)(url)).rejects.toMatchObject({ code: 'SOURCE_BLOCKED' });
});

it('accepts browser-decoded HTML with replacement characters in site markup', async () => {
  const { host, url } = source();
  const html = '<html><div class="\ufffd">Chapter</div></html>';
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(solverResult(url, 200, html))));
  await expect(transport(host)(url)).resolves.toBe(html);
});

it.each(['{invalid', JSON.stringify({ status: 'ok' }), JSON.stringify({ unexpected: true })])(
  'rejects malformed FlareSolverr responses',
  async (body) => {
    const { host, url } = source();
    vi.mocked(fetch).mockResolvedValueOnce(new Response(body));
    await expect(transport(host)(url)).rejects.toMatchObject({ code: 'SOURCE_NETWORK' });
  },
);

it('rejects source HTML over the existing chapter size limit', async () => {
  const { host, url } = source();
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify(solverResult(url, 200, 'x'.repeat(2 * 1024 * 1024 + 1)))),
  );
  await expect(transport(host)(url)).rejects.toMatchObject({ code: 'SOURCE_TOO_LARGE' });
});

it('bounds the FlareSolverr JSON body before parsing it', async () => {
  const { host, url } = source();
  vi.mocked(fetch).mockResolvedValueOnce(new Response('x'.repeat(2 * 1024 * 1024 * 6 + 256 * 1024 + 1)));
  await expect(transport(host)(url)).rejects.toMatchObject({ code: 'SOURCE_TOO_LARGE' });
});

it('rejects private source DNS answers before contacting FlareSolverr', async () => {
  const { host, url } = source();
  dnsState.addresses = [{ address: '127.0.0.1', family: 4 }];
  await expect(transport(host)(url)).rejects.toMatchObject({ code: 'SOURCE_NETWORK' });
  expect(fetch).not.toHaveBeenCalled();
});

it('reports a failed FlareSolverr connection without falling back to direct page fetch', async () => {
  const { host, url } = source();
  vi.mocked(fetch).mockRejectedValueOnce(new Error('connection refused'));
  await expect(transport(host)(url)).rejects.toMatchObject({ code: 'SOURCE_NETWORK' });
  expect(fetch).toHaveBeenCalledOnce();
});

it('propagates cancellation during a FlareSolverr request', async () => {
  const { host, url } = source();
  const controller = new AbortController();
  const reason = new Error('cancelled');
  vi.mocked(fetch).mockImplementationOnce(async () => {
    controller.abort(reason);
    throw reason;
  });
  await expect(transport(host, controller.signal)(url)).rejects.toBe(reason);
});

it('uses the direct source transport when FlareSolverr is not configured', async () => {
  const { host, url } = source();
  vi.mocked(fetch).mockResolvedValueOnce(new Response('<html>Direct</html>'));
  const fetchHtml = createSourceTransport({ signal: new AbortController().signal, allowedHosts: [host] });
  await expect(fetchHtml(url)).resolves.toBe('<html>Direct</html>');
  expect(fetch).toHaveBeenCalledOnce();
  expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe(url);
});
