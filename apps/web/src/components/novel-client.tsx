'use client';
import Link from 'next/link';
import {
  ArrowLeft,
  BookOpen,
  Check,
  Download,
  Languages,
  Loader2,
  Pencil,
  RefreshCw,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useJobFeedback, isJobFeedbackActive } from '../lib/use-job-feedback';

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
    let shouldRefresh = false;
    for (const [key, action] of Object.entries(jobActions)) {
      if (
        key.startsWith('translation:') &&
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
  const chapters = visible.slice((page - 1) * 50, page * 50);
  const continueId = novel.currentChapterId ?? novel.chapters.find((chapter) => chapter.fetched)?.id;
  const sourceUrl = novel.chapters[0]?.canonicalUrl;
  const readyToTranslate = novel.chapters.filter((chapter) => chapter.fetched && !chapter.translated).length;
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
  return (
    <>
      <Link className={buttonClass} href="/">
        <ArrowLeft size={16} /> Library
      </Link>
      <section className="mt-[25px] mb-8 flex items-center justify-between gap-8 max-[760px]:flex-col max-[760px]:items-start max-[760px]:gap-5">
        <div className="flex max-w-[760px] items-center gap-6">
          <div className="relative grid aspect-2/3 w-[120px] shrink-0 place-items-center overflow-hidden bg-cover-art text-white after:pointer-events-none after:absolute after:inset-0 after:bg-cover-overlay">
            {novel.coverUrl && (
              <img
                className="absolute inset-0 z-10 size-full bg-paper-raised object-contain"
                src={novel.coverUrl}
                alt=""
              />
            )}
            <div className="relative z-10 w-3/4 border border-white/40 px-4 py-5 text-center font-serif text-[15px] leading-tight">
              {novel.displayTitle}
            </div>
          </div>
          <div>
            <div className="mb-2.5 text-[11px] font-extrabold uppercase tracking-[.15em] text-accent-ink">
              {novel.author ?? 'Unknown author'}
            </div>
            <h1>{novel.displayTitle}</h1>
            <p className="mt-[13px] max-w-[660px] text-muted">
              {novel.description ??
                `${novel.downloadedCount}/${novel.chapterCount} downloaded · ${novel.translatedCount} translated`}
            </p>
            {sourceUrl && (
              <a className="text-muted" href={sourceUrl} target="_blank" rel="noreferrer">
                View source: {novel.sourceTitle}
              </a>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-[9px]">
          {continueId && (
            <Link className={primaryButtonClass} href={`/read/${continueId}`}>
              <BookOpen size={16} /> Continue
            </Link>
          )}
          <button
            className={`${buttonClass} disabled:cursor-not-allowed disabled:opacity-50`}
            disabled={bulkQueueing || readyToTranslate === 0}
            title={readyToTranslate === 0 ? 'No downloaded untranslated chapters are ready to queue.' : undefined}
            onClick={() => void translateAll()}
          >
            {bulkQueueing ? <Loader2 className="animate-spin" size={16} /> : <Languages size={16} />}
            {bulkQueueing ? 'Queueing…' : `Translate all${readyToTranslate > 0 ? ` (${readyToTranslate})` : ''}`}
          </button>
          <button
            className={`${buttonClass} disabled:cursor-not-allowed disabled:opacity-50`}
            disabled={!novel.epubReady || downloading}
            aria-describedby={!novel.epubReady ? 'epub-availability' : undefined}
            onClick={() => void downloadEpub()}
          >
            <Download size={16} /> {downloading ? 'Generating EPUB…' : 'Download EPUB'}
          </button>
          {!novel.epubReady && (
            <span id="epub-availability" className="sr-only">
              Available when all chapters have English translations.
            </span>
          )}
          <div className="flex flex-col items-start gap-1">
            <button
              className={`${buttonClass} disabled:cursor-not-allowed disabled:opacity-60`}
              aria-busy={checkActive}
              disabled={checkActive}
              onClick={() => void check()}
            >
              {checkActive ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
              {checkLabel}
            </button>
            {checkAction && !checkDetail && (
              <span className="sr-only" role="status">
                {checkLabel}
              </span>
            )}
            {checkDetail && (
              <span
                className={`max-w-64 text-xs ${checkDetailIsError ? 'text-danger' : 'text-warning'}`}
                role={checkDetailIsError ? 'alert' : 'status'}
              >
                {checkDetail}
              </span>
            )}
          </div>
          <button className={buttonClass} onClick={openMetadata}>
            <Pencil size={16} /> Edit
          </button>
          <button
            className={`${buttonClass} text-danger`}
            aria-label="Delete novel"
            onClick={() => setDeleteConfirmOpen(true)}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </section>
      {bulkMessage && (
        <div
          className="mb-[18px] rounded-[10px] border border-[color-mix(in_srgb,var(--color-success)_28%,var(--color-line))] bg-[color-mix(in_srgb,var(--color-success)_8%,var(--color-card))] px-3.5 py-3 text-sm text-ink"
          role="status"
        >
          {bulkMessage}
        </div>
      )}
      {error && (
        <div
          className="mb-[18px] rounded-[10px] border border-[color-mix(in_srgb,var(--color-danger)_35%,var(--color-line))] bg-danger-soft px-3.5 py-3 text-danger"
          role="alert"
        >
          {error}
        </div>
      )}
      <div className="grid grid-cols-[minmax(0,1.65fr)_minmax(260px,.65fr)] items-start gap-5 max-[960px]:grid-cols-1">
        <section className="rounded-[15px] border border-line bg-card p-[22px] text-ink shadow-card max-[760px]:p-[17px]">
          <div className="flex flex-wrap items-center justify-between gap-[9px]">
            <h2>Chapters</h2>
            <input
              className={`${inputClass} max-w-[260px]`}
              placeholder="Search chapters"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
            />
            <select
              className={`${inputClass} max-w-40`}
              value={filter}
              onChange={(event) => {
                setFilter(chapterFilter(event.target.value));
                setPage(1);
              }}
            >
              <option value="all">All</option>
              <option value="unread">Unread</option>
              <option value="downloaded">Downloaded</option>
              <option value="translated">Translated</option>
            </select>
          </div>
          <div className="mt-[15px] grid border-t border-line">
            {chapters.map((chapter) => {
              const translationAction = jobActions[`translation:${chapter.id}`];
              const translationActive = isJobFeedbackActive(translationAction);
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
              return (
                <div
                  className="grid grid-cols-[64px_1fr_auto] items-center gap-3.5 rounded-lg border-b border-line px-2.5 py-[15px] hover:bg-card-hover max-[760px]:grid-cols-[42px_1fr] max-[760px]:px-1 [&>button]:max-[760px]:col-start-2"
                  key={chapter.id}
                >
                  <span className="text-xs text-muted tabular-nums">{String(chapter.ordinal).padStart(3, '0')}</span>
                  <div>
                    <Link href={`/read/${chapter.id}`}>
                      <strong>{chapter.title}</strong>
                    </Link>
                    <div className="mt-3.5 flex flex-wrap gap-[7px] text-[11px] text-muted">
                      <span>
                        <i
                          className={`mr-1 inline-block size-[7px] rounded-full ${
                            chapter.fetched
                              ? 'bg-success shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-success)_14%,transparent)]'
                              : 'bg-line-strong'
                          }`}
                        />
                        {chapter.fetched ? 'Downloaded' : 'Queued'}
                      </span>
                      <span>
                        <i
                          className={`mr-1 inline-block size-[7px] rounded-full ${
                            chapter.translated
                              ? 'bg-success shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-success)_14%,transparent)]'
                              : 'bg-line-strong'
                          }`}
                        />
                        {chapter.translated ? 'English ready' : 'Chinese only'}
                      </span>
                    </div>
                    {translationAction && !translationDetail && (
                      <span className="sr-only" role="status">
                        {translationLabel}
                      </span>
                    )}
                    {translationDetail && (
                      <div
                        className={`mt-2 text-xs ${translationDetailIsError ? 'text-danger' : 'text-warning'}`}
                        role={translationDetailIsError ? 'alert' : 'status'}
                      >
                        {translationDetail}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2 max-[760px]:col-start-2 max-[760px]:items-start">
                    {chapter.fetched && !chapter.translated && (
                      <button
                        className={`${buttonClass} disabled:cursor-not-allowed disabled:opacity-60`}
                        aria-busy={translationActive}
                        disabled={translationActive || translationAction?.state === 'succeeded'}
                        onClick={() => void translate(chapter.id)}
                      >
                        {translationActive ? <Loader2 className="animate-spin" size={15} /> : <Languages size={15} />}
                        {translationLabel}
                      </button>
                    )}
                    <button
                      className={`${buttonClass} h-10 min-h-0 w-10 p-0 ${chapter.readAt ? 'text-success' : 'text-muted'}`}
                      title={chapter.readAt ? 'Mark as unread' : 'Mark as read'}
                      aria-label={chapter.readAt ? 'Mark chapter as unread' : 'Mark chapter as read'}
                      aria-pressed={chapter.readAt !== null}
                      type="button"
                      onClick={() => void mark(chapter)}
                    >
                      {chapter.readAt ? <Check size={24} strokeWidth={2.75} /> : <Square size={24} strokeWidth={2} />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          {pages > 1 && (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-[9px]">
              <button className={buttonClass} disabled={page === 1} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <span>
                {page} / {pages}
              </span>
              <button className={buttonClass} disabled={page === pages} onClick={() => setPage(page + 1)}>
                Next
              </button>
            </div>
          )}
        </section>
        <aside className="grid gap-4">
          <section className="rounded-[15px] border border-line bg-card p-[22px] text-ink shadow-card max-[760px]:p-[17px]">
            <h2>Automation</h2>
            <div className="flex items-center justify-between gap-6 border-t border-line py-4">
              <div>
                <strong>Translate ahead</strong>
                <div className="text-muted">Keep the next unread chapters ready.</div>
              </div>
              <button
                className={`${switchClass} ${novel.autoTranslate ? 'bg-success after:translate-x-5' : ''}`}
                aria-label="Toggle automatic translation"
                onClick={() => void toggle('autoTranslate', !novel.autoTranslate)}
              />
            </div>
            <div className="flex items-center justify-between gap-6 border-t border-line py-4">
              <div>
                <strong>Check for updates</strong>
                <div className="text-muted">Poll the source on schedule.</div>
              </div>
              <button
                className={`${switchClass} ${novel.autoCheck ? 'bg-success after:translate-x-5' : ''}`}
                aria-label="Toggle update checks"
                onClick={() => void toggle('autoCheck', !novel.autoCheck)}
              />
            </div>
          </section>
        </aside>
      </div>
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
