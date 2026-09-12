import * as cheerio from 'cheerio';
import type { ChapterRef, NovelRef, SourceAdapter, SourceContext } from './types.js';
import { SourceError } from './types.js';

const CHAPTER_PATH = /^\/html\/(\d+)\/(\d+)\/(\d+)\.html$/;
const INDEX_PATH = /^\/html\/(\d+)\/(\d+)\/index\.html$/;

function canonicalChapterUrl(input: URL): URL {
  if (input.protocol !== 'https:' || input.hostname !== 'www.piaotia.com' || input.port || input.username || input.password || input.search) {
    throw new SourceError('UNSUPPORTED_URL', 'Piaotia URLs must use canonical HTTPS chapter URLs');
  }
  if (!CHAPTER_PATH.test(input.pathname)) throw new SourceError('UNSUPPORTED_URL', 'This is not a Piaotia chapter URL');
  const clean = new URL(input.href);
  clean.hash = '';
  return clean;
}

function sourceIdentity(pathname: string): string {
  const match = pathname.match(CHAPTER_PATH) ?? pathname.match(INDEX_PATH);
  if (!match) throw new SourceError('UNSUPPORTED_URL', 'Invalid Piaotia novel path');
  return `${match[1]}/${match[2]}`;
}

function chapterId(url: URL): string {
  const match = url.pathname.match(CHAPTER_PATH);
  if (!match?.[3]) throw new SourceError('SOURCE_LAYOUT_CHANGED', 'Directory contained an invalid chapter URL');
  return match[3];
}

function load(html: string): cheerio.CheerioAPI {
  return cheerio.load(html, { xml: { xmlMode: false, withStartIndices: true, withEndIndices: true } });
}

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
}

export function parseDirectory(html: string, indexUrl: string): { novel: NovelRef; chapters: ChapterRef[] } {
  const $ = load(html);
  const base = new URL(indexUrl);
  const identity = sourceIdentity(base.pathname);
  const novelTitle = normalizeText($('h1 > a').first().text()) || normalizeText($('meta[property="og:novel:book_name"]').attr('content') ?? '');
  if (!novelTitle) throw new SourceError('SOURCE_LAYOUT_CHANGED', 'Novel title is missing from the directory');
  const author = normalizeText($('meta[name="author"]').attr('content') ?? '') || null;
  const seen = new Set<string>();
  const chapters: ChapterRef[] = [];
  $('.centent ul li a').each((_index, element) => {
    const href = $(element).attr('href');
    const title = normalizeText($(element).text());
    if (!href || !title) return;
    let url: URL;
    try { url = new URL(href, base); } catch { return; }
    if (url.protocol !== 'https:' || url.hostname !== 'www.piaotia.com' || sourceIdentityOrNull(url.pathname) !== identity || !CHAPTER_PATH.test(url.pathname)) return;
    url.search = ''; url.hash = '';
    const canonical = url.href;
    if (seen.has(canonical)) return;
    seen.add(canonical);
    chapters.push({ sourceChapterId: chapterId(url), url: canonical, title, ordinal: chapters.length });
  });
  if (chapters.length === 0) throw new SourceError('SOURCE_LAYOUT_CHANGED', 'No chapter links were found in the directory');
  return { novel: { sourceNovelId: identity, title: novelTitle, author, indexUrl: new URL(`https://www.piaotia.com/html/${identity}/index.html`).href }, chapters };
}

function sourceIdentityOrNull(pathname: string): string | null {
  try { return sourceIdentity(pathname); } catch { return null; }
}

interface IndexedPosition { startIndex: number; endIndex: number }
function indexed(node: unknown, label: string): IndexedPosition {
  if (!node || typeof node !== 'object' || !('startIndex' in node) || !('endIndex' in node) || typeof node.startIndex !== 'number' || typeof node.endIndex !== 'number') {
    throw new SourceError('SOURCE_LAYOUT_CHANGED', `${label} source position is missing`);
  }
  return { startIndex: node.startIndex, endIndex: node.endIndex };
}

export function parseChapter(html: string): { novelTitle: string; title: string; paragraphs: string[] } {
  if (/cf-chl-|captcha|attention required/i.test(html) && html.length < 100_000) throw new SourceError('SOURCE_BLOCKED', 'Piaotia returned a challenge page');
  const $ = load(html);
  const heading = $('h1').first();
  const novelTitle = normalizeText(heading.find('a').first().text());
  const title = normalizeText(heading.clone().find('a').remove().end().text());
  if (!novelTitle || !title) throw new SourceError('SOURCE_LAYOUT_CHANGED', 'Chapter heading is missing');
  const top = $('.toplink').first();
  const bottom = $('.bottomlink').first();
  if (!top.length || !bottom.length) throw new SourceError('SOURCE_LAYOUT_CHANGED', 'Chapter navigation anchors are missing');
  const table = top.nextAll('table').first();
  if (!table.length) throw new SourceError('SOURCE_LAYOUT_CHANGED', 'Chapter advertising boundary is missing');
  const tableNode = indexed(table.get(0), 'Advertising table');
  const bottomNode = indexed(bottom.get(0), 'Bottom navigation');
  const comment = html.indexOf('翻页上AD开始', tableNode.endIndex + 1);
  const end = comment >= 0 && comment < bottomNode.startIndex ? html.lastIndexOf('<!--', comment) : bottomNode.startIndex;
  if (end <= tableNode.endIndex) throw new SourceError('SOURCE_LAYOUT_CHANGED', 'Chapter body boundaries are invalid');
  const fragment = html.slice(tableNode.endIndex + 1, end).replace(/<br\s*\/?>/gi, '\n');
  const body = cheerio.load(`<main>${fragment}</main>`, null, false);
  body('script,style,table,iframe,a').remove();
  const paragraphs = body('main').text().split(/\r?\n+/).map(normalizeText).filter(Boolean);
  if (paragraphs.length === 0) throw new SourceError('SOURCE_LAYOUT_CHANGED', 'Chapter body is empty');
  return { novelTitle, title, paragraphs };
}

export const piaotia: SourceAdapter = {
  id: 'piaotia', name: 'Piaotia', version: '1.0.0', hosts: ['www.piaotia.com'],
  matches(url) { try { canonicalChapterUrl(url); return true; } catch { return false; } },
  async resolveChapter(url, ctx) {
    const canonical = canonicalChapterUrl(url);
    const identity = sourceIdentity(canonical.pathname);
    const indexUrl = `https://www.piaotia.com/html/${identity}/index.html`;
    const [chapterHtml, directoryHtml] = await Promise.all([ctx.fetchHtml(canonical.href), ctx.fetchHtml(indexUrl)]);
    const parsedChapter = parseChapter(chapterHtml);
    const directory = parseDirectory(directoryHtml, indexUrl);
    const chapter = directory.chapters.find((item) => item.url === canonical.href);
    if (!chapter) throw new SourceError('SEED_NOT_IN_DIRECTORY', 'Submitted chapter is not present in the novel directory');
    if (parsedChapter.novelTitle !== directory.novel.title) throw new SourceError('SOURCE_LAYOUT_CHANGED', 'Chapter and directory novel titles differ');
    return { novel: directory.novel, chapter };
  },
  async listChapters(novel, ctx) { return parseDirectory(await ctx.fetchHtml(novel.indexUrl), novel.indexUrl).chapters; },
  async fetchChapter(chapter, ctx) {
    const parsed = parseChapter(await ctx.fetchHtml(chapter.url));
    return { title: parsed.title, paragraphs: parsed.paragraphs };
  },
};
