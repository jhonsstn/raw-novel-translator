'use client';
import { Loader2, Pause, Play, Square, Volume2 } from 'lucide-react';
import type { RefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused';

interface TtsSettingsView {
  baseUrl: string | null;
  model: string | null;
  hasApiKey: boolean;
}

interface Props {
  chapterId: string;
  language: 'source' | 'en';
  paragraphs: string[] | null;
  contentRef: RefObject<HTMLElement | null>;
  hasNextChapter: boolean;
  onAutoNext: () => Promise<void>;
}

const buttonClass =
  'inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border border-line bg-card px-3.5 text-[13px] font-bold text-ink transition-[transform,border-color,background-color,box-shadow] duration-150 enabled:hover:-translate-y-px enabled:hover:border-line-strong enabled:hover:bg-card-hover enabled:hover:shadow-button disabled:cursor-not-allowed disabled:opacity-55';
const primaryButtonClass =
  'inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border border-accent bg-accent px-3.5 text-[13px] font-bold text-white shadow-[0_7px_18px_color-mix(in_srgb,var(--color-accent)_22%,transparent)] transition-[transform,border-color,background-color] duration-150 enabled:hover:-translate-y-px enabled:hover:border-accent-hover enabled:hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-55';
const switchClass =
  "h-6 w-11 shrink-0 rounded-full border-0 bg-line-strong p-[3px] after:block after:size-[18px] after:rounded-full after:bg-white after:shadow-[0_1px_3px_rgb(0_0_0/25%)] after:transition-transform after:duration-200 after:content-['']";

function isTtsSettings(value: unknown): value is TtsSettingsView {
  return !!value && typeof value === 'object' && 'baseUrl' in value && 'model' in value && 'hasApiKey' in value;
}

function errorMessage(value: unknown, fallback: string): string {
  if (!value || typeof value !== 'object' || !('error' in value)) return fallback;
  const error = value.error;
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : fallback;
}

function splitForSpeech(text: string, maxCharacters = 3900): string[] {
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
  return chunks.filter(Boolean);
}

export function ReaderTtsControls({ chapterId, language, paragraphs, contentRef, hasNextChapter, onAutoNext }: Props) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [state, setState] = useState<PlaybackState>('idle');
  const [paragraphIndex, setParagraphIndex] = useState<number | null>(null);
  const [autoNext, setAutoNext] = useState(true);
  const [error, setError] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamQueueRef = useRef<Array<{ index: number; part: number; url: string }>>([]);
  const streamDoneRef = useRef(false);
  const cacheRef = useRef(new Map<string, string>());
  const generationRef = useRef(0);

  const clearHighlight = useCallback(() => {
    const nodes = contentRef.current?.querySelectorAll('p') ?? [];
    nodes.forEach((node) => {
      const element = node as HTMLElement;
      element.style.backgroundColor = '';
      element.style.boxShadow = '';
      element.style.borderRadius = '';
    });
  }, [contentRef]);

  const highlight = useCallback(
    (index: number) => {
      clearHighlight();
      const container = contentRef.current;
      const element = container?.querySelectorAll('p').item(index) as HTMLElement | undefined;
      if (!container || !element) return;
      element.style.backgroundColor = 'color-mix(in srgb, var(--color-accent) 8%, transparent)';
      element.style.boxShadow = '0 0 0 6px color-mix(in srgb, var(--color-accent) 8%, transparent)';
      element.style.borderRadius = '6px';
      const containerRect = container.getBoundingClientRect();
      const paragraphRect = element.getBoundingClientRect();
      if (paragraphRect.top < containerRect.top + 24 || paragraphRect.bottom > containerRect.bottom - 24)
        element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    },
    [clearHighlight, contentRef],
  );

  const firstVisibleParagraph = useCallback((): number => {
    const container = contentRef.current;
    if (!container) return 0;
    const containerRect = container.getBoundingClientRect();
    const nodes = Array.from(container.querySelectorAll('p')) as HTMLElement[];
    const index = nodes.findIndex((element) => {
      const rect = element.getBoundingClientRect();
      return rect.bottom > containerRect.top + 8 && rect.top < containerRect.bottom - 8;
    });
    return index >= 0 ? index : 0;
  }, [contentRef]);

  const fetchAudio = useCallback(
    async (index: number, part: number, signal?: AbortSignal): Promise<string> => {
      if (!paragraphs?.[index]) throw new Error('Paragraph is unavailable.');
      const pieces = splitForSpeech(paragraphs[index]);
      const text = pieces[part];
      if (!text) throw new Error('Narration segment is unavailable.');
      const key = `${chapterId}:${language}:${index}:${part}`;
      const cached = cacheRef.current.get(key);
      if (cached) return cached;
      const response = await fetch('/api/tts/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) {
        const value: unknown = await response.json().catch(() => null);
        throw new Error(errorMessage(value, 'Could not generate narration.'));
      }
      const url = URL.createObjectURL(await response.blob());
      cacheRef.current.set(key, url);
      return url;
    },
    [chapterId, language, paragraphs],
  );

  const cleanupAudio = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    streamQueueRef.current.forEach((segment) => URL.revokeObjectURL(segment.url));
    streamQueueRef.current = [];
    streamDoneRef.current = false;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.onended = null;
      audioRef.current.onerror = null;
      audioRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    generationRef.current += 1;
    cleanupAudio();
    setState('idle');
    setParagraphIndex(null);
    clearHighlight();
  }, [cleanupAudio, clearHighlight]);

  const playSegmentRef = useRef<(index: number, part: number) => Promise<void>>(async () => undefined);
  const playSegment = useCallback(
    async (index: number, part: number) => {
      if (!paragraphs?.length || index >= paragraphs.length) return;
      const generation = generationRef.current;
      setState('loading');
      setError('');
      setParagraphIndex(index);
      highlight(index);
      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;
      try {
        const source = await fetchAudio(index, part, controller.signal);
        if (generation !== generationRef.current) return;
        const audio = new Audio(source);
        audioRef.current = audio;
        audio.onended = () => {
          if (generation !== generationRef.current) return;
          const pieces = splitForSpeech(paragraphs[index]!);
          if (part + 1 < pieces.length) {
            void playSegmentRef.current(index, part + 1);
            return;
          }
          if (index + 1 < paragraphs.length) {
            void playSegmentRef.current(index + 1, 0);
            return;
          }
          if (autoNext && hasNextChapter) {
            sessionStorage.setItem('reader-tts-resume', 'true');
            setState('loading');
            void onAutoNext();
            return;
          }
          setState('idle');
          setParagraphIndex(null);
          clearHighlight();
        };
        audio.onerror = () => {
          if (generation === generationRef.current) {
            setState('idle');
            setError('The generated audio could not be played.');
          }
        };
        await audio.play();
        if (generation !== generationRef.current) {
          audio.pause();
          return;
        }
        setState('playing');
        const pieces = splitForSpeech(paragraphs[index]!);
        const nextIndex = part + 1 < pieces.length ? index : index + 1;
        const nextPart = part + 1 < pieces.length ? part + 1 : 0;
        if (nextIndex < paragraphs.length) void fetchAudio(nextIndex, nextPart).catch(() => undefined);
      } catch (cause) {
        if (controller.signal.aborted || generation !== generationRef.current) return;
        setState('idle');
        setError(cause instanceof Error ? cause.message : 'Could not generate narration.');
      }
    },
    [autoNext, clearHighlight, fetchAudio, hasNextChapter, highlight, onAutoNext, paragraphs],
  );
  playSegmentRef.current = playSegment;

  const startStream = useCallback(
    async (startIndex: number) => {
      if (!paragraphs?.length) return;
      generationRef.current += 1;
      const generation = generationRef.current;
      cleanupAudio();
      setState('loading');
      setError('');
      setParagraphIndex(startIndex);
      highlight(startIndex);
      const controller = new AbortController();
      streamAbortRef.current = controller;
      const segments = paragraphs
        .slice(startIndex)
        .flatMap((paragraph, offset) =>
          splitForSpeech(paragraph).map((text, part) => ({ index: startIndex + offset, part, text })),
        );
      const finish = () => {
        if (autoNext && hasNextChapter) {
          sessionStorage.setItem('reader-tts-resume', 'true');
          setState('loading');
          void onAutoNext();
          return;
        }
        setState('idle');
        setParagraphIndex(null);
        clearHighlight();
      };
      const playQueued = async (): Promise<void> => {
        if (generation !== generationRef.current || audioRef.current || streamQueueRef.current.length === 0) return;
        if (streamDoneRef.current && streamQueueRef.current.length === 0) return;
        const segment = streamQueueRef.current.shift();
        if (!segment) return;
        setParagraphIndex(segment.index);
        highlight(segment.index);
        const audio = new Audio(segment.url);
        audioRef.current = audio;
        audio.onended = () => {
          URL.revokeObjectURL(segment.url);
          audioRef.current = null;
          if (streamDoneRef.current && streamQueueRef.current.length === 0) finish();
          else void playQueued();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(segment.url);
          audioRef.current = null;
          setState('idle');
          setError('The generated audio could not be played.');
        };
        try {
          await audio.play();
          if (generation !== generationRef.current) return;
          setState('playing');
        } catch (cause) {
          if (generation === generationRef.current)
            setError(cause instanceof Error ? cause.message : 'Could not play narration.');
        }
      };
      try {
        const response = await fetch('/api/tts/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ segments }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          const value: unknown = await response.json().catch(() => null);
          throw new Error(errorMessage(value, 'Could not start narration stream.'));
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const result = await reader.read();
          buffer += decoder.decode(result.value ?? new Uint8Array(), { stream: !result.done });
          let boundary = buffer.indexOf('\n\n');
          while (boundary >= 0) {
            const raw = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = raw.split('\n').find((line) => line.startsWith('data: '));
            if (data) {
              const event = JSON.parse(data.slice(6)) as {
                type: string;
                index?: number;
                part?: number;
                audio?: string;
                message?: string;
              };
              if (event.type === 'audio.error') throw new Error(event.message ?? 'Narration stream failed.');
              if (
                event.type === 'audio.segment' &&
                event.audio &&
                event.index !== undefined &&
                event.part !== undefined
              ) {
                const binary = atob(event.audio);
                const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
                streamQueueRef.current.push({
                  index: event.index,
                  part: event.part,
                  url: URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' })),
                });
                void playQueued();
              }
            }
            boundary = buffer.indexOf('\n\n');
          }
          if (result.done) break;
        }
        streamDoneRef.current = true;
        void playQueued();
      } catch (cause) {
        if (controller.signal.aborted || generation !== generationRef.current) return;
        setState('idle');
        setError(cause instanceof Error ? cause.message : 'Could not generate narration.');
      }
    },
    [autoNext, cleanupAudio, clearHighlight, hasNextChapter, highlight, onAutoNext, paragraphs],
  );

  useEffect(() => {
    setAutoNext(localStorage.getItem('reader-tts-auto-next') !== 'false');
    void (async () => {
      const response = await fetch('/api/settings/tts', { cache: 'no-store' });
      const value: unknown = await response.json().catch(() => null);
      setConfigured(response.ok && isTtsSettings(value) && Boolean(value.baseUrl && value.model && value.hasApiKey));
    })();
  }, []);

  useEffect(() => {
    generationRef.current += 1;
    cleanupAudio();
    setState('idle');
    setParagraphIndex(null);
    setError('');
    clearHighlight();
    for (const url of cacheRef.current.values()) URL.revokeObjectURL(url);
    cacheRef.current.clear();
  }, [chapterId, language, cleanupAudio, clearHighlight]);

  useEffect(() => {
    if (!configured || !paragraphs?.length || sessionStorage.getItem('reader-tts-resume') !== 'true') return;
    sessionStorage.removeItem('reader-tts-resume');
    const timer = window.setTimeout(() => {
      generationRef.current += 1;
      void startStream(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [configured, chapterId, paragraphs, startStream]);

  useEffect(
    () => () => {
      cleanupAudio();
      clearHighlight();
      for (const url of cacheRef.current.values()) URL.revokeObjectURL(url);
      cacheRef.current.clear();
    },
    [cleanupAudio, clearHighlight],
  );

  async function togglePlayback() {
    if (!configured || !paragraphs?.length) return;
    if (state === 'playing') {
      audioRef.current?.pause();
      setState('paused');
      return;
    }
    if (state === 'paused' && audioRef.current) {
      try {
        await audioRef.current.play();
        setState('playing');
      } catch {
        setError('Your browser blocked audio playback. Press play again.');
      }
      return;
    }
    generationRef.current += 1;
    await startStream(firstVisibleParagraph());
  }

  const label =
    state === 'loading' ? 'Generating…' : state === 'playing' ? 'Pause' : state === 'paused' ? 'Resume' : 'Read aloud';
  const progress =
    paragraphIndex === null || !paragraphs?.length ? null : `${paragraphIndex + 1} / ${paragraphs.length}`;
  return (
    <div className="mx-auto mb-4 w-[min(780px,100%)] rounded-[14px] border border-line bg-card px-3.5 py-3 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-[color-mix(in_srgb,var(--color-accent)_11%,var(--color-card))] text-accent-ink">
            <Volume2 size={17} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold">Narration</div>
            <div className="truncate text-xs text-muted">
              {progress
                ? `Paragraph ${progress} · ${language === 'en' ? 'English' : 'Chinese'}`
                : 'Starts from the first visible paragraph'}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-1 flex items-center gap-2 text-xs text-muted">
            <span>Auto next</span>
            <button
              className={`${switchClass} ${autoNext ? 'bg-success after:translate-x-5' : ''}`}
              type="button"
              role="switch"
              aria-checked={autoNext}
              aria-label="Automatically continue to the next chapter"
              onClick={() => {
                const next = !autoNext;
                setAutoNext(next);
                localStorage.setItem('reader-tts-auto-next', String(next));
              }}
            />
          </div>
          <button
            className={state === 'idle' || state === 'paused' ? primaryButtonClass : buttonClass}
            disabled={!configured || !paragraphs?.length || state === 'loading'}
            onClick={() => void togglePlayback()}
          >
            {state === 'loading' ? (
              <Loader2 className="animate-spin" size={16} />
            ) : state === 'playing' ? (
              <Pause size={16} />
            ) : (
              <Play size={16} />
            )}
            {label}
          </button>
          <button className={buttonClass} disabled={state === 'idle'} onClick={stop} aria-label="Stop narration">
            <Square size={15} />
          </button>
        </div>
      </div>
      {configured === false && (
        <p className="mt-2 text-xs text-warning">
          Configure a text-to-speech provider in Settings before using narration.
        </p>
      )}
      {error && (
        <p className="mt-2 text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
