import { getDatabase } from '@novel/db';
import { createConfigurableSource, sourceById, sourceForUrl, type ConfigurableSourceDefinition, type SourceAdapter } from '@novel/sources';
import { AppError } from './errors.js';

interface SourceDefinitionRow {
  source_id: string; name: string; site_url: string; chapter_path_pattern: string; index_path_template: string;
  novel_id_template: string | null; chapter_id_template: string | null; chapter_link_selector: string; chapter_title_selector: string;
  chapter_title_exclude_selector: string | null; chapter_content_selector: string; chapter_content_start_selector: string | null;
  chapter_content_end_selector: string | null; chapter_content_end_text: string | null; chapter_content_exclude_selector: string | null;
}

export interface SourceDefinitionInput {
  name: string; siteUrl: string; chapterPathPattern: string; indexPathTemplate: string; novelIdTemplate?: string | null | undefined;
  chapterIdTemplate?: string | null | undefined; chapterLinkSelector: string; chapterTitleSelector: string; chapterTitleExcludeSelector?: string | null | undefined;
  chapterContentSelector?: string | null | undefined; chapterContentStartSelector?: string | null | undefined; chapterContentEndSelector?: string | null | undefined;
  chapterContentEndText?: string | null | undefined; chapterContentExcludeSelector?: string | null | undefined;
}

function optional(value: string | null | undefined): string | null { return value?.trim() || null; }

function rowToDefinition(row: SourceDefinitionRow): ConfigurableSourceDefinition {
  return {
    id: row.source_id, name: row.name, siteUrl: row.site_url, chapterPathPattern: row.chapter_path_pattern,
    indexPathTemplate: row.index_path_template, novelIdTemplate: row.novel_id_template, chapterIdTemplate: row.chapter_id_template,
    chapterLinkSelector: row.chapter_link_selector, chapterTitleSelector: row.chapter_title_selector,
    chapterTitleExcludeSelector: row.chapter_title_exclude_selector, chapterContentSelector: row.chapter_content_selector,
    chapterContentStartSelector: row.chapter_content_start_selector, chapterContentEndSelector: row.chapter_content_end_selector,
    chapterContentEndText: row.chapter_content_end_text, chapterContentExcludeSelector: row.chapter_content_exclude_selector,
  };
}

export function listSourceDefinitions(): ConfigurableSourceDefinition[] {
  const rows = getDatabase().sqlite.prepare('SELECT * FROM source_definitions ORDER BY name,source_id').all() as SourceDefinitionRow[];
  return rows.map(rowToDefinition);
}

export function getSourceDefinition(sourceId: string): ConfigurableSourceDefinition {
  const row = getDatabase().sqlite.prepare('SELECT * FROM source_definitions WHERE source_id=?').get(sourceId) as SourceDefinitionRow | undefined;
  if (!row) throw new AppError('SOURCE_NOT_FOUND', 'Source not found', 404);
  return rowToDefinition(row);
}

function normalize(input: SourceDefinitionInput): Omit<ConfigurableSourceDefinition, 'id'> {
  const name = input.name.trim();
  if (!name || name.length > 100) throw new AppError('INVALID_SOURCE_NAME', 'Source name must be 1–100 characters');
  let site: URL;
  try { site = new URL(input.siteUrl); } catch { throw new AppError('INVALID_SOURCE_URL', 'Enter a valid source site URL'); }
  if (site.protocol !== 'https:' || site.username || site.password || site.search || site.hash) throw new AppError('INVALID_SOURCE_URL', 'Source site URL must use HTTPS and cannot contain credentials, query, or fragment');
  site.pathname = site.pathname.replace(/\/$/, '') || '/';
  const chapterPathPattern = input.chapterPathPattern.trim();
  try { new RegExp(chapterPathPattern); } catch { throw new AppError('INVALID_SOURCE_PATTERN', 'Chapter URL pattern must be a valid regular expression'); }
  const indexPathTemplate = input.indexPathTemplate.trim();
  const chapterLinkSelector = input.chapterLinkSelector.trim();
  const chapterTitleSelector = input.chapterTitleSelector.trim();
  const chapterContentSelector = optional(input.chapterContentSelector) ?? 'body';
  if (!chapterPathPattern || !indexPathTemplate || !chapterLinkSelector || !chapterTitleSelector) throw new AppError('INVALID_SOURCE_CONFIG', 'URL pattern, index template, chapter-link selector, and title selector are required');
  const start = optional(input.chapterContentStartSelector); const end = optional(input.chapterContentEndSelector);
  if ((start === null) !== (end === null)) throw new AppError('INVALID_SOURCE_CONFIG', 'Content start and end selectors must be set together');
  const definition = {
    name, siteUrl: site.href.replace(/\/$/, ''), chapterPathPattern, indexPathTemplate,
    novelIdTemplate: optional(input.novelIdTemplate), chapterIdTemplate: optional(input.chapterIdTemplate), chapterLinkSelector,
    chapterTitleSelector, chapterTitleExcludeSelector: optional(input.chapterTitleExcludeSelector), chapterContentSelector,
    chapterContentStartSelector: start, chapterContentEndSelector: end, chapterContentEndText: optional(input.chapterContentEndText),
    chapterContentExcludeSelector: optional(input.chapterContentExcludeSelector) ?? 'script,style,iframe',
  };
  createConfigurableSource({ id: 'validation', ...definition });
  return definition;
}

function slug(name: string): string {
  const base = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  return base || 'source';
}

function nextId(name: string): string {
  const sqlite = getDatabase().sqlite; const base = slug(name); let candidate = base; let suffix = 2;
  while (sqlite.prepare('SELECT 1 FROM source_definitions WHERE source_id=?').get(candidate)) candidate = `${base}-${suffix++}`;
  return candidate;
}

export function createSourceDefinition(input: SourceDefinitionInput): ConfigurableSourceDefinition {
  const value = normalize(input); const id = nextId(value.name); const now = Date.now(); const sqlite = getDatabase().sqlite;
  sqlite.transaction(() => {
    sqlite.prepare(`INSERT INTO source_definitions(source_id,name,site_url,chapter_path_pattern,index_path_template,novel_id_template,chapter_id_template,chapter_link_selector,chapter_title_selector,chapter_title_exclude_selector,chapter_content_selector,chapter_content_start_selector,chapter_content_end_selector,chapter_content_end_text,chapter_content_exclude_selector,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id,value.name,value.siteUrl,value.chapterPathPattern,value.indexPathTemplate,value.novelIdTemplate,value.chapterIdTemplate,value.chapterLinkSelector,value.chapterTitleSelector,value.chapterTitleExcludeSelector,value.chapterContentSelector,value.chapterContentStartSelector,value.chapterContentEndSelector,value.chapterContentEndText,value.chapterContentExcludeSelector,now,now);
    sqlite.prepare('INSERT INTO source_settings(source_id) VALUES (?)').run(id);
  })();
  return getSourceDefinition(id);
}

export function updateSourceDefinition(sourceId: string, input: SourceDefinitionInput): ConfigurableSourceDefinition {
  getSourceDefinition(sourceId); const value = normalize(input);
  getDatabase().sqlite.prepare(`UPDATE source_definitions SET name=?,site_url=?,chapter_path_pattern=?,index_path_template=?,novel_id_template=?,chapter_id_template=?,chapter_link_selector=?,chapter_title_selector=?,chapter_title_exclude_selector=?,chapter_content_selector=?,chapter_content_start_selector=?,chapter_content_end_selector=?,chapter_content_end_text=?,chapter_content_exclude_selector=?,updated_at=? WHERE source_id=?`)
    .run(value.name,value.siteUrl,value.chapterPathPattern,value.indexPathTemplate,value.novelIdTemplate,value.chapterIdTemplate,value.chapterLinkSelector,value.chapterTitleSelector,value.chapterTitleExcludeSelector,value.chapterContentSelector,value.chapterContentStartSelector,value.chapterContentEndSelector,value.chapterContentEndText,value.chapterContentExcludeSelector,Date.now(),sourceId);
  return getSourceDefinition(sourceId);
}

export function deleteSourceDefinition(sourceId: string): void {
  getSourceDefinition(sourceId); const sqlite = getDatabase().sqlite;
  if (sqlite.prepare('SELECT 1 FROM novels WHERE source_id=? LIMIT 1').get(sourceId)) throw new AppError('SOURCE_IN_USE', 'Remove novels using this source before deleting it', 409);
  sqlite.transaction(() => { sqlite.prepare('DELETE FROM source_settings WHERE source_id=?').run(sourceId); sqlite.prepare('DELETE FROM source_definitions WHERE source_id=?').run(sourceId); })();
}

export function configuredSourceForUrl(url: URL): SourceAdapter { return sourceForUrl(url, listSourceDefinitions()); }
export function configuredSourceById(sourceId: string): SourceAdapter { return sourceById(sourceId, listSourceDefinitions()); }
