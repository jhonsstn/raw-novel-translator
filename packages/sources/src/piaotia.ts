import * as cheerio from 'cheerio';
import type { ChapterRef, NovelRef, SourceAdapter } from './types.js';
import { SourceError } from './types.js';

const origin = 'https://www.piaotia.com';
const chapterPath = /^\/html\/(\d+)\/(\d+)\/(\d+)\.html$/;

function normalizeText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function chapterMatch(url: URL): RegExpMatchArray | null {
  if (url.origin !== origin || url.username || url.password || url.search) return null;
  return url.pathname.match(chapterPath);
}

function canonicalChapterUrl(input: URL): URL {
  if (!chapterMatch(input)) throw new SourceError('UNSUPPORTED_URL', 'This is not a Piaotia chapter URL');
  const canonical = new URL(input.href);
  canonical.hash = '';
  return canonical;
}

function directoryUrl(match: RegExpMatchArray): string {
  return `${origin}/html/${match[1]}/${match[2]}/index.html`;
}

function indexed(node: unknown, label: string): { startIndex: number; endIndex: number } {
  if (
    !node ||
    typeof node !== 'object' ||
    !('startIndex' in node) ||
    !('endIndex' in node) ||
    typeof node.startIndex !== 'number' ||
    typeof node.endIndex !== 'number'
  )
    throw new SourceError('SOURCE_LAYOUT_CHANGED', `${label} source position is missing`);
  return { startIndex: node.startIndex, endIndex: node.endIndex };
}

function load(html: string): cheerio.CheerioAPI {
  return cheerio.load(html, { xml: { xmlMode: false, withStartIndices: true, withEndIndices: true } });
}

export function parseDirectory(html: string, indexUrl: string): ChapterRef[] {
  const $ = load(html);
  const base = new URL(indexUrl);
  const seen = new Set<string>();
  const chapters: ChapterRef[] = [];
  $('.centent ul li a').each((_index, element) => {
    const href = $(element).attr('href');
    const title = normalizeText($(element).text());
    if (!href || !title) return;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      return;
    }
    const match = chapterMatch(url);
    if (!match || directoryUrl(match) !== base.href) return;
    url.hash = '';
    if (seen.has(url.href)) return;
    seen.add(url.href);
    chapters.push({ sourceChapterId: match[3]!, url: url.href, title, ordinal: chapters.length });
  });
  if (chapters.length === 0)
    throw new SourceError('SOURCE_LAYOUT_CHANGED', 'No chapter links matched the Piaotia directory layout');
  return chapters;
}

export function parseChapter(html: string): { title: string; paragraphs: string[] } {
  if (/cf-chl-|captcha|attention required/i.test(html) && html.length < 100_000)
    throw new SourceError('SOURCE_BLOCKED', 'Source returned a challenge page');
  const $ = load(html);
  const heading = $('h1').first();
  heading.find('a').remove();
  const title = normalizeText(heading.text());
  if (!title) throw new SourceError('SOURCE_LAYOUT_CHANGED', 'Piaotia chapter title was not found');

  const start = $('.toplink ~ table').first();
  const end = $('.bottomlink').first();
  if (!start.length || !end.length)
    throw new SourceError('SOURCE_LAYOUT_CHANGED', 'Piaotia chapter content boundaries were not found');
  const startNode = indexed(start.get(0), 'Content start');
  const endNode = indexed(end.get(0), 'Content end');
  if (endNode.startIndex <= startNode.endIndex)
    throw new SourceError('SOURCE_LAYOUT_CHANGED', 'Piaotia chapter content boundaries are invalid');

  let fragmentEnd = endNode.startIndex;
  const markerIndex = html.indexOf('翻页上AD开始', startNode.endIndex + 1);
  if (markerIndex >= 0 && markerIndex < endNode.startIndex) {
    const commentStart = html.lastIndexOf('<!--', markerIndex);
    fragmentEnd = commentStart > startNode.endIndex ? commentStart : markerIndex;
  }
  const fragment = html.slice(startNode.endIndex + 1, fragmentEnd);
  const body = cheerio.load(`<main>${fragment.replace(/<br\s*\/?>/gi, '\n')}</main>`, null, false);
  body('script,style,table,iframe,a').remove();
  const taggedParagraphs = body('main p')
    .map((_index, element) => normalizeText(body(element).text()))
    .get()
    .filter(Boolean);
  const paragraphs =
    taggedParagraphs.length > 0
      ? taggedParagraphs
      : body('main')
          .text()
          .split(/\r?\n+/)
          .map(normalizeText)
          .filter(Boolean);
  if (paragraphs.length === 0) throw new SourceError('SOURCE_LAYOUT_CHANGED', 'Piaotia chapter body is empty');
  return { title, paragraphs };
}

export const piaotia: SourceAdapter = {
  id: 'piaotia',
  name: 'Piaotia',
  siteUrl: origin,
  version: 'piaotia-1',
  hosts: ['www.piaotia.com'],
  matches(url) {
    return chapterMatch(url) !== null;
  },
  resolveNovel(url): NovelRef {
    const canonical = canonicalChapterUrl(url);
    const match = chapterMatch(canonical)!;
    return { sourceNovelId: `${match[1]}/${match[2]}`, indexUrl: directoryUrl(match) };
  },
  async listChapters(novel, context) {
    return parseDirectory(await context.fetchHtml(novel.indexUrl), novel.indexUrl);
  },
  async fetchChapter(chapter, context) {
    return parseChapter(await context.fetchHtml(chapter.url));
  },
};
