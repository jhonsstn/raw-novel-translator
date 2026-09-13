'use client';
import { ArrowLeft, ArrowRight, Check, Languages, List, Moon, Sun } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ReaderTtsControls } from './reader-tts-controls';

interface Chapter {
  id: string;
  novelId: string;
  ordinal: number;
  title: string;
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

export function ReaderClient({ chapterId }: { chapterId: string }) {
  const router = useRouter();
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [novel, setNovel] = useState<Novel | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<Mode>('en');
  const [fontSize, setFontSize] = useState(20);
  const [lineHeight, setLineHeight] = useState(1.85);
  const [dark, setDark] = useState(false);
  const [focus, setFocus] = useState(false);
  const contentRef = useRef<HTMLElement>(null);
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
    setDark(localStorage.getItem('reader-theme') === 'dark');
  }, [chapterId]);
  useEffect(() => {
    void load();
  }, [load]);
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
        <div className="flex flex-wrap items-center justify-between gap-2.5 max-[760px]:justify-center">
          <button className={buttonClass} onClick={() => void goContents()}>
            <List size={16} /> Contents
          </button>
          <div className="grid text-center max-[760px]:order-first max-[760px]:w-full">
            <strong>{chapter.title}</strong>
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
        <div className="mt-2.5 flex flex-wrap items-center justify-center gap-2.5 max-[760px]:w-full">
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
          <button
            className={buttonClass}
            onClick={() => {
              const value = Math.max(16, fontSize - 1);
              setFontSize(value);
              persistPreference('reader-font-size', String(value));
            }}
            aria-label="Decrease font size"
          >
            A−
          </button>
          <button
            className={buttonClass}
            onClick={() => {
              const value = Math.min(28, fontSize + 1);
              setFontSize(value);
              persistPreference('reader-font-size', String(value));
            }}
            aria-label="Increase font size"
          >
            A+
          </button>
          <button
            className={buttonClass}
            onClick={() => {
              const value = lineHeight === 1.85 ? 2.05 : 1.85;
              setLineHeight(value);
              persistPreference('reader-line-height', String(value));
            }}
            aria-label="Toggle line spacing"
          >
            ↕
          </button>
          <button
            className={buttonClass}
            onClick={() => {
              setDark(!dark);
              persistPreference('reader-theme', !dark ? 'dark' : 'light');
            }}
            aria-label="Toggle theme"
          >
            {dark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button className={buttonClass} onClick={() => setFocus(!focus)}>
            Focus
          </button>
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
        paragraphs={paragraphs}
        contentRef={contentRef}
        hasNextChapter={Boolean(next)}
        onAutoNext={async () => {
          if (next) await go(next, true);
        }}
      />
      <article
        className={`mx-auto h-[calc(100vh_-_260px)] min-h-[360px] w-[min(780px,100%)] overflow-auto rounded-[15px] border border-line p-[clamp(26px,5vw,60px)] font-serif shadow-card max-[760px]:h-[calc(100vh_-_350px)] max-[760px]:min-h-80 max-[760px]:px-[19px] max-[760px]:py-[26px] [&_p]:mb-[1.25em] ${
          dark ? 'bg-[#171719] text-[#ededf0]' : 'bg-white text-[#222226]'
        }`}
        ref={contentRef}
        onScroll={scheduleSave}
        style={{ fontSize, lineHeight }}
      >
        <div className={`mb-7 text-[10px] uppercase tracking-[.13em] ${dark ? 'text-[#96969f]' : 'text-muted'}`}>
          {mode === 'en' ? `English${chapter.translatedModel ? ` · ${chapter.translatedModel}` : ''}` : 'Chinese原文'}
        </div>
        {paragraphs?.map((paragraph, paragraphIndex) => <p key={paragraphIndex}>{paragraph}</p>) ??
          (mode === 'en' && chapter.sourceParagraphs ? (
            <div className="rounded-[15px] border border-dashed border-line-strong bg-card/60 px-6 py-16 text-center text-muted">
              <p>No English translation yet.</p>
              <button className={primaryButtonClass} onClick={() => void translate()}>
                <Languages size={16} /> Translate chapter
              </button>
            </div>
          ) : (
            <p className="text-muted">This chapter is still downloading.</p>
          ))}
      </article>
      <div className="mx-auto mt-5 flex w-[min(780px,100%)] flex-wrap items-center justify-between gap-2.5 max-[760px]:grid max-[760px]:grid-cols-2">
        <button className={buttonClass} disabled={!previous} onClick={() => previous && void go(previous)}>
          <ArrowLeft size={16} /> Previous
        </button>
        <button className={buttonClass} onClick={() => void goContents()}>
          <List size={16} /> Contents
        </button>
        <button className={buttonClass} onClick={() => void toggleRead()}>
          <Check size={16} /> {chapter.readAt ? 'Mark unread' : 'Mark read'}
        </button>
        <button className={primaryButtonClass} disabled={!next} onClick={() => next && void go(next, true)}>
          Next <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}
