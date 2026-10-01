import { createSourceTransport } from '../packages/sources/dist/http.js';
import { parseChapter, piaotia } from '../packages/sources/dist/piaotia.js';

const chapterUrl = process.argv[2] ?? 'https://www.piaotia.com/html/3/3847/11622833.html';
if (!piaotia.matches(new URL(chapterUrl))) throw new Error('Expected a canonical Piaotia chapter URL');

try {
  const html = await createSourceTransport({ signal: AbortSignal.timeout(30_000) })(chapterUrl);
  const chapter = parseChapter(html);
  console.log(`App transport: success (${chapter.paragraphs.length} paragraphs)`);
} catch (error) {
  console.log(`App transport: ${error.code ?? error.name}: ${error.message}`);
}

const endpoint = process.env.FLARESOLVERR_URL ?? 'http://127.0.0.1:8191';
const html = await createSourceTransport({
  signal: AbortSignal.timeout(90_000),
  flaresolverrUrl: endpoint,
})(chapterUrl);
const chapter = parseChapter(html);
console.log(`App transport through FlareSolverr: success (${chapter.paragraphs.length} paragraphs)`);
console.log(`Title: ${chapter.title}`);
