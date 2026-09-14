'use client';
import Link from 'next/link';
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Ellipsis,
  ExternalLink,
  Languages,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useJobFeedback, isJobFeedbackActive } from '../lib/use-job-feedback';
import { SelectMenu } from './select-menu';

interface Chapter {
  id: string;
  ordinal: number;
  title: string;
  fetched: boolean;
  translated: boolean;
  readAt: number | null;
  canonicalUrl: string;
}
interface Novel {
  id: string;
  displayTitle: string;
  sourceTitle: string;
  author: string | null;
  description: string | null;
  autoTranslate: boolean;
  autoCheck: boolean;
  chapterCount: number;
  downloadedCount: number;
  translatedCount: number;
  currentChapterId: string | null;
  coverUrl: string | null;
  epubReady: boolean;
  chapters: Chapter[];
}
interface BulkTranslationResult {
  queued: number;
  alreadyActive: number;
  waitingForDownload: number;
  totalUntranslated: number;
  concurrency: number;
}
function isNovel(value: unknown): value is Novel {
  return (
    !!value &&
    typeof value === 'object' &&
    'id' in value &&
    'displayTitle' in value &&
    'epubReady' in value &&
    typeof value.epubReady === 'boolean' &&
    'chapters' in value &&
    Array.isArray(value.chapters)
  );
}
function isBulkTranslationResult(value: unknown): value is BulkTranslationResult {
  return (
    !!value &&
    typeof value === 'object' &&
    'queued' in value &&
    typeof value.queued === 'number' &&
    'alreadyActive' in value &&
    typeof value.alreadyActive === 'number' &&
    'waitingForDownload' in value &&
    typeof value.waitingForDownload === 'number' &&
    'totalUntranslated' in value &&
    typeof value.totalUntranslated === 'number' &&
    'concurrency' in value &&
    typeof value.concurrency === 'number'
  );
}
function apiError(value: unknown, fallback: string): string {
  if (!value || typeof value !== 'object' || !('error' in value)) return fallback;
  const error = value.error;
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : fallback;
}
function chapterFilter(value: string): 'all' | 'unread' | 'downloaded' | 'translated' {
  return value === 'unread' || value === 'downloaded' || value === 'translated' ? value : 'all';
}

export function NovelClient({ novelId }: { novelId: string }) {
  const router = useRouter();
  const [novel, setNovel] = useState<Novel | null>(null);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const [editing, setEditing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [bulkQueueing, setBulkQueueing] = useState(false);
  const [bulkMessage, setBulkMessage] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [cover, setCover] = useState<File | null>(null);
  const [removeCover, setRemoveCover] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread' | 'downloaded' | 'translated'>('all');
  const [page, setPage] = useState(1);
  const [author, setAuthor] = useState('');
  const { actions: jobActions, start: startJob } = useJobFeedback(`novel:${novelId}`);
  const refreshedTranslations = useRef(new Set<string>());
  const actionsMenu = useRef<HTMLDetailsElement | null>(null);
  const load = useCallback(
    async (initial = false, force = false) => {
      if (request.current) {
        if (!force) return;
        request.current.abort();
      }
      const controller = new AbortController();
      request.current = controller;
      try {
        const response = await fetch(`/api/novels/${novelId}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const value: unknown = await response.json();
        if (controller.signal.aborted) return;
        if (response.ok && isNovel(value)) setNovel(value);
        else if (initial) setError('Novel unavailable');
      } catch {
        if (initial && !controller.signal.aborted) setError('Novel unavailable');
      } finally {
        if (request.current === controller) request.current = null;
      }
    },
    [novelId],
  );
  useEffect(() => {
    void load(true);
    const timer = window.setInterval(() => void load(), 3000);
    return () => {
      clearInterval(timer);
      request.current?.abort();
      request.current = null;
    };
  }, [load]);
  useEffect(() => {
    function dismissActions(event: PointerEvent) {
      if (!actionsMenu.current?.contains(event.target as Node)) actionsMenu.current?.removeAttribute('open');
    }
    function dismissActionsWithKeyboard(event: KeyboardEvent) {
      if (event.key === 'Escape') actionsMenu.current?.removeAttribute('open');
    }
    document.addEventListener('pointerdown', dismissActions);
    document.addEventListener('keydown', dismissActionsWithKeyboard);
    return () => {
      document.removeEventListener('pointerdown', dismissActions);
      document.removeEventListener('keydown', dismissActionsWithKeyboard);
    };
  }, []);
  useEffect(() => {
    let shouldRefresh = false;
    for (const [key, action] of Object.entries(jobActions)) {
      if (
        (key.startsWith('translation:') || key.startsWith('fetch:')) &&
        action.state === 'succeeded' &&
        action.jobId &&
        !refreshedTranslations.current.has(action.jobId)
      ) {
        refreshedTranslations.current.add(action.jobId);
        shouldRefresh = true;
      }
    }
    if (shouldRefresh) void load(false, true);
  }, [jobActions, load]);
  async function toggle(field: 'autoTranslate' | 'autoCheck', value: boolean) {
    const response = await fetch(`/api/novels/${novelId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
    });
    const body: unknown = await response.json();
    if (response.ok && isNovel(body)) setNovel(body);
    else setError('Update failed');
  }
  async function metadata(event: React.FormEvent) {
    event.preventDefault();
    const form = new FormData();
    form.set('customTitle', title);
    form.set('useSourceTitle', String(!title.trim()));
    form.set('author', author);
    form.set('description', description);
    form.set('coverAction', removeCover ? 'remove' : cover ? 'replace' : 'keep');
    if (cover) form.set('cover', cover);
    const response = await fetch(`/api/novels/${novelId}/metadata`, { method: 'PUT', body: form });
    const body: unknown = await response.json();
    if (response.ok && isNovel(body)) {
      setNovel(body);
      setAuthor(body.author ?? '');
      setEditing(false);
      setCover(null);
      setRemoveCover(false);
    } else setError('Metadata update failed');
  }
  async function remove() {
    if (deleting) return;
    setDeleting(true);
    const response = await fetch(`/api/novels/${novelId}`, { method: 'DELETE' });
    if (response.ok) router.push('/');
    else {
      setDeleting(false);
      setDeleteConfirmOpen(false);
      setError('Delete failed');
    }
  }
  function check() {
    return startJob('check-updates', `/api/novels/${novelId}/check`);
  }
  async function downloadEpub() {
    setError('');
    setDownloading(true);
    try {
      const response = await fetch(`/api/novels/${novelId}/epub`, { cache: 'no-store' });
      if (!response.ok) {
        let message = 'Could not generate EPUB.';
        try {
          const body: unknown = await response.json();
          if (
            body &&
            typeof body === 'object' &&
            'error' in body &&
            body.error &&
            typeof body.error === 'object' &&
            'message' in body.error &&
            typeof body.error.message === 'string'
          )
            message = body.error.message;
        } catch {
          // The fallback message covers non-JSON failures.
        }
        if (response.status === 409) await load(false, true);
        setError(message);
        return;
      }
      const disposition = response.headers.get('content-disposition') ?? '';
      const match = disposition.match(/(?:^|;)\s*filename="([A-Za-z0-9._-]+)"(?:;|$)/i);
      const filename = match?.[1] ?? 'novel-english.epub';
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError('Could not generate EPUB.');
    } finally {
      setDownloading(false);
    }
  }

  function openMetadata() {
    setTitle(novel?.displayTitle === novel?.sourceTitle ? '' : (novel?.displayTitle ?? ''));
    setAuthor(novel?.author ?? '');
    setDescription(novel?.description ?? '');
    setCover(null);
    setRemoveCover(false);
    setEditing(true);
  }
  function translate(chapterId: string, regenerate = false) {
    return startJob(`translation:${chapterId}`, `/api/chapters/${chapterId}/translation`, { regenerate });
  }
  function retryChapter(chapterId: string) {
    return startJob(`fetch:${chapterId}`, `/api/chapters/${chapterId}/retry`);
  }
  async function translateAll() {
    if (bulkQueueing) return;
    setBulkQueueing(true);
    setBulkMessage('');
    setError('');
    try {
      const response = await fetch(`/api/novels/${novelId}/translations`, { method: 'POST' });
      const value: unknown = await response.json().catch(() => null);
      if (!response.ok || !isBulkTranslationResult(value)) {
        setError(apiError(value, 'Could not queue novel translations.'));
        return;
      }
      if (value.totalUntranslated === 0) {
        setBulkMessage('Every chapter is already translated.');
      } else if (value.queued > 0) {
        const active = value.queued + value.alreadyActive;
        setBulkMessage(
          `Queued ${value.queued} chapter${value.queued === 1 ? '' : 's'} in chapter order. ` +
            `Up to ${value.concurrency} translation${value.concurrency === 1 ? '' : 's'} will run at once` +
            `${active > value.queued ? `; ${value.alreadyActive} were already active` : ''}.` +
            `${value.waitingForDownload > 0 ? ` ${value.waitingForDownload} chapter${value.waitingForDownload === 1 ? ' is' : 's are'} still waiting for source download.` : ''}`,
        );
      } else if (value.alreadyActive > 0) {
        setBulkMessage(
          `All downloaded untranslated chapters are already queued or translating. Up to ${value.concurrency} run at once.` +
            `${value.waitingForDownload > 0 ? ` ${value.waitingForDownload} chapter${value.waitingForDownload === 1 ? ' is' : 's are'} still downloading.` : ''}`,
        );
      } else {
        setBulkMessage(
          `${value.waitingForDownload} untranslated chapter${value.waitingForDownload === 1 ? ' is' : 's are'} still waiting for source download.`,
        );
      }
      await load(false, true);
    } catch {
      setError('Could not queue novel translations.');
    } finally {
      setBulkQueueing(false);
    }
  }
  async function mark(chapter: Chapter) {
    const response = await fetch(`/api/novels/${novelId}/progress`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chapterId: chapter.id,
        mode: 'source',
        scrollRatio: 0,
        completed: chapter.readAt === null,
      }),
    });
    if (response.ok) {
      setNovel((current) =>
        current
          ? {
              ...current,
              chapters: current.chapters.map((item) =>
                item.id === chapter.id ? { ...item, readAt: chapter.readAt === null ? Date.now() : null } : item,
              ),
            }
          : current,
      );
      void load(false, true);
    } else setError('Reading status update failed');
  }
  const visible = useMemo(() => {
    if (!novel) return [];
    const normalized = query.trim().toLocaleLowerCase();
    return novel.chapters.filter(
      (chapter) =>
        (!normalized || chapter.title.toLocaleLowerCase().includes(normalized)) &&
        (filter === 'all' ||
          (filter === 'unread' && chapter.readAt === null) ||
          (filter === 'downloaded' && chapter.fetched) ||
          (filter === 'translated' && chapter.translated)),
    );
  }, [novel, query, filter]);
  if (!novel)
    return (
      <div className="rounded-[15px] border border-dashed border-line-strong bg-card/60 px-6 py-16 text-center text-muted">
        {error || 'Loading novel…'}
      </div>
    );
  const pages = Math.max(1, Math.ceil(visible.length / 50));
  const currentPage = Math.min(page, pages);
  const chapters = visible.slice((currentPage - 1) * 50, currentPage * 50);
  const continueId = novel.currentChapterId ?? novel.chapters.find((chapter) => chapter.fetched)?.id;
  const sourceUrl = novel.chapters[0]?.canonicalUrl;
  const readyToTranslate = novel.chapters.filter((chapter) => chapter.fetched && !chapter.translated).length;
  const unreadCount = novel.chapters.filter((chapter) => chapter.readAt === null).length;
  const resultStart = visible.length === 0 ? 0 : (currentPage - 1) * 50 + 1;
  const resultEnd = Math.min(currentPage * 50, visible.length);
  const checkAction = jobActions['check-updates'];
  const checkActive = isJobFeedbackActive(checkAction);
  const checkLabel =
    checkAction?.state === 'submitting'
      ? 'Queueing…'
      : checkAction?.state === 'queued'
        ? 'Queued'
        : checkAction?.state === 'running'
          ? 'Checking…'
          : checkAction?.state === 'succeeded'
            ? 'Update check complete'
            : 'Check updates';
  const checkDetail = checkAction?.error ?? (checkAction?.state === 'cancelled' ? 'Update check cancelled.' : null);
  const checkDetailIsError =
    checkAction?.state === 'failed' || checkAction?.state === 'cancelled' || checkAction?.state === 'request-error';
  const buttonClass =
    'inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border border-line bg-card px-3.5 text-[13px] font-bold text-ink transition-[transform,border-color,background-color,box-shadow] duration-150 enabled:hover:-translate-y-px enabled:hover:border-line-strong enabled:hover:bg-card-hover enabled:hover:shadow-button';
  const primaryButtonClass =
    'inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border border-accent bg-accent px-3.5 text-[13px] font-bold text-white shadow-[0_7px_18px_color-mix(in_srgb,var(--color-accent)_22%,transparent)] transition-[transform,border-color,background-color] duration-150 enabled:hover:-translate-y-px enabled:hover:border-accent-hover enabled:hover:bg-accent-hover';
  const inputClass =
    'w-full rounded-[10px] border border-line bg-card px-[13px] py-[11px] text-ink outline-none transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-muted/70 hover:border-line-strong focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]';
  const switchClass =
    "h-6 w-11 shrink-0 rounded-full border-0 bg-line-strong p-[3px] after:block after:size-[18px] after:rounded-full after:bg-white after:shadow-[0_1px_3px_rgb(0_0_0/25%)] after:transition-transform after:duration-200 after:content-['']";
  const menuItemClass =
    'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-ink transition-colors hover:bg-card-hover disabled:cursor-not-allowed disabled:opacity-45';
  return (
    <>
      <Link
        className="inline-flex items-center gap-2 text-sm font-bold text-muted transition-colors hover:text-ink"
        href="/"
      >
        <ArrowLeft size={16} /> Library
      </Link>
      <section className="mt-7 mb-8 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-8 max-[800px]:grid-cols-1 max-[800px]:gap-6">
        <div className="flex min-w-0 items-center gap-6 max-[560px]:items-start max-[560px]:gap-4">
          <div className="relative grid aspect-2/3 w-[112px] shrink-0 place-items-center overflow-hidden rounded bg-cover-art text-white shadow-novel after:pointer-events-none after:absolute after:inset-0 after:bg-cover-overlay max-[560px]:w-[84px]">
            {novel.coverUrl && (
              <img
                className="absolute inset-0 z-10 size-full bg-paper-raised object-contain"
                src={novel.coverUrl}
                alt=""
              />
            )}
            <div className="relative z-10 w-3/4 border border-white/40 px-3 py-4 text-center font-serif text-sm leading-tight max-[560px]:text-[11px]">
              {novel.displayTitle}
            </div>
          </div>
          <div className="min-w-0">
            <div className="mb-2 text-[11px] font-extrabold uppercase tracking-[.15em] text-accent-ink">
              {novel.author ?? 'Unknown author'}
            </div>
            <h1>{novel.displayTitle}</h1>
            {novel.description && <p className="mt-3 max-w-[660px] text-muted">{novel.description}</p>}
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
              <span className="inline-flex items-center gap-1.5">
                <Download size={14} />
                {novel.downloadedCount} of {novel.chapterCount} downloaded
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Languages size={14} />
                {novel.translatedCount} translated
              </span>
            </div>
            {sourceUrl && (
              <a
                className="mt-2 inline-flex max-w-full items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
                href={sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                <span className="truncate">{novel.sourceTitle}</span>
                <ExternalLink className="shrink-0" size={13} />
              </a>
            )}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2.5 max-[800px]:justify-start max-[560px]:w-full">
          {continueId && (
            <Link className={`${primaryButtonClass} px-5 max-[560px]:flex-1`} href={`/read/${continueId}`}>
              <BookOpen size={16} /> Continue reading
            </Link>
          )}
          <details className="group relative" ref={actionsMenu}>
            <summary className={`${buttonClass} list-none px-4 [&::-webkit-details-marker]:hidden`}>
              <Ellipsis size={17} />
              More
              <ChevronDown className="transition-transform group-open:rotate-180" size={14} />
            </summary>
            <div className="absolute right-0 z-30 mt-2 w-64 rounded-xl border border-line bg-card p-1.5 shadow-float max-[800px]:right-auto max-[800px]:left-0">
              <button
                className={menuItemClass}
                type="button"
                disabled={bulkQueueing || readyToTranslate === 0}
                title={readyToTranslate === 0 ? 'No downloaded untranslated chapters are ready to queue.' : undefined}
                onClick={() => {
                  actionsMenu.current?.removeAttribute('open');
                  void translateAll();
                }}
              >
                {bulkQueueing ? <Loader2 className="animate-spin" size={16} /> : <Languages size={16} />}
                <span>{bulkQueueing ? 'Queueing translations…' : `Translate remaining (${readyToTranslate})`}</span>
              </button>
              <button
                className={menuItemClass}
                type="button"
                disabled={!novel.epubReady || downloading}
                aria-describedby={!novel.epubReady ? 'epub-availability' : undefined}
                onClick={() => {
                  actionsMenu.current?.removeAttribute('open');
                  void downloadEpub();
                }}
              >
                <Download size={16} />
                <span>{downloading ? 'Generating EPUB…' : 'Download EPUB'}</span>
              </button>
              {!novel.epubReady && (
                <span id="epub-availability" className="sr-only">
                  Available when all chapters have English translations.
                </span>
              )}
              <button
                className={menuItemClass}
                type="button"
                aria-busy={checkActive}
                disabled={checkActive}
                onClick={() => {
                  actionsMenu.current?.removeAttribute('open');
                  void check();
                }}
              >
                {checkActive ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
                <span>{checkLabel}</span>
              </button>
              <button
                className={menuItemClass}
                type="button"
                onClick={() => {
                  actionsMenu.current?.removeAttribute('open');
                  openMetadata();
                }}
              >
                <Pencil size={16} /> Edit details
              </button>
              <div className="my-1 border-t border-line" />
              <button
                className={`${menuItemClass} text-danger hover:bg-danger-soft`}
                type="button"
                onClick={() => {
                  actionsMenu.current?.removeAttribute('open');
                  setDeleteConfirmOpen(true);
                }}
              >
                <Trash2 size={16} /> Delete novel
              </button>
            </div>
          </details>
        </div>
      </section>
      {checkAction && (
        <div
          className={`mb-3 flex items-center gap-2.5 rounded-[10px] border px-3.5 py-3 text-sm ${
            checkDetailIsError ? 'border-danger/35 bg-danger-soft text-danger' : 'border-line bg-card text-ink'
          }`}
          role={checkDetailIsError ? 'alert' : 'status'}
        >
          {checkActive && <Loader2 className="animate-spin" size={15} />}
          {checkDetail ?? checkLabel}
        </div>
      )}
      {bulkMessage && (
        <div
          className="mb-3 rounded-[10px] border border-[color-mix(in_srgb,var(--color-success)_28%,var(--color-line))] bg-[color-mix(in_srgb,var(--color-success)_8%,var(--color-card))] px-3.5 py-3 text-sm text-ink"
          role="status"
        >
          {bulkMessage}
        </div>
      )}
      {error && (
        <div
          className="mb-3 rounded-[10px] border border-[color-mix(in_srgb,var(--color-danger)_35%,var(--color-line))] bg-danger-soft px-3.5 py-3 text-danger"
          role="alert"
        >
          {error}
        </div>
      )}
      <details className="group mb-4 overflow-hidden rounded-[15px] border border-line bg-card text-ink shadow-card">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-5 px-[22px] py-4 [&::-webkit-details-marker]:hidden max-[760px]:px-[17px]">
          <span className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg bg-paper text-muted">
              <Settings2 size={17} />
            </span>
            <span>
              <strong className="block">Automation</strong>
              <span className="text-sm text-muted">
                {Number(novel.autoTranslate) + Number(novel.autoCheck)} of 2 enabled
              </span>
            </span>
          </span>
          <ChevronDown className="shrink-0 text-muted transition-transform group-open:rotate-180" size={17} />
        </summary>
        <div className="grid grid-cols-2 border-t border-line max-[700px]:grid-cols-1">
          <div className="flex items-center justify-between gap-6 border-r border-line px-[22px] py-5 max-[700px]:border-r-0 max-[700px]:border-b max-[760px]:px-[17px]">
            <div>
              <strong>Translate ahead</strong>
              <div className="mt-1 text-sm text-muted">Keep the next unread chapters ready.</div>
            </div>
            <button
              className={`${switchClass} ${novel.autoTranslate ? 'bg-success after:translate-x-5' : ''}`}
              type="button"
              role="switch"
              aria-checked={novel.autoTranslate}
              aria-label="Toggle automatic translation"
              onClick={() => void toggle('autoTranslate', !novel.autoTranslate)}
            />
          </div>
          <div className="flex items-center justify-between gap-6 px-[22px] py-5 max-[760px]:px-[17px]">
            <div>
              <strong>Check for updates</strong>
              <div className="mt-1 text-sm text-muted">Poll the source on schedule.</div>
            </div>
            <button
              className={`${switchClass} ${novel.autoCheck ? 'bg-success after:translate-x-5' : ''}`}
              type="button"
              role="switch"
              aria-checked={novel.autoCheck}
              aria-label="Toggle update checks"
              onClick={() => void toggle('autoCheck', !novel.autoCheck)}
            />
          </div>
        </div>
      </details>
      <section className="overflow-hidden rounded-[15px] border border-line bg-card text-ink shadow-card">
        <header className="p-[22px] max-[760px]:p-[17px]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-baseline gap-2.5">
                <h2>Chapters</h2>
                <span className="text-sm text-muted">{novel.chapterCount}</span>
              </div>
              <p className="mt-1 text-sm text-muted">
                {novel.chapterCount - unreadCount} read · {novel.translatedCount} English ready
              </p>
            </div>
          </div>
          <div className="mt-5 flex gap-2.5 max-[560px]:flex-col">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Search chapters</span>
              <Search className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" size={16} />
              <input
                className={`${inputClass} pl-10`}
                placeholder="Search by chapter title"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
              />
            </label>
            <SelectMenu
              className="min-w-48 max-[560px]:w-full"
              ariaLabel="Filter chapters"
              value={filter}
              options={[
                { value: 'all', label: `All chapters (${novel.chapterCount})` },
                { value: 'unread', label: `Unread (${unreadCount})` },
                { value: 'downloaded', label: `Downloaded (${novel.downloadedCount})` },
                { value: 'translated', label: `English ready (${novel.translatedCount})` },
              ]}
              onChange={(value) => {
                setFilter(chapterFilter(value));
                setPage(1);
              }}
            />
          </div>
        </header>
        <div className="border-t border-line">
          {chapters.length === 0 ? (
            <div className="grid place-items-center px-6 py-14 text-center text-muted">
              <Search className="mb-3 opacity-60" size={22} />
              <strong className="text-ink">No chapters found</strong>
              <span className="mt-1 text-sm">Try a different search or filter.</span>
            </div>
          ) : (
            chapters.map((chapter) => {
              const translationAction = jobActions[`translation:${chapter.id}`];
              const translationActive = isJobFeedbackActive(translationAction);
              const fetchAction = jobActions[`fetch:${chapter.id}`];
              const fetchActive = isJobFeedbackActive(fetchAction);
              const translationLabel =
                translationAction?.state === 'submitting'
                  ? 'Queueing…'
                  : translationAction?.state === 'queued'
                    ? 'Queued'
                    : translationAction?.state === 'running'
                      ? 'Translating…'
                      : translationAction?.state === 'succeeded'
                        ? 'Translation complete'
                        : 'Translate';
              const translationDetail =
                translationAction?.error ??
                (translationAction?.state === 'cancelled' ? 'Translation cancelled.' : null);
              const translationDetailIsError =
                translationAction?.state === 'failed' ||
                translationAction?.state === 'cancelled' ||
                translationAction?.state === 'request-error';
              const chapterStatus = chapter.translated
                ? 'English ready'
                : chapter.fetched
                  ? 'Source ready'
                  : 'Downloading';
              return (
                <article
                  className="group grid grid-cols-[58px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line px-[22px] py-4 last:border-b-0 hover:bg-card-hover max-[640px]:grid-cols-[40px_minmax(0,1fr)_auto] max-[640px]:gap-2 max-[640px]:px-[17px]"
                  key={chapter.id}
                >
                  <span className="text-xs text-muted tabular-nums">{chapter.ordinal}</span>
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Link className="min-w-0 hover:text-accent-ink" href={`/read/${chapter.id}`}>
                        <strong className="line-clamp-2">{chapter.title}</strong>
                      </Link>
                      {chapter.id === novel.currentChapterId && (
                        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent-ink">
                          Current
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 font-semibold ${
                          chapter.translated
                            ? 'bg-success-soft text-success'
                            : chapter.fetched
                              ? 'bg-accent-soft text-accent-ink'
                              : 'bg-paper text-muted'
                        }`}
                      >
                        <span className="size-1.5 rounded-full bg-current" />
                        {chapterStatus}
                      </span>
                      {translationDetail && (
                        <span
                          className={translationDetailIsError ? 'text-danger' : 'text-warning'}
                          role={translationDetailIsError ? 'alert' : 'status'}
                        >
                          {translationDetail}
                        </span>
                      )}
                      {translationAction && !translationDetail && (
                        <span className="sr-only" role="status">
                          {translationLabel}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-1.5">
                    {chapter.fetched && !chapter.translated && (
                      <button
                        className={`${buttonClass} h-9 min-h-0 px-3 disabled:cursor-not-allowed disabled:opacity-60 max-[640px]:w-9 max-[640px]:px-0`}
                        type="button"
                        aria-busy={translationActive}
                        disabled={translationActive || fetchActive || translationAction?.state === 'succeeded'}
                        onClick={() => void translate(chapter.id)}
                      >
                        {translationActive ? <Loader2 className="animate-spin" size={14} /> : <Languages size={14} />}
                        <span className="max-[640px]:sr-only">{translationLabel}</span>
                      </button>
                    )}
                    <button
                      className={`${buttonClass} h-9 min-h-0 px-3 disabled:cursor-not-allowed disabled:opacity-60 max-[640px]:w-9 max-[640px]:px-0`}
                      type="button"
                      aria-label={`Retry download for chapter ${chapter.ordinal}`}
                      aria-busy={fetchActive}
                      disabled={fetchActive}
                      title="Fetch this chapter again from the source"
                      onClick={() => void retryChapter(chapter.id)}
                    >
                      {fetchActive ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
                      <span className="max-[640px]:sr-only">{fetchActive ? 'Downloading…' : 'Retry download'}</span>
                    </button>
                    <button
                      className={`grid size-9 place-items-center rounded-lg transition-colors hover:bg-paper ${
                        chapter.readAt ? 'bg-success-soft text-success' : 'text-muted hover:text-ink'
                      }`}
                      title={chapter.readAt ? 'Mark as unread' : 'Mark as read'}
                      aria-label={chapter.readAt ? 'Mark chapter as unread' : 'Mark chapter as read'}
                      aria-pressed={chapter.readAt !== null}
                      type="button"
                      onClick={() => void mark(chapter)}
                    >
                      {chapter.readAt ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </div>
        <footer className="flex min-h-14 items-center justify-between gap-4 border-t border-line px-[22px] text-sm text-muted max-[760px]:px-[17px]">
          <span>
            Showing {resultStart}–{resultEnd} of {visible.length}
          </span>
          {pages > 1 && (
            <div className="flex items-center gap-2">
              <span className="mr-1 tabular-nums">
                {currentPage} / {pages}
              </span>
              <button
                className={`${buttonClass} size-9 min-h-0 p-0`}
                type="button"
                aria-label="Previous chapter page"
                disabled={currentPage === 1}
                onClick={() => setPage(currentPage - 1)}
              >
                <ChevronLeft size={16} />
              </button>
              <button
                className={`${buttonClass} size-9 min-h-0 p-0`}
                type="button"
                aria-label="Next chapter page"
                disabled={currentPage === pages}
                onClick={() => setPage(currentPage + 1)}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </footer>
      </section>
      {editing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-overlay p-5 backdrop-blur-lg">
          <div className="max-h-[90vh] w-[min(560px,100%)] overflow-auto rounded-2xl border border-line bg-card p-6 text-ink shadow-float">
            <div className="mb-5 flex justify-between">
              <h2>Edit library details</h2>
              <button className={buttonClass} aria-label="Close" onClick={() => setEditing(false)}>
                <X size={17} />
              </button>
            </div>
            <form className="grid gap-4" onSubmit={metadata}>
              <label className="grid gap-[7px] text-xs font-[720] text-ink">
                Custom title
                <input
                  className={inputClass}
                  value={title}
                  placeholder={novel.sourceTitle}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <label className="grid gap-[7px] text-xs font-[720] text-ink">
                Author name (optional)
                <input
                  className={inputClass}
                  maxLength={300}
                  value={author}
                  onChange={(event) => setAuthor(event.target.value)}
                />
              </label>
              <label className="grid gap-[7px] text-xs font-[720] text-ink">
                Description
                <textarea
                  className={`${inputClass} min-h-30 resize-y`}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              <label className="grid gap-[7px] text-xs font-[720] text-ink">
                Cover image
                <input
                  className={inputClass}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => setCover(event.target.files?.[0] ?? null)}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={removeCover}
                  onChange={(event) => setRemoveCover(event.target.checked)}
                />{' '}
                Remove current cover
              </label>
              <button className={primaryButtonClass} type="submit">
                Save details
              </button>
            </form>
          </div>
        </div>
      )}
      {deleteConfirmOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-overlay p-5 backdrop-blur-lg">
          <div
            className="w-[min(460px,100%)] rounded-2xl border border-line bg-card p-6 text-ink shadow-float"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-novel-title"
            aria-describedby="delete-novel-description"
          >
            <h2 id="delete-novel-title">Delete this novel?</h2>
            <p id="delete-novel-description" className="mt-2.5 text-muted">
              This permanently deletes the novel, its chapters, translations, reading progress, and cover image.
            </p>
            <div className="mt-6 flex justify-end gap-2.5">
              <button
                className={buttonClass}
                type="button"
                disabled={deleting}
                onClick={() => setDeleteConfirmOpen(false)}
              >
                Cancel
              </button>
              <button
                className={`${buttonClass} border-danger bg-danger text-white hover:border-danger hover:bg-danger`}
                type="button"
                disabled={deleting}
                onClick={() => void remove()}
              >
                {deleting ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />}
                {deleting ? 'Deleting…' : 'Delete novel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
