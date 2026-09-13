'use client';
import Link from 'next/link';
import { ArrowLeft, BookOpen, Languages, Pencil, RefreshCw, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

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
  chapters: Chapter[];
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
function chapterFilter(value: string): 'all' | 'unread' | 'downloaded' | 'translated' {
  return value === 'unread' || value === 'downloaded' || value === 'translated' ? value : 'all';
}

export function NovelClient({ novelId }: { novelId: string }) {
  const router = useRouter();
  const [novel, setNovel] = useState<Novel | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [cover, setCover] = useState<File | null>(null);
  const [removeCover, setRemoveCover] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread' | 'downloaded' | 'translated'>('all');
  const [page, setPage] = useState(1);
  const [author, setAuthor] = useState('');
  const load = useCallback(async () => {
    const response = await fetch(`/api/novels/${novelId}`, { cache: 'no-store' });
    const value: unknown = await response.json();
    if (response.ok && isNovel(value)) {
      setNovel(value);
      setTitle(value.displayTitle === value.sourceTitle ? '' : value.displayTitle);
      setAuthor(value.author ?? '');
      setDescription(value.description ?? '');
    } else setError('Novel unavailable');
  }, [novelId]);
  useEffect(() => {
    void load();
  }, [load]);
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
    if (!confirm('Delete this novel, its chapters, translations, and progress?')) return;
    const response = await fetch(`/api/novels/${novelId}`, { method: 'DELETE' });
    if (response.ok) router.push('/');
    else setError('Delete failed');
  }
  async function check() {
    const response = await fetch(`/api/novels/${novelId}/check`, { method: 'POST' });
    setError(response.ok ? 'Update check queued.' : 'Could not queue update check');
  }
  async function translate(chapterId: string, regenerate = false) {
    const response = await fetch(`/api/chapters/${chapterId}/translation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ regenerate }),
    });
    setError(response.ok ? 'Translation queued.' : 'Could not queue translation');
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
    if (response.ok) void load();
    else setError('Reading status update failed');
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
          <button className={buttonClass} onClick={() => void check()}>
            <RefreshCw size={16} /> Check updates
          </button>
          <button className={buttonClass} onClick={() => setEditing(true)}>
            <Pencil size={16} /> Edit
          </button>
          <button className={`${buttonClass} text-danger`} aria-label="Delete novel" onClick={() => void remove()}>
            <Trash2 size={16} />
          </button>
        </div>
      </section>
      {error && (
        <div
          className={`mb-[18px] rounded-[10px] border px-3.5 py-3 ${
            error.endsWith('queued.')
              ? 'border-[color-mix(in_srgb,var(--color-warning)_30%,var(--color-line))] bg-[color-mix(in_srgb,var(--color-warning)_10%,var(--color-card))] text-warning'
              : 'border-[color-mix(in_srgb,var(--color-danger)_35%,var(--color-line))] bg-danger-soft text-danger'
          }`}
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
            {chapters.map((chapter) => (
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
                    <button className={`${buttonClass} min-h-0 px-[7px] py-[3px]`} onClick={() => void mark(chapter)}>
                      {chapter.readAt ? 'Unread' : 'Read'}
                    </button>
                  </div>
                </div>
                {chapter.fetched && !chapter.translated && (
                  <button className={buttonClass} onClick={() => void translate(chapter.id)}>
                    <Languages size={15} /> Translate
                  </button>
                )}
              </div>
            ))}
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
    </>
  );
}
