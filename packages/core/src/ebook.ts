import JSZip from 'jszip';
import sharp from 'sharp';
import { getNovelEpubData } from './library.js';

const XHTML_STYLE = `
body { margin: 5%; line-height: 1.6; overflow-wrap: anywhere; }
p { margin: 0 0 1em; }
`.trim();

function xml(value: string): string {
  let valid = '';
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (
      codePoint === 0x9 ||
      codePoint === 0xa ||
      codePoint === 0xd ||
      (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
      (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
      (codePoint >= 0x10000 && codePoint <= 0x10ffff)
    )
      valid += character;
  }
  return valid
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function xhtmlDocument(title: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en" xml:lang="en">
<head><meta charset="UTF-8"/><title>${xml(title)}</title><style>${XHTML_STYLE}</style></head>
<body>${body}</body>
</html>`;
}

function filenameForTitle(title: string): string {
  let stem = title
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 100)
    .replace(/[.-]+$/g, '');
  if (!stem) stem = 'novel';
  return `${stem}-english.epub`;
}

export async function createNovelEpub(
  novelId: string,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; filename: string }> {
  const novel = getNovelEpubData(novelId);
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE', createFolders: false });
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
    { createFolders: false },
  );

  const title = xml(novel.title);
  const identifier = xml(`urn:novel:${novel.id}`);
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const chapterItems: string[] = [];
  const spineItems: string[] = [];
  const navItems: string[] = [];
  const ncxItems: string[] = [];

  novel.chapters.forEach((chapter, offset) => {
    const index = offset + 1;
    const heading = `Chapter ${chapter.ordinal}`;
    const href = `chapters/chapter-${index}.xhtml`;
    const id = `chapter-${index}`;
    chapterItems.push(`    <item id="${id}" href="${href}" media-type="application/xhtml+xml"/>`);
    spineItems.push(`    <itemref idref="${id}"/>`);
    navItems.push(`        <li><a href="${href}">${xml(heading)}</a></li>`);
    ncxItems.push(`    <navPoint id="nav-${index}" playOrder="${index}">
      <navLabel><text>${xml(heading)}</text></navLabel><content src="${href}"/>
    </navPoint>`);
    const paragraphs = chapter.paragraphs.map((paragraph) => `<p>${xml(paragraph)}</p>`).join('\n');
    zip.file(
      `EPUB/${href}`,
      xhtmlDocument(heading, `<h1>${xml(heading)}</h1>\n${paragraphs}`),
      { createFolders: false },
    );
  });

  let coverManifest = '';
  let coverMetadata = '';
  let coverSpine = '';
  if (novel.cover) {
    const cover = await sharp(novel.cover)
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 85 })
      .toBuffer();
    zip.file('EPUB/images/cover.jpg', cover, { createFolders: false });
    zip.file(
      'EPUB/cover.xhtml',
      xhtmlDocument(
        `Cover — ${novel.title}`,
        '<div style="text-align:center"><img src="images/cover.jpg" alt="Cover" style="max-width:100%;height:auto"/></div>',
      ),
      { createFolders: false },
    );
    coverManifest = `
    <item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover-image" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>`;
    coverMetadata = '\n    <meta name="cover" content="cover-image"/>';
    coverSpine = '\n    <itemref idref="cover-page"/>';
  }

  zip.file(
    'EPUB/nav.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head><meta charset="UTF-8"/><title>Contents — ${title}</title></head>
<body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>
${navItems.join('\n')}
      </ol></nav></body>
</html>`,
    { createFolders: false },
  );

  zip.file(
    'EPUB/toc.ncx',
    `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="${identifier}"/></head>
  <docTitle><text>${title}</text></docTitle>
  <navMap>
${ncxItems.join('\n')}
  </navMap>
</ncx>`,
    { createFolders: false },
  );

  zip.file(
    'EPUB/package.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">
    <dc:identifier id="book-id">${identifier}</dc:identifier>
    <dc:title>${title}</dc:title>${novel.author === null ? '' : `\n    <dc:creator>${xml(novel.author)}</dc:creator>`}
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">${modified}</meta>${coverMetadata}
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>${coverManifest}
${chapterItems.join('\n')}
  </manifest>
  <spine toc="ncx">${coverSpine}
${spineItems.join('\n')}
  </spine>
</package>`,
    { createFolders: false },
  );

  const buffer = await zip.generateAsync({
    type: 'arraybuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    streamFiles: false,
  });
  return { bytes: new Uint8Array(buffer), filename: filenameForTitle(novel.title) };
}
