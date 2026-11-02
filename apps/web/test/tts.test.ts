import { describe, expect, it } from 'vitest';
import { speechSegments, splitForSpeech } from '../src/lib/tts';

describe('narration segments', () => {
  it.each(['…', '...', '……', '。！？', '***', '——', '“…”', '🙂', '', ' \n\t\u00a0'])(
    'skips text without letters or numbers: %j',
    (text) => {
      expect(splitForSpeech(text)).toEqual([]);
    },
  );

  it.each(['Wait…', '“你好……”', '123', '１２３', 'Écoute !', '聞いて！'])('keeps spoken text: %j', (text) => {
    expect(splitForSpeech(text)).toEqual([text]);
  });

  it('continues past consecutive separators and preserves paragraph indexes for highlighting', () => {
    expect(speechSegments(['…', 'Before.', '...', '***', '之后。', '……'])).toEqual([
      { index: 1, part: 0, text: 'Before.' },
      { index: 4, part: 0, text: '之后。' },
    ]);
  });

  it('starts from a visible separator without replaying earlier paragraphs', () => {
    expect(speechSegments(['Already read.', '…', '——', 'Continue here.'], 1)).toEqual([
      { index: 3, part: 0, text: 'Continue here.' },
    ]);
  });

  it('produces no requests when only separators remain', () => {
    expect(speechSegments(['Already read.', '…', '***'], 1)).toEqual([]);
  });

  it('skips punctuation-only pieces created when splitting a long paragraph', () => {
    expect(splitForSpeech('你好世界' + '…'.repeat(8), 4)).toEqual(['你好世界']);
  });

  it('keeps long spoken text within the chunk limit without breaking Unicode characters', () => {
    const text = '你好🙂世界'.repeat(800);
    const chunks = splitForSpeech(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => Array.from(chunk).length <= 3900)).toBe(true);
    expect(chunks.join('')).toBe(text);
  });
});
