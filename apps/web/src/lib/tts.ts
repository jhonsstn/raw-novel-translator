export function hasSpeechText(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

export function splitForSpeech(text: string, maxCharacters = 3900): string[] {
  if (!hasSpeechText(text)) return [];
  if (Array.from(text).length <= maxCharacters) return [text];
  const sentences = text.match(/[^.!?。！？]+[.!?。！？…]*\s*/g) ?? [text];
  const chunks: string[] = [];
  let current = '';
  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };
  for (const sentence of sentences) {
    const chars = Array.from(sentence.trim());
    if (chars.length > maxCharacters) {
      flush();
      for (let offset = 0; offset < chars.length; offset += maxCharacters)
        chunks.push(
          chars
            .slice(offset, offset + maxCharacters)
            .join('')
            .trim(),
        );
      continue;
    }
    if (Array.from(current).length + chars.length + 1 > maxCharacters) flush();
    current = current ? `${current} ${sentence.trim()}` : sentence.trim();
  }
  flush();
  return chunks.filter(hasSpeechText);
}

export function speechSegments(paragraphs: string[], startIndex = 0) {
  return paragraphs
    .slice(startIndex)
    .flatMap((paragraph, offset) =>
      splitForSpeech(paragraph).map((text, part) => ({ index: startIndex + offset, part, text })),
    );
}
