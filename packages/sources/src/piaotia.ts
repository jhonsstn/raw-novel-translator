import { createConfigurableSource, parseConfigurableChapter, parseConfigurableDirectory } from './configurable.js';
import type { ConfigurableSourceDefinition } from './types.js';

export const piaotiaDefinition: ConfigurableSourceDefinition = {
  id: 'piaotia',
  name: 'Piaotia',
  siteUrl: 'https://www.piaotia.com',
  chapterPathPattern: '^/html/(\\d+)/(\\d+)/(\\d+)\\.html$',
  indexPathTemplate: '/html/{1}/{2}/index.html',
  novelIdTemplate: '{1}/{2}',
  chapterIdTemplate: '{3}',
  chapterLinkSelector: '.centent ul li a',
  chapterTitleSelector: 'h1',
  chapterTitleExcludeSelector: 'a',
  chapterContentSelector: 'body',
  chapterContentStartSelector: '.toplink + table',
  chapterContentEndSelector: '.bottomlink',
  chapterContentEndText: '翻页上AD开始',
  chapterContentExcludeSelector: 'script,style,table,iframe,a',
};

export const piaotia = createConfigurableSource(piaotiaDefinition);
export const parseDirectory = (html: string, indexUrl: string) => parseConfigurableDirectory(piaotiaDefinition, html, indexUrl);
export const parseChapter = (html: string) => parseConfigurableChapter(piaotiaDefinition, html);
