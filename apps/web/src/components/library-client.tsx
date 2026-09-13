'use client';
import Link from 'next/link';
import { BookPlus, Search, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';

interface Novel {
  id: string;
  displayTitle: string;
  sourceTitle: string;
  author: string | null;
  sourceId: string;
  chapterCount: number;
  downloadedCount: number;
  translatedCount: number;
  currentChapterId: string | null;
  coverUrl: string | null;
  updatedAt: number;
}
function isNovel(value: unknown): value is Novel {
  return !!value && typeof value === 'object' && 'id' in value && 'displayTitle' in value && 'chapterCount' in value;
}

export function LibraryClient() {
  const [novels, setNovels] = useState<Novel[]>([]);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [includeStart, setIncludeStart] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [chapterNumber, setChapterNumber] = useState('');
  const [pending, setPending] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch(`/api/novels?search=${encodeURIComponent(search)}`, { cache: 'no-store' });
    const value: unknown = await response.json();
    if (response.ok && Array.isArray(value) && value.every(isNovel)) setNovels(value);
  }, [search]);
  useEffect(() => {
    void load();
  }, [load]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setError('');
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    const number = Number(chapterNumber);
    if (!trimmedTitle || trimmedTitle.length > 300) {
      setError('Enter a novel title of 1–300 characters.');
      return;
    }
    if (trimmedDescription.length > 10000) {
      setError('Description must be 10,000 characters or fewer.');
      return;
    }
    if (!chapterNumber.trim() || !Number.isSafeInteger(number) || number < 1) {
      setError('Enter a positive whole chapter number no greater than 9,007,199,254,740,991.');
      return;
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      setError('Enter a valid chapter URL.');
      return;
    }
    if (parsed.protocol !== 'https:') {
      setError('Configured sources must use HTTPS chapter URLs.');
      return;
    }
    setPending(true);
    try {
      const response = await fetch('/api/imports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          includeStart,
          title: trimmedTitle,
          description: trimmedDescription || null,
          chapterNumber: number,
        }),
      });
      if (!response.ok) {
        const value: unknown = await response.json().catch(() => null);
        const apiError = value && typeof value === 'object' && 'error' in value ? value.error : null;
        setError(
          apiError && typeof apiError === 'object' && 'message' in apiError && typeof apiError.message === 'string'
            ? apiError.message
            : 'Import request was rejected. Please try again.',
        );
        return;
      }
      setMessage('Import queued. Chapters will appear as the worker downloads them.');
      setOpen(false);
      setUrl('');
      setTitle('');
      setDescription('');
      setChapterNumber('');
      setIncludeStart(true);
      window.setTimeout(() => void load(), 1500);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <section className="mb-8 flex items-end justify-between gap-8 max-[760px]:flex-col max-[760px]:items-start max-[760px]:gap-5">
        <div className="max-w-[760px]">
          <div className="mb-2.5 text-[11px] font-extrabold uppercase tracking-[.15em] text-accent-ink">
            Your private shelf
          </div>
          <h1>Stories, gathered and translated.</h1>
          <p className="mt-[13px] max-w-[660px] text-muted">
            Import a Chinese chapter URL from any configured source, keep your place, and switch cleanly between English
            and 中文.
          </p>
        </div>
        <button
          className="inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border border-accent bg-accent px-3.5 text-[13px] font-bold text-white shadow-[0_7px_18px_color-mix(in_srgb,var(--color-accent)_22%,transparent)] transition-[transform,border-color,background-color] duration-150 enabled:hover:-translate-y-px enabled:hover:border-accent-hover enabled:hover:bg-accent-hover"
          onClick={() => setOpen(true)}
        >
          <BookPlus size={17} /> Add novel
        </button>
      </section>
      <div className="mb-[22px] flex flex-wrap items-center gap-[9px]">
        <label className="relative w-full max-w-[380px]">
          <Search size={17} className="absolute top-3 left-3 text-muted" />
          <input
            className="w-full rounded-[10px] border border-line bg-card py-[11px] pr-[13px] pl-[38px] text-ink outline-none transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-muted/70 hover:border-line-strong focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]"
            placeholder="Search title or author"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>
      {message && (
        <p className="rounded-[10px] border border-[color-mix(in_srgb,var(--color-warning)_30%,var(--color-line))] bg-[color-mix(in_srgb,var(--color-warning)_10%,var(--color-card))] mb-4 px-3.5 py-3 text-warning">
          {message}
        </p>
      )}
      {novels.length === 0 ? (
        <div className="rounded-[15px] border border-dashed border-line-strong bg-card/60 px-6 py-16 text-center text-muted [&_h2]:mb-2">
          <h2>No books on this shelf</h2>
          <p>Import a chapter URL to create your first library entry.</p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-[18px] max-[760px]:grid-cols-[repeat(auto-fill,minmax(165px,1fr))] max-[760px]:gap-[13px]">
          {novels.map((novel) => (
            <Link
              className="group flex flex-col overflow-hidden rounded-[15px] border border-line bg-card text-ink shadow-card transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-[3px] hover:border-line-strong hover:shadow-novel"
              href={`/novels/${novel.id}`}
              key={novel.id}
            >
              <div className="relative grid aspect-2/3 place-items-center overflow-hidden bg-cover-art text-white after:pointer-events-none after:absolute after:inset-0 after:bg-cover-overlay">
                {novel.coverUrl && (
                  <Image
                    className="absolute inset-0 z-10 size-full bg-paper-raised object-contain"
                    src={novel.coverUrl}
                    alt=""
                  />
                )}
                <div className="relative z-10 w-3/4 border border-white/40 px-4 py-5 text-center font-serif text-xl leading-tight">
                  {novel.displayTitle}
                </div>
              </div>
              <div className="flex-1 p-[17px] max-[760px]:p-3.5">
                <h3 className="mb-[7px]">{novel.displayTitle}</h3>
                <div className="text-muted">{novel.author ?? 'Unknown author'}</div>
                <div className="mt-3.5 flex flex-wrap gap-[7px] text-[11px] text-muted">
                  <span className="rounded-full border border-line bg-paper-raised px-2 py-1 max-[760px]:text-[10px]">
                    {novel.downloadedCount}/{novel.chapterCount} downloaded
                  </span>
                  <span className="rounded-full border border-line bg-paper-raised px-2 py-1 max-[760px]:text-[10px]">
                    {novel.translatedCount} translated
                  </span>
                  {novel.currentChapterId && (
                    <span className="rounded-full border border-line bg-paper-raised px-2 py-1 max-[760px]:text-[10px]">
                      Continue reading
                    </span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-overlay p-5 backdrop-blur-lg" role="presentation">
          <div
            className="max-h-[90vh] w-[min(560px,100%)] overflow-auto rounded-2xl border border-line bg-card p-6 text-ink shadow-float"
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-title"
          >
            <div className="mb-5 flex justify-between">
              <h2 id="import-title">Import a novel</h2>
              <button
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[10px] border border-line bg-card px-3.5 text-[13px] font-bold text-ink transition duration-150 enabled:hover:-translate-y-px enabled:hover:border-line-strong enabled:hover:bg-card-hover enabled:hover:shadow-button"
                aria-label="Close"
                disabled={pending}
                onClick={() => setOpen(false)}
              >
                <X size={17} />
              </button>
            </div>
            <form className="grid gap-4" onSubmit={submit} aria-busy={pending}>
              <p className="text-muted" id="import-metadata-help">
                Enter the novel title and optional description yourself. Neither is scraped from the source.
              </p>
              <label className="grid gap-[7px] text-xs font-[720] text-ink">
                Novel title
                <input
                  className="w-full rounded-[10px] border border-line bg-card px-[13px] py-[11px] text-ink outline-none transition duration-150 hover:border-line-strong focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]"
                  required
                  maxLength={300}
                  value={title}
                  disabled={pending}
                  aria-describedby="import-metadata-help"
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <label className="grid gap-[7px] text-xs font-[720] text-ink">
                Description (optional)
                <textarea
                  className="min-h-30 w-full resize-y rounded-[10px] border border-line bg-card px-[13px] py-[11px] text-ink outline-none transition duration-150 hover:border-line-strong focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]"
                  maxLength={10000}
                  rows={4}
                  value={description}
                  disabled={pending}
                  aria-describedby="import-metadata-help"
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              <label className="grid gap-[7px] text-xs font-[720] text-ink">
                Chinese chapter URL
                <input
                  className="w-full rounded-[10px] border border-line bg-card px-[13px] py-[11px] text-ink outline-none transition duration-150 placeholder:text-muted/70 hover:border-line-strong focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]"
                  type="url"
                  required
                  placeholder="https://example.com/novel/chapter.html"
                  value={url}
                  disabled={pending}
                  onChange={(event) => setUrl(event.target.value)}
                />
              </label>
              <label className="grid gap-[7px] text-xs font-[720] text-ink">
                Chapter number
                <input
                  className="w-full rounded-[10px] border border-line bg-card px-[13px] py-[11px] text-ink outline-none transition duration-150 hover:border-line-strong focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]"
                  type="number"
                  required
                  min={1}
                  max={Number.MAX_SAFE_INTEGER}
                  step={1}
                  value={chapterNumber}
                  disabled={pending}
                  aria-describedby="import-number-help"
                  onChange={(event) => setChapterNumber(event.target.value)}
                />
              </label>
              <p className="text-muted" id="import-number-help">
                This is the number of the chapter at the supplied URL (N). The next chapter is N+1. If you exclude the
                submitted chapter, importing starts at N+1.
              </p>
              <label className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={includeStart}
                  disabled={pending}
                  onChange={(event) => setIncludeStart(event.target.checked)}
                />
                Include the submitted chapter
              </label>
              {error && (
                <div
                  className="rounded-[10px] border border-[color-mix(in_srgb,var(--color-danger)_35%,var(--color-line))] bg-danger-soft px-3.5 py-3 text-danger"
                  role="alert"
                >
                  {error}
                </div>
              )}
              <button
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-[10px] border border-accent bg-accent px-3.5 text-[13px] font-bold text-white shadow-[0_7px_18px_color-mix(in_srgb,var(--color-accent)_22%,transparent)] transition duration-150 enabled:hover:-translate-y-px enabled:hover:border-accent-hover enabled:hover:bg-accent-hover"
                type="submit"
                disabled={pending}
              >
                {pending ? 'Queueing import…' : 'Queue import'}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
