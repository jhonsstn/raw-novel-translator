import { describe, expect, it } from 'vitest';
import iconv = require('iconv-lite');
import { decodeSourceBytes } from '../src/http.js';
import { parseChapter, parseDirectory, piaotia } from '../src/piaotia.js';

describe('Piaotia adapter', () => {
  it('accepts only canonical chapter URLs', () => {
    expect(piaotia.matches(new URL('https://www.piaotia.com/html/1/2/3.html'))).toBe(true);
    expect(piaotia.matches(new URL('http://www.piaotia.com/html/1/2/3.html'))).toBe(false);
    expect(piaotia.matches(new URL('https://piaotia.com/html/1/2/3.html'))).toBe(false);
    expect(piaotia.matches(new URL('https://www.piaotia.com/html/1/2/3.html?x=1'))).toBe(false);
  });

  it('preserves directory order and ignores foreign and duplicate links', () => {
    const html = `<html><head><meta name="author" content="Author"></head><body><h1><a>Book</a></h1><div class="centent"><ul>
      <li><a href="1.html">First</a></li><li><a href="2.html">Second</a></li><li><a href="2.html#copy">Second copy</a></li>
      <li><a href="https://evil.example/3.html">Foreign</a></li></ul></div></body></html>`;
    const result = parseDirectory(html, 'https://www.piaotia.com/html/10/20/index.html');
    expect(result.novel).toMatchObject({ sourceNovelId: '10/20', title: 'Book', author: 'Author' });
    expect(result.chapters.map((chapter) => [chapter.sourceChapterId, chapter.title, chapter.ordinal])).toEqual([['1', 'First', 0], ['2', 'Second', 1]]);
  });

  it('extracts only content between the advertising and navigation boundaries', () => {
    const html = `<h1><a>Book</a> Chapter One</h1><div class="toplink">top</div><table><tr><td>advert</td></tr></table>
      第一段。<br>第二段。<!--翻页上AD开始--><div>bottom advert</div><div class="bottomlink">bottom</div>`;
    expect(parseChapter(html)).toEqual({ novelTitle: 'Book', title: 'Chapter One', paragraphs: ['第一段。', '第二段。'] });
  });

  it('decodes GBK source bytes before parsing', () => {
    const bytes = iconv.encode('第一章：你好，世界。', 'gb18030');
    expect(decodeSourceBytes(bytes, 'text/html; charset=gbk')).toBe('第一章：你好，世界。');
  });
});
