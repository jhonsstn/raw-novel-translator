import * as cheerio from 'cheerio';
import type { ChapterRef, ConfigurableSourceDefinition, NovelRef, SourceAdapter } from './types.js';
import { SourceError } from './types.js';

function siteOrigin(definition: ConfigurableSourceDefinition): string {
  let url: URL;
  try { url = new URL(definition.siteUrl); } catch { throw new SourceError('INVALID_SOURCE_CONFIG', 'Source site URL is invalid'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new SourceError('INVALID_SOURCE_CONFIG', 'Source site URL must be an HTTPS URL without credentials, query, or fragment');
  return url.origin;
}

function pathExpression(definition: ConfigurableSourceDefinition): RegExp {
  try { return new RegExp(definition.chapterPathPattern); } catch { throw new SourceError('INVALID_SOURCE_CONFIG', 'Chapter path pattern is not a valid regular expression'); }
}

function matchChapter(definition: ConfigurableSourceDefinition, url: URL): RegExpMatchArray | null {
  if (url.origin !== siteOrigin(definition) || url.username || url.password) return null;
  return `${url.pathname}${url.search}`.match(pathExpression(definition));
}

function expandTemplate(template: string, match: RegExpMatchArray): string {
  return template.replace(/\{(\d+)\}/g, (_whole, index: string) => match[Number(index)] ?? '');
}

function canonicalChapterUrl(definition: ConfigurableSourceDefinition, input: URL): URL {
  if (!matchChapter(definition, input)) throw new SourceError('UNSUPPORTED_URL', `This is not a ${definition.name} chapter URL`);
  const clean = new URL(input.href);
  clean.hash = '';
  return clean;
}

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
}

function indexed(node: unknown, label: string): { startIndex: number; endIndex: number } {
  if (!node || typeof node !== 'object' || !('startIndex' in node) || !('endIndex' in node) || typeof node.startIndex !== 'number' || typeof node.endIndex !== 'number') {
    throw new SourceError('SOURCE_LAYOUT_CHANGED', `${label} source position is missing`);
  }
  return { startIndex: node.startIndex, endIndex: node.endIndex };
}

function load(html: string): cheerio.CheerioAPI {
  return cheerio.load(html, { xml: { xmlMode: false, withStartIndices: true, withEndIndices: true } });
}

export function parseConfigurableDirectory(definition: ConfigurableSourceDefinition, html: string, indexUrl: string): ChapterRef[] {
  const $ = load(html);
  const base = new URL(indexUrl);
  const seen = new Set<string>();
  const chapters: ChapterRef[] = [];
  $(definition.chapterLinkSelector).each((_index, element) => {
    const href = $(element).attr('href');
    const title = normalizeText($(element).text());
    if (!href || !title) return;
    let url: URL;
    try { url = new URL(href, base); } catch { return; }
    const match = matchChapter(definition, url);
    if (!match) return;
    url.hash = '';
    const canonical = url.href;
    if (seen.has(canonical)) return;
    seen.add(canonical);
    chapters.push({ sourceChapterId: canonical, url: canonical, title, ordinal: chapters.length });
  });
  if (chapters.length === 0) throw new SourceError('SOURCE_LAYOUT_CHANGED', `No chapter links matched ${definition.chapterLinkSelector}`);
  return chapters;
}

export function parseConfigurableChapter(definition: ConfigurableSourceDefinition, html: string): { title: string; paragraphs: string[] } {
  if (/cf-chl-|captcha|attention required/i.test(html) && html.length < 100_000) throw new SourceError('SOURCE_BLOCKED', 'Source returned a challenge page');
  const $ = load(html);
  const heading = $(definition.chapterTitleSelector).first();
  if (definition.chapterTitleExcludeSelector) heading.find(definition.chapterTitleExcludeSelector).remove();
  const title = normalizeText(heading.text());
  if (!title) throw new SourceError('SOURCE_LAYOUT_CHANGED', `Chapter title selector did not match: ${definition.chapterTitleSelector}`);

  let fragment: string;
  if (definition.chapterContentStartSelector || definition.chapterContentEndSelector) {
    if (!definition.chapterContentStartSelector || !definition.chapterContentEndSelector) throw new SourceError('INVALID_SOURCE_CONFIG', 'Content start and end selectors must be configured together');
    const start = $(definition.chapterContentStartSelector).first();
    const end = $(definition.chapterContentEndSelector).first();
    if (!start.length || !end.length) throw new SourceError('SOURCE_LAYOUT_CHANGED', 'Configured chapter content boundaries were not found');
    const startNode = indexed(start.get(0), 'Content start');
    const endNode = indexed(end.get(0), 'Content end');
    if (endNode.startIndex <= startNode.endIndex) throw new SourceError('SOURCE_LAYOUT_CHANGED', 'Configured chapter content boundaries are invalid');
    fragment = html.slice(startNode.endIndex + 1, endNode.startIndex);
  } else {
    const content = $(definition.chapterContentSelector).first();
    if (!content.length) throw new SourceError('SOURCE_LAYOUT_CHANGED', `Chapter content selector did not match: ${definition.chapterContentSelector}`);
    fragment = content.html() ?? '';
  }

  const body = cheerio.load(`<main>${fragment.replace(/<br\s*\/?>/gi, '\n')}</main>`, null, false);
  const exclusions = definition.chapterContentExcludeSelector?.trim();
  if (exclusions) body(exclusions).remove();
  const paragraphs = body('main').text().split(/\r?\n+/).map(normalizeText).filter(Boolean);
  if (paragraphs.length === 0) throw new SourceError('SOURCE_LAYOUT_CHANGED', 'Chapter body is empty');
  return { title, paragraphs };
}

export function createConfigurableSource(definition: ConfigurableSourceDefinition): SourceAdapter {
  const origin = siteOrigin(definition);
  return {
    id: definition.id,
    name: definition.name,
    version: 'configurable-1',
    hosts: [new URL(origin).hostname],
    matches(url) { return matchChapter(definition, url) !== null; },
    resolveNovel(url): NovelRef {
      const canonical = canonicalChapterUrl(definition, url);
      const match = matchChapter(definition, canonical)!;
      const indexPath = expandTemplate(definition.indexPathTemplate, match);
      const indexUrl = new URL(indexPath, definition.siteUrl).href;
      return { sourceNovelId: indexUrl, indexUrl };
    },
    async listChapters(novel, ctx) { return parseConfigurableDirectory(definition, await ctx.fetchHtml(novel.indexUrl), novel.indexUrl); },
    async fetchChapter(chapter, ctx) { return parseConfigurableChapter(definition, await ctx.fetchHtml(chapter.url)); },
  };
}
