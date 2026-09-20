'use client';
import { ArrowLeft, ArrowRight, Check, Languages, List, Settings2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ReaderTtsControls } from './reader-tts-controls';

interface Chapter {
  id: string;
  novelId: string;
  ordinal: number;
  title: string;
  sourceTitle: string;
  englishTitle: string | null;
  sourceParagraphs: string[] | null;
  englishParagraphs: string[] | null;
  translatedModel: string | null;
  fetched: boolean;
  translated: boolean;
  readAt: number | null;
}
interface NovelChapter {
  id: string;
  ordinal: number;
  title: string;
  readAt: number | null;
}
interface Novel {
  id: string;
  displayTitle: string;
  chapters: NovelChapter[];
  progress: { current_chapter_id: string | null; source_scroll_ratio: number; english_scroll_ratio: number } | null;
}
type Mode = 'source' | 'en';

function isChapter(value: unknown): value is Chapter {
  return !!value && typeof value === 'object' && 'id' in value && 'novelId' in value && 'title' in value;
}
function isNovel(value: unknown): value is Novel {
  return (
    !!value &&
    typeof value === 'object' &&
    'id' in value &&
    'displayTitle' in value &&
    'chapters' in value &&
    Array.isArray(value.chapters)
  );
}
function errorMessage(value: unknown, fallback: string): string {
  if (!value || typeof value !== 'object' || !('error' in value)) return fallback;
  const error = value.error;
  if (!error || typeof error !== 'object' || !('message' in error) || typeof error.message !== 'string')
    return fallback;
  return error.message;
}

function chapterHeading(mode: Mode, ordinal: number, title: string): string {
  const includesNumber = title.includes(String(ordinal));
  const includesLocalizedChapterNumber = mode === 'source' && /^第.+章/.test(title);
  const includesEnglishChapterNumber = mode === 'en' && /^chapter\b/i.test(title);
  if (includesNumber || includesLocalizedChapterNumber || includesEnglishChapterNumber) return title;
  return mode === 'en' ? `Chapter ${ordinal}. ${title}` : `第 ${ordinal} 章。${title}`;
}

export function ReaderClient({ chapterId }: { chapterId: string }) {
  const router = useRouter();
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [novel, setNovel] = useState<Novel | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<Mode>('en');
  const [fontSize, setFontSize] = useState(20);
  const [lineHeight, setLineHeight] = useState(1.85);
  const [focus, setFocus] = useState(false);
  const contentRef = useRef<HTMLElement>(null);
  const readerMenu = useRef<HTMLDetailsElement>(null);
  const timer = useRef<number | null>(null);
  const restored = useRef('');
  const load = useCallback(async () => {
    setError('');
    const chapterResponse = await fetch(`/api/chapters/${chapterId}`, { cache: 'no-store' });
    const chapterValue: unknown = await chapterResponse.json();
    if (!chapterResponse.ok || !isChapter(chapterValue)) {
      setError(chapterResponse.ok ? 'Invalid chapter response' : errorMessage(chapterValue, 'Chapter unavailable'));
      return;
    }
    setChapter(chapterValue);
    const novelResponse = await fetch(`/api/novels/${chapterValue.novelId}`, { cache: 'no-store' });
    const novelValue: unknown = await novelResponse.json();
    if (!novelResponse.ok || !isNovel(novelValue)) {
      setError('Novel unavailable');
      return;
    }
    setNovel(novelValue);
    const savedMode = localStorage.getItem('reader-language');
    setMode(
      savedMode === 'source' || (savedMode === 'en' && chapterValue.englishParagraphs)
        ? savedMode
        : chapterValue.englishParagraphs
          ? 'en'
          : 'source',
    );
    setFontSize(Number(localStorage.getItem('reader-font-size')) || 20);
    setLineHeight(Number(localStorage.getItem('reader-line-height')) || 1.85);
  }, [chapterId]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    function dismissReaderMenu(event: PointerEvent) {
      if (!readerMenu.current?.contains(event.target as Node)) readerMenu.current?.removeAttribute('open');
    }
    function dismissReaderMenuWithKeyboard(event: KeyboardEvent) {
      if (event.key === 'Escape') readerMenu.current?.removeAttribute('open');
    }
    document.addEventListener('pointerdown', dismissReaderMenu);
    document.addEventListener('keydown', dismissReaderMenuWithKeyboard);
    return () => {
      document.removeEventListener('pointerdown', dismissReaderMenu);
      document.removeEventListener('keydown', dismissReaderMenuWithKeyboard);
    };
  }, []);
  const save = useCallback(
    async (targetChapterId: string, targetMode: Mode, scrollRatio: number, completed?: boolean) => {
      if (!novel) return;
      const payload: Record<string, unknown> = { chapterId: targetChapterId, mode: targetMode, scrollRatio };
      if (completed !== undefined) payload.completed = completed;
      await fetch(`/api/novels/${novel.id}/progress`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    },
    [novel],
  );
  useEffect(() => {
    if (!novel || !chapter) return;
    const element = contentRef.current;
    const key = `${chapter.id}:${mode}`;
    if (!element || restored.current === key) return;
    restored.current = key;
    const ratio =
      novel.progress?.current_chapter_id === chapter.id
        ? mode === 'en'
          ? novel.progress.english_scroll_ratio
          : novel.progress.source_scroll_ratio
        : 0;
    requestAnimationFrame(() => {
      element.scrollTop = (element.scrollHeight - element.clientHeight) * ratio;
      void save(chapter.id, mode, ratio);
    });
  }, [novel, chapter, mode, save]);
  function ratio() {
    const element = contentRef.current;
    return element && element.scrollHeight > element.clientHeight
      ? element.scrollTop / (element.scrollHeight - element.clientHeight)
      : 0;
  }
  function scheduleSave() {
    if (!chapter) return;
    clearTimeout(timer.current ?? undefined);
    timer.current = window.setTimeout(() => {
      void save(chapter.id, mode, ratio());
    }, 350);
  }
  function chooseMode(next: Mode) {
    if (next === 'en' && !chapter?.englishParagraphs) return;
    localStorage.setItem('reader-language', next);
    setMode(next);
  }
  function persistPreference(key: string, value: string) {
    localStorage.setItem(key, value);
  }
  function adjustFontSize(amount: number) {
    const value = Math.min(28, Math.max(16, fontSize + amount));
    setFontSize(value);
    persistPreference('reader-font-size', String(value));
  }
  function toggleLineHeight() {
    const value = lineHeight === 1.85 ? 2.05 : 1.85;
    setLineHeight(value);
    persistPreference('reader-line-height', String(value));
  }
  async function translate() {
    if (!chapter) return;
    const response = await fetch(`/api/chapters/${chapter.id}/translation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"regenerate":false}',
    });
    const value: unknown = await response.json();
    setError(
      response.ok
        ? 'Translation queued. Activity shows its progress.'
        : errorMessage(value, 'Could not queue translation'),
    );
  }
  async function go(target: NovelChapter, completeCurrent = false) {
    if (!chapter) return;
    clearTimeout(timer.current ?? undefined);
    await save(chapter.id, mode, ratio(), completeCurrent ? true : undefined);
    await save(target.id, mode, 0);
    router.push(`/read/${target.id}`);
  }
  async function toggleRead() {
    if (!chapter) return;
    await save(chapter.id, mode, ratio(), chapter.readAt === null);
    setChapter({ ...chapter, readAt: chapter.readAt === null ? Date.now() : null });
  }
  async function goContents() {
    if (!chapter || !novel) return;
    clearTimeout(timer.current ?? undefined);
    await save(chapter.id, mode, ratio());
    router.push(`/novels/${novel.id}`);
  }
  if (!chapter || !novel)
    return (
      <div className="rounded-[15px] border border-dashed border-line-strong bg-card/60 px-6 py-16 text-center text-muted">
        {error || 'Opening chapter…'}
      </div>
    );
  const index = novel.chapters.findIndex((item) => item.id === chapter.id);
  const previous = novel.chapters[index - 1];
  const next = novel.chapters[index + 1];
  const paragraphs = mode === 'en' ? chapter.englishParagraphs : chapter.sourceParagraphs;
  const activeTitle = mode === 'en' ? (chapter.englishTitle ?? chapter.title) : chapter.sourceTitle;
  const activeHeading = chapterHeading(mode, chapter.ordinal, activeTitle);
  const narrationParagraphs = paragraphs ? [activeHeading, ...paragraphs] : null;
  const buttonClass =
    'inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border border-line bg-card px-3.5 text-[13px] font-bold text-ink transition-[transform,border-color,background-color,box-shadow] duration-150 enabled:hover:-translate-y-px enabled:hover:border-line-strong enabled:hover:bg-card-hover enabled:hover:shadow-button';
  const primaryButtonClass =
    'inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border border-accent bg-accent px-3.5 text-[13px] font-bold text-white shadow-[0_7px_18px_color-mix(in_srgb,var(--color-accent)_22%,transparent)] transition-[transform,border-color,background-color] duration-150 enabled:hover:-translate-y-px enabled:hover:border-accent-hover enabled:hover:bg-accent-hover';
  const segmentClass =
    'min-h-[34px] whitespace-nowrap rounded-lg border-0 bg-transparent px-[13px] text-[13px] font-[650] text-muted hover:text-ink';
  return (
    <div className={focus ? 'reader-focus' : undefined}>
      <div
        className={`sticky z-10 -mx-8 -mt-[52px] mb-[26px] border-b border-line bg-[color-mix(in_srgb,var(--color-paper)_88%,transparent)] px-[max(32px,calc((100%_-_1240px)/2))] py-[13px] backdrop-blur-2xl max-[760px]:-mx-3.5 max-[760px]:-mt-8 max-[760px]:mb-5 max-[760px]:px-3 max-[760px]:py-2.5 ${
          focus ? 'top-0 max-[760px]:mt-0' : 'top-0 max-[760px]:top-16'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2.5 max-[760px]:hidden">
          <button className={buttonClass} onClick={() => void goContents()}>
            <List size={16} /> Contents
          </button>
          <div className="grid text-center max-[760px]:order-first max-[760px]:w-full">
            <strong>{activeTitle}</strong>
            <span className="text-[10px] uppercase tracking-[.13em] text-muted">
              Chapter {index + 1} of {novel.chapters.length}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-[9px]">
            {previous && (
              <button className={buttonClass} onClick={() => void go(previous)} aria-label="Previous chapter">
                <ArrowLeft size={16} />
              </button>
            )}
            {next && (
              <button className={primaryButtonClass} onClick={() => void go(next, true)} aria-label="Next chapter">
                <ArrowRight size={16} />
              </button>
            )}
          </div>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center justify-center gap-2.5 max-[760px]:hidden">
          <div
            className="flex max-w-full overflow-x-auto rounded-[11px] border border-line bg-paper-raised p-[3px]"
            aria-label="Reading language"
          >
            <button
              className={`${segmentClass} ${mode === 'en' ? 'bg-card text-ink-strong shadow-[0_1px_4px_rgb(0_0_0/10%)]' : ''}`}
              disabled={!chapter.englishParagraphs}
              onClick={() => chooseMode('en')}
            >
              English
            </button>
            <button
              className={`${segmentClass} ${mode === 'source' ? 'bg-card text-ink-strong shadow-[0_1px_4px_rgb(0_0_0/10%)]' : ''}`}
              onClick={() => chooseMode('source')}
            >
              Chinese
            </button>
          </div>
          <button className={buttonClass} onClick={() => void toggleRead()}>
            <Check size={15} /> {chapter.readAt ? 'Mark unread' : 'Mark read'}
          </button>
          <button className={buttonClass} onClick={() => adjustFontSize(-1)} aria-label="Decrease font size">
            A−
          </button>
          <button className={buttonClass} onClick={() => adjustFontSize(1)} aria-label="Increase font size">
            A+
          </button>
          <button className={buttonClass} onClick={toggleLineHeight} aria-label="Toggle line spacing">
            ↕
          </button>
          <button className={buttonClass} onClick={() => setFocus(!focus)}>
            Focus
          </button>
        </div>
        <div className="hidden grid-cols-[40px_minmax(0,1fr)_40px] items-center gap-2 max-[760px]:grid">
          <button
            className={`${buttonClass} size-10 min-h-0 p-0!`}
            aria-label="Open chapter contents"
            onClick={() => void goContents()}
          >
            <List size={18} />
          </button>
          <div className="min-w-0 text-center">
            <strong className="block truncate text-sm">{activeTitle}</strong>
            <span className="block text-[9px] uppercase tracking-[.13em] text-muted">
              Chapter {index + 1} of {novel.chapters.length}
            </span>
          </div>
          <details className="group relative" ref={readerMenu}>
            <summary
              className={`${buttonClass} size-10 min-h-0 list-none p-0! [&::-webkit-details-marker]:hidden`}
              aria-label="Reader settings"
            >
              <Settings2 size={18} />
            </summary>
            <div className="absolute top-[calc(100%+8px)] right-0 z-30 w-[min(280px,calc(100vw-28px))] rounded-xl border border-line bg-card p-2.5 text-left shadow-float">
              <div className="px-2 pb-2 text-[10px] font-bold uppercase tracking-[.13em] text-muted">
                Reader settings
              </div>
              <button
                className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 text-sm font-semibold hover:bg-card-hover"
                type="button"
                onClick={() => void toggleRead()}
              >
                <Check size={16} /> {chapter.readAt ? 'Mark as unread' : 'Mark as read'}
              </button>
              <div className="my-1.5 border-t border-line" />
              <div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
                <span className="text-sm font-semibold">Text size</span>
                <div className="flex items-center gap-1.5">
                  <button
                    className={`${buttonClass} size-9 min-h-0 p-0!`}
                    type="button"
                    aria-label="Decrease font size"
                    onClick={() => adjustFontSize(-1)}
                  >
                    A−
                  </button>
                  <span className="w-11 text-center text-xs tabular-nums text-muted">{fontSize}px</span>
                  <button
                    className={`${buttonClass} size-9 min-h-0 p-0!`}
                    type="button"
                    aria-label="Increase font size"
                    onClick={() => adjustFontSize(1)}
                  >
                    A+
                  </button>
                </div>
              </div>
              <button
                className="flex min-h-10 w-full items-center justify-between gap-3 rounded-lg px-2.5 text-sm font-semibold hover:bg-card-hover"
                type="button"
                onClick={toggleLineHeight}
              >
                <span>Line spacing</span>
                <span className="text-xs font-normal text-muted">
                  {lineHeight === 1.85 ? 'Comfortable' : 'Relaxed'}
                </span>
              </button>
              <button
                className="flex min-h-10 w-full items-center justify-between gap-3 rounded-lg px-2.5 text-sm font-semibold hover:bg-card-hover"
                type="button"
                onClick={() => {
                  readerMenu.current?.removeAttribute('open');
                  setFocus(!focus);
                }}
              >
                <span>{focus ? 'Exit focus mode' : 'Enter focus mode'}</span>
                <span className="text-xs font-normal text-muted">Distraction free</span>
              </button>
            </div>
          </details>
        </div>
        <div className="mt-2 hidden items-center justify-between gap-2 max-[760px]:flex">
          <div className="flex rounded-[10px] border border-line bg-paper-raised p-0.5" aria-label="Reading language">
            <button
              className={`${segmentClass} min-h-8 px-3 ${mode === 'en' ? 'bg-card text-ink-strong shadow-[0_1px_4px_rgb(0_0_0/10%)]' : ''}`}
              disabled={!chapter.englishParagraphs}
              onClick={() => chooseMode('en')}
            >
              English
            </button>
            <button
              className={`${segmentClass} min-h-8 px-3 ${mode === 'source' ? 'bg-card text-ink-strong shadow-[0_1px_4px_rgb(0_0_0/10%)]' : ''}`}
              onClick={() => chooseMode('source')}
            >
              Chinese
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              className={`${buttonClass} size-9 min-h-0 p-0!`}
              disabled={!previous}
              aria-label="Previous chapter"
              onClick={() => previous && void go(previous)}
            >
              <ArrowLeft size={17} />
            </button>
            <button
              className={`${primaryButtonClass} size-9 min-h-0 p-0!`}
              disabled={!next}
              aria-label="Next chapter"
              onClick={() => next && void go(next, true)}
            >
              <ArrowRight size={17} />
            </button>
          </div>
        </div>
      </div>
      {error && (
        <div className="mx-auto mb-[18px] w-[min(780px,100%)] rounded-[10px] border border-[color-mix(in_srgb,var(--color-warning)_30%,var(--color-line))] bg-[color-mix(in_srgb,var(--color-warning)_10%,var(--color-card))] px-3.5 py-3 text-warning">
          {error}
        </div>
      )}
      <ReaderTtsControls
        chapterId={chapter.id}
        language={mode}
        paragraphs={narrationParagraphs}
        contentRef={contentRef}
        hasNextChapter={Boolean(next)}
        onAutoNext={async () => {
          if (next) await go(next, true);
        }}
      />
      <article
        className="mx-auto h-[calc(100vh_-_260px)] min-h-[360px] w-[min(780px,100%)] overflow-auto rounded-[15px] border border-line bg-reader-paper p-[clamp(26px,5vw,60px)] font-serif text-reader shadow-card max-[760px]:h-[calc(100dvh_-_280px)] max-[760px]:min-h-80 max-[760px]:px-[19px] max-[760px]:py-[26px] [&_p]:mb-[1.25em]"
        ref={contentRef}
        onScroll={scheduleSave}
        style={{ fontSize, lineHeight }}
      >
        <div className="mb-7 text-[10px] uppercase tracking-[.13em] text-muted">
          {mode === 'en' ? `English${chapter.translatedModel ? ` · ${chapter.translatedModel}` : ''}` : 'Chinese原文'}
        </div>
        {paragraphs ? (
          <>
            <p className="mb-8! text-[1.08em] font-bold leading-snug text-ink-strong">{activeHeading}</p>
            {paragraphs.map((paragraph, paragraphIndex) => (
              <p key={paragraphIndex}>{paragraph}</p>
            ))}
          </>
        ) : mode === 'en' && chapter.sourceParagraphs ? (
          <div className="rounded-[15px] border border-dashed border-line-strong bg-card/60 px-6 py-16 text-center text-muted">
            <p>No English translation yet.</p>
            <button className={primaryButtonClass} onClick={() => void translate()}>
              <Languages size={16} /> Translate chapter
            </button>
          </div>
        ) : (
          <p className="text-muted">This chapter is still downloading.</p>
        )}
      </article>
      <div className="mx-auto mt-5 flex w-[min(780px,100%)] flex-wrap items-center justify-between gap-2.5 max-[760px]:grid max-[760px]:grid-cols-2">
        <button className={buttonClass} disabled={!previous} onClick={() => previous && void go(previous)}>
          <ArrowLeft size={16} /> Previous
        </button>
        <button className={`${buttonClass} max-[760px]:hidden`} onClick={() => void goContents()}>
          <List size={16} /> Contents
        </button>
        <button className={`${buttonClass} max-[760px]:hidden`} onClick={() => void toggleRead()}>
          <Check size={16} /> {chapter.readAt ? 'Mark unread' : 'Mark read'}
        </button>
        <button className={primaryButtonClass} disabled={!next} onClick={() => next && void go(next, true)}>
          Next <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}
