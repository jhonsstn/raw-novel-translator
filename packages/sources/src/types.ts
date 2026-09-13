export interface ChapterRef { sourceChapterId: string; url: string; title: string; ordinal: number }
export interface NovelRef { sourceNovelId: string; indexUrl: string }
export interface SourceContext { fetchHtml(url: string): Promise<string>; signal: AbortSignal }
export interface SourceAdapter {
  id: string;
  name: string;
  version: string;
  hosts: readonly string[];
  matches(url: URL): boolean;
  resolveNovel(url: URL): NovelRef;
  listChapters(novel: NovelRef, ctx: SourceContext): Promise<ChapterRef[]>;
  fetchChapter(chapter: ChapterRef, ctx: SourceContext): Promise<{ title: string; paragraphs: string[] }>;
}

export interface ConfigurableSourceDefinition {
  id: string;
  name: string;
  siteUrl: string;
  chapterPathPattern: string;
  indexPathTemplate: string;
  chapterLinkSelector: string;
  chapterTitleSelector: string;
  chapterContentSelector: string;
  chapterContentEndSelector?: string | null;
  chapterContentExcludeSelector?: string | null;
}

export class SourceError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'SourceError'; }
}
