import { createConfigurableSource } from './configurable.js';
import type { ConfigurableSourceDefinition, SourceAdapter } from './types.js';
import { SourceError } from './types.js';

export function listSourceAdapters(definitions: readonly ConfigurableSourceDefinition[]): readonly SourceAdapter[] {
  return definitions.map(createConfigurableSource);
}

export function sourceForUrl(url: URL, definitions: readonly ConfigurableSourceDefinition[]): SourceAdapter {
  const adapter = listSourceAdapters(definitions).find((candidate) => candidate.matches(url));
  if (!adapter) throw new SourceError('UNSUPPORTED_URL', 'No enabled source supports this URL');
  return adapter;
}

export function sourceById(id: string, definitions: readonly ConfigurableSourceDefinition[]): SourceAdapter {
  const definition = definitions.find((candidate) => candidate.id === id);
  if (!definition) throw new SourceError('UNKNOWN_SOURCE', `Unknown source: ${id}`);
  return createConfigurableSource(definition);
}
