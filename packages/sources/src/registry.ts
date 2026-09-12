import { piaotia } from './piaotia.js';
import type { SourceAdapter } from './types.js';
import { SourceError } from './types.js';

const adapters: readonly SourceAdapter[] = [piaotia];

export function listSourceAdapters(): readonly SourceAdapter[] { return adapters; }

export function sourceForUrl(url: URL): SourceAdapter {
  const adapter = adapters.find((candidate) => candidate.matches(url));
  if (!adapter) throw new SourceError('UNSUPPORTED_URL', 'No enabled source supports this URL');
  return adapter;
}

export function sourceById(id: string): SourceAdapter {
  const adapter = adapters.find((candidate) => candidate.id === id);
  if (!adapter) throw new SourceError('UNKNOWN_SOURCE', `Unknown source: ${id}`);
  return adapter;
}
