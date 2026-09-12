const SENTENCE_END = /(?<=[。！？!?；;])/u;

function takeCodePoints(text: string, limit: number): string[] {
  const points = Array.from(text);
  const parts: string[] = [];
  for (let offset = 0; offset < points.length; offset += limit) parts.push(points.slice(offset, offset + limit).join(''));
  return parts;
}

function splitParagraph(paragraph: string, limit: number): string[] {
  if (Array.from(paragraph).length <= limit) return [paragraph];
  const sentences = paragraph.split(SENTENCE_END).filter(Boolean);
  const pieces: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (Array.from(sentence).length > limit) {
      if (current) { pieces.push(current); current = ''; }
      pieces.push(...takeCodePoints(sentence, limit));
    } else if (Array.from(current + sentence).length <= limit) current += sentence;
    else { pieces.push(current); current = sentence; }
  }
  if (current) pieces.push(current);
  return pieces;
}

export function chunkParagraphs(paragraphs: readonly string[], limit: number): string[] {
  const units = paragraphs.flatMap((paragraph) => splitParagraph(paragraph, limit));
  const chunks: string[] = [];
  let current = '';
  for (const unit of units) {
    const candidate = current ? `${current}\n${unit}` : unit;
    if (Array.from(candidate).length <= limit) current = candidate;
    else { if (current) chunks.push(current); current = unit; }
  }
  if (current) chunks.push(current);
  return chunks;
}
