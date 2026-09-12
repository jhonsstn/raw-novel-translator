import { getStoredProviderApiKey } from './settings.js';

export class AppError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
    this.name = 'AppError';
  }
}

export function sanitizedError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unexpected error';
  return sanitizedDiagnosticText(message, 1000);
}

/** Only pass deliberately selected context, never request headers, bodies or job payloads. */
export function sanitizedDiagnosticText(value: string, limit = 16_000): string {
  return diagnosticRedactor()(value, limit);
}

function diagnosticRedactor(): (value: string, limit: number) => string {
  const secrets: Array<string | null | undefined> = [process.env.APP_SECRET_KEY];
  try { secrets.push(getStoredProviderApiKey()); } catch { /* Settings or encryption may not be initialized. */ }
  const variants = new Set<string>();
  for (const secret of secrets) {
    if (!secret) continue;
    variants.add(secret);
    variants.add(encodeURIComponent(secret));
  }
  return (value, limit) => {
    let text = value;
    for (const secret of variants) text = text.replaceAll(secret, '[redacted]');
    text = text
      .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/gi, (url) => url
        .replace(/(\/\/)[^/?#]*@/, '$1[redacted]@')
        .replace(/[?#].*$/, '?[redacted]'))
      .replace(/((?:proxy[-_ ]?)?authorization|api[-_ ]?key|bearer)\b["']?\s*[:=]?\s*(?:(?:bearer|basic)\s+)?(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1 [redacted]');
    return text.length > limit ? `${text.slice(0, Math.max(0, limit - 14))}\n[truncated]`.slice(0, limit) : text;
  };
}

/** Walk a small allowlist instead of serializing arbitrary error/request objects. */
export function errorDiagnostics(error: unknown): string {
  const redact = diagnosticRedactor();
  const lines: string[] = [];
  const seen = new Set<object>();
  let remaining = 16_000;
  let nodes = 0;
  const append = (value: string) => {
    if (remaining <= 0) return;
    const text = redact(value, Math.min(remaining, 4000));
    lines.push(text);
    remaining -= text.length + 1;
  };
  const field = (value: object, key: string): unknown => {
    try { return Reflect.get(value, key); } catch { return undefined; }
  };
  const visit = (value: unknown, label: string, depth: number): void => {
    if (remaining <= 0) return;
    if (depth > 6 || nodes >= 20) { append(`${label}: [diagnostic limit reached]`); return; }
    if (!value || typeof value !== 'object') { append(`${label}: Non-Error value omitted`); return; }
    if (seen.has(value)) { append(`${label}: [circular reference]`); return; }
    seen.add(value);
    nodes += 1;
    const name = field(value, 'name');
    const message = field(value, 'message');
    append(`${label}: ${typeof name === 'string' ? name : 'Error'}${typeof message === 'string' ? `: ${message}` : ''}`);
    for (const key of ['code', 'errno', 'syscall', 'hostname', 'host', 'address', 'port']) {
      const detail = field(value, key);
      if (typeof detail === 'string' || typeof detail === 'number') append(`${key}: ${detail}`);
    }
    // Visit causes before stacks so a verbose outer stack cannot hide the root cause.
    const cause = field(value, 'cause');
    if (cause !== undefined) visit(cause, 'Caused by', depth + 1);
    const errors = value instanceof AggregateError ? field(value, 'errors') : undefined;
    if (Array.isArray(errors)) {
      for (let index = 0; index < Math.min(errors.length, 10) && remaining > 0; index += 1) visit(errors[index], `Aggregate error ${index + 1}`, depth + 1);
      if (errors.length > 10) append('[additional aggregate errors omitted]');
    }
    const stack = field(value, 'stack');
    if (typeof stack === 'string') append(stack);
  };
  visit(error, 'Error', 0);
  return lines.join('\n').slice(0, 16_000);
}
