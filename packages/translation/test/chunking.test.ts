import { describe, expect, it } from 'vitest';
import { chunkParagraphs } from '../src/chunking.js';

describe('chunkParagraphs', () => {
  it('never splits a Unicode code point or exceeds the configured limit', () => {
    const chunks = chunkParagraphs(['你好🙂世界。再见！', '第二段文字。'], 6);
    expect(chunks.every((chunk) => Array.from(chunk).length <= 6)).toBe(true);
    expect(chunks.join('').replaceAll('\n', '')).toBe('你好🙂世界。再见！第二段文字。');
    expect(chunks.some((chunk) => chunk.includes('�'))).toBe(false);
  });
});
