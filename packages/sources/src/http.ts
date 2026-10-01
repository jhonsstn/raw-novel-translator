import { lookup, type LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import iconv = require('iconv-lite');
import { Agent, fetch, type Response } from 'undici';
import { SourceError } from './types.js';

const USER_AGENT = 'NovelLibrary/1.0';
const robotsCache = new Map<string, { expiresAt: number; disallow: string[]; crawlDelayMs: number }>();

export function isPublicAddress(input: string): boolean {
  const address = input.toLowerCase().replace(/^::ffff:/, '');
  const family = isIP(address);
  if (family === 4) {
    const parts = address.split('.').map(Number);
    const first = parts[0] ?? -1;
    const second = parts[1] ?? -1;
    return !(
      first === 0 ||
      first === 10 ||
      first === 127 ||
      first >= 224 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 100 && second >= 64 && second <= 127)
    );
  }
  if (family === 6)
    return !(
      address === '::' ||
      address === '::1' ||
      address.startsWith('fc') ||
      address.startsWith('fd') ||
      /^fe[89ab]/.test(address)
    );
  return false;
}

const guardedAgent = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
        if (error) {
          callback(error, '');
          return;
        }
        const address = addresses.find((candidate) => isPublicAddress(candidate.address));
        if (!address || addresses.some((candidate) => !isPublicAddress(candidate.address))) {
          const blocked = new Error(`Host ${hostname} resolves to a non-public address`);
          Object.assign(blocked, { code: 'ENETUNREACH' });
          callback(blocked, '');
          return;
        }
        if (options.all) callback(null, addresses);
        else callback(null, address.address, address.family);
      });
    },
  },
});

async function bodyBytes(stream: ReadableStream<Uint8Array>, limit: number): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new SourceError('SOURCE_TOO_LARGE', 'Source response exceeded its size limit');
    }
    chunks.push(result.value);
  }
  return Buffer.concat(chunks, total);
}

export function decodeSourceBytes(buffer: Buffer, contentType: string | null): string {
  const prefix = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('ascii');
  const declared =
    contentType?.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] ??
    prefix.match(/charset\s*=\s*["']?([^;"'\s/>]+)/i)?.[1] ??
    'utf-8';
  const charset = declared.toLowerCase();
  let decoded: string;
  if (charset === 'gb2312' || charset === 'gbk' || charset === 'gb18030') decoded = iconv.decode(buffer, 'gb18030');
  else if (charset === 'utf-8' || charset === 'utf8') decoded = iconv.decode(buffer, 'utf8');
  else throw new SourceError('UNSUPPORTED_ENCODING', `Unsupported source encoding: ${charset}`);
  if (decoded.includes('\ufffd'))
    throw new SourceError('SOURCE_ENCODING', 'Source response contains invalid encoded text');
  return decoded;
}

function parseRobots(text: string): { disallow: string[]; crawlDelayMs: number } {
  const disallow: string[] = [];
  let applies = false;
  let crawlDelayMs = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === 'user-agent') applies = value === '*' || value.toLowerCase() === USER_AGENT.toLowerCase();
    else if (applies && field === 'disallow' && value) disallow.push(value);
    else if (applies && field === 'crawl-delay')
      crawlDelayMs = Math.max(crawlDelayMs, Math.ceil(Number(value) * 1000) || 0);
  }
  return { disallow, crawlDelayMs };
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener(
    'abort',
    () => {
      clearTimeout(timer);
      reject(signal.reason);
    },
    { once: true },
  );
  return promise;
}

async function assertPublicHost(hostname: string, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw signal.reason;
  let addresses: LookupAddress[];
  try {
    addresses = await new Promise<LookupAddress[]>((resolve, reject) => {
      lookup(hostname, { all: true, verbatim: true }, (error, values) => (error ? reject(error) : resolve(values)));
    });
  } catch (cause) {
    if (signal.aborted) throw signal.reason;
    throw new SourceError('SOURCE_NETWORK', `Resolving source host ${hostname} failed: ${String(cause)}`);
  }
  if (signal.aborted) throw signal.reason;
  if (addresses.length === 0 || addresses.some((address) => !isPublicAddress(address.address)))
    throw new SourceError('SOURCE_NETWORK', 'Source host resolves to a non-public address');
}

async function rawFetch(
  url: URL,
  limit: number,
  signal: AbortSignal,
  allowedHosts: ReadonlySet<string>,
): Promise<{ bytes: Buffer; contentType: string | null; status: number; retryAfter: string | null }> {
  let current = url;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    let response: Response;
    try {
      response = await fetch(current, {
        dispatcher: guardedAgent,
        redirect: 'manual',
        signal,
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
      });
    } catch (cause) {
      throw new Error(`GET ${current.origin}${current.pathname} failed`, { cause });
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || redirects === 3)
        throw new SourceError('SOURCE_REDIRECT', 'Source redirect was invalid or exceeded the limit');
      const next = new URL(location, current);
      if (next.protocol !== 'https:' || !allowedHosts.has(next.hostname) || next.port || next.username || next.password)
        throw new SourceError('SOURCE_REDIRECT', 'Source redirected outside its approved host');
      current = next;
      continue;
    }
    if (!response.body) throw new SourceError('SOURCE_NETWORK', 'Source response has no body');
    const stream = response.body as unknown as ReadableStream<Uint8Array>;
    let bytes: Buffer;
    try {
      bytes = await bodyBytes(stream, limit);
    } catch (cause) {
      if (cause instanceof SourceError) throw cause;
      throw new Error(`Reading GET ${current.origin}${current.pathname} response failed (HTTP ${response.status})`, {
        cause,
      });
    }
    return {
      bytes,
      contentType: response.headers.get('content-type'),
      status: response.status,
      retryAfter: response.headers.get('retry-after'),
    };
  }
  throw new SourceError('SOURCE_REDIRECT', 'Source redirect exceeded the limit');
}

async function flaresolverrFetch(
  url: URL,
  limit: number,
  signal: AbortSignal,
  allowedHosts: ReadonlySet<string>,
  endpoint: string,
): Promise<{ html: string; status: number; retryAfter: null }> {
  await assertPublicHost(url.hostname, signal);
  let response: Response;
  try {
    response = await fetch(new URL('/v1', endpoint), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cmd: 'request.get', url: url.href, maxTimeout: 60_000 }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(75_000)]),
    });
  } catch (cause) {
    if (signal.aborted) throw signal.reason;
    throw new SourceError('SOURCE_NETWORK', `FlareSolverr request failed: ${String(cause)}`);
  }
  if (!response.body) throw new SourceError('SOURCE_NETWORK', 'FlareSolverr response has no body');
  let bytes: Buffer;
  try {
    bytes = await bodyBytes(response.body as unknown as ReadableStream<Uint8Array>, limit * 6 + 256 * 1024);
  } catch (cause) {
    if (signal.aborted) throw signal.reason;
    if (cause instanceof SourceError) throw cause;
    throw new SourceError('SOURCE_NETWORK', `Reading FlareSolverr response failed: ${String(cause)}`);
  }
  if (!response.ok) throw new SourceError('SOURCE_NETWORK', `FlareSolverr failed (HTTP ${response.status})`);
  let result: unknown;
  try {
    result = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new SourceError('SOURCE_NETWORK', 'FlareSolverr returned invalid JSON');
  }
  if (!result || typeof result !== 'object' || !('status' in result) || typeof result.status !== 'string')
    throw new SourceError('SOURCE_NETWORK', 'FlareSolverr returned an invalid result');
  if (result.status !== 'ok')
    throw new SourceError('SOURCE_BLOCKED', 'FlareSolverr did not solve the source challenge');
  if (!('solution' in result) || !result.solution || typeof result.solution !== 'object')
    throw new SourceError('SOURCE_NETWORK', 'FlareSolverr returned no solution');
  const solution = result.solution;
  if (
    !('status' in solution) ||
    typeof solution.status !== 'number' ||
    !('url' in solution) ||
    typeof solution.url !== 'string' ||
    !('response' in solution) ||
    typeof solution.response !== 'string' ||
    !solution.response
  )
    throw new SourceError('SOURCE_NETWORK', 'FlareSolverr returned an invalid solution');
  let finalUrl: URL;
  try {
    finalUrl = new URL(solution.url);
  } catch {
    throw new SourceError('SOURCE_REDIRECT', 'FlareSolverr returned an invalid source URL');
  }
  if (
    finalUrl.protocol !== 'https:' ||
    !allowedHosts.has(finalUrl.hostname) ||
    finalUrl.port ||
    finalUrl.username ||
    finalUrl.password
  )
    throw new SourceError('SOURCE_REDIRECT', 'FlareSolverr redirected outside the approved host');
  const html = Buffer.from(solution.response, 'utf8');
  if (html.byteLength > limit) throw new SourceError('SOURCE_TOO_LARGE', 'Source response exceeded its size limit');
  if (/cf-chl-|captcha|attention required/i.test(solution.response) && html.byteLength < 100_000)
    throw new SourceError('SOURCE_BLOCKED', 'Source returned a challenge page');
  return { html: solution.response, status: solution.status, retryAfter: null };
}

async function robots(
  origin: string,
  signal: AbortSignal,
  allowedHosts: ReadonlySet<string>,
): Promise<{ disallow: string[]; crawlDelayMs: number }> {
  const cached = robotsCache.get(origin);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const response = await rawFetch(new URL('/robots.txt', origin), 256 * 1024, signal, allowedHosts);
  if (response.status === 404) return { disallow: [], crawlDelayMs: 0 };
  if (response.status >= 400)
    throw new SourceError('ROBOTS_UNAVAILABLE', `Could not read robots policy (${response.status})`);
  const parsed = parseRobots(decodeSourceBytes(response.bytes, response.contentType));
  robotsCache.set(origin, { ...parsed, expiresAt: Date.now() + 3_600_000 });
  return parsed;
}

export interface SourceTransportOptions {
  signal: AbortSignal;
  allowedHosts?: readonly string[];
  beforeRequest?: (minimumDelayMs: number) => Promise<void>;
  flaresolverrUrl?: string;
}

export function createSourceTransport(options: SourceTransportOptions): (url: string) => Promise<string> {
  const allowedHosts = new Set(options.allowedHosts ?? ['www.piaotia.com']);
  return async (input) => {
    const url = new URL(input);
    if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname) || url.port || url.username || url.password)
      throw new SourceError('UNSUPPORTED_URL', 'Source transport rejected the URL');
    const policy = await robots(url.origin, options.signal, allowedHosts);
    if (policy.disallow.some((path) => url.pathname.startsWith(path)))
      throw new SourceError('ROBOTS_DISALLOWED', 'Source path is disallowed by robots policy');
    await options.beforeRequest?.(Math.max(2000, policy.crawlDelayMs));
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const limit = /index|list|目录/i.test(url.pathname) ? 8 * 1024 * 1024 : 2 * 1024 * 1024;
        const response = options.flaresolverrUrl
          ? await flaresolverrFetch(url, limit, options.signal, allowedHosts, options.flaresolverrUrl)
          : await rawFetch(url, limit, options.signal, allowedHosts);
        if (response.status === 401 || response.status === 403)
          throw new SourceError('SOURCE_BLOCKED', `Source denied access (${response.status})`);
        if (response.status === 404) throw new SourceError('SOURCE_NOT_FOUND', 'Source page was not found');
        if (response.status === 429 || response.status >= 500) {
          if (attempt === 2)
            throw new SourceError('SOURCE_NETWORK', `Source failed after retries (${response.status})`);
          const retrySeconds = Number(response.retryAfter ?? 0);
          await delay(Math.max(attempt === 0 ? 10_000 : 30_000, retrySeconds * 1000), options.signal);
          continue;
        }
        if (response.status >= 400)
          throw new SourceError('SOURCE_NETWORK', `Source request failed (${response.status})`);
        return 'html' in response ? response.html : decodeSourceBytes(response.bytes, response.contentType);
      } catch (error) {
        if (error instanceof SourceError || options.signal.aborted || attempt === 2) throw error;
        await delay(attempt === 0 ? 10_000 : 30_000, options.signal);
      }
    }
    throw new SourceError('SOURCE_NETWORK', 'Source request failed');
  };
}
