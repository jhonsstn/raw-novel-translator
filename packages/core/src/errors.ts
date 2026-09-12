export class AppError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
    this.name = 'AppError';
  }
}

export function sanitizedError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unexpected error';
  return message.replace(/(authorization|api[-_ ]?key|bearer)\s*[:=]?\s*\S+/gi, '$1 [redacted]').slice(0, 1000);
}
