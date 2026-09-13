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
  if (!novel) return <div className="empty">{error || 'Loading novel…'}</div>;
  const pages = Math.max(1, Math.ceil(visible.length / 50));
  const chapters = visible.slice((page - 1) * 50, page * 50);
  const continueId = novel.currentChapterId ?? novel.chapters.find((chapter) => chapter.fetched)?.id;
  const sourceUrl = novel.chapters[0]?.canonicalUrl;
  return (
    <>
      <Link className="btn" href="/">
        <ArrowLeft size={16} /> Library
      </Link>
      <section className="hero" style={{ marginTop: 25, alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          <div className="cover" style={{ width: 120, flex: '0 0 120px' }}>
            {novel.coverUrl && <img src={novel.coverUrl} alt="" />}
            <div className="cover-placeholder" style={{ fontSize: 15 }}>
              {novel.displayTitle}
            </div>
          </div>
          <div>
            <div className="eyebrow">{novel.author ?? 'Unknown author'}</div>
            <h1>{novel.displayTitle}</h1>
            <p className="muted">
              {novel.description ??
                `${novel.downloadedCount}/${novel.chapterCount} downloaded · ${novel.translatedCount} translated`}
            </p>
            {sourceUrl && (
              <a className="muted" href={sourceUrl} target="_blank" rel="noreferrer">
                View source: {novel.sourceTitle}
              </a>
            )}
          </div>
        </div>
        <div className="toolbar">
          {continueId && (
            <Link className="btn primary" href={`/read/${continueId}`}>
              <BookOpen size={16} /> Continue
            </Link>
          )}
          <button className="btn" onClick={() => void check()}>
            <RefreshCw size={16} /> Check updates
          </button>
          <button className="btn" onClick={() => setEditing(true)}>
            <Pencil size={16} /> Edit
          </button>
          <button className="btn danger" aria-label="Delete novel" onClick={() => void remove()}>
            <Trash2 size={16} />
          </button>
        </div>
      </section>
      {error && (
        <div className={error.endsWith('queued.') ? 'notice' : 'error'} style={{ marginBottom: 18 }}>
          {error}
        </div>
      )}
      <div className="split">
        <section className="panel">
          <div className="toolbar" style={{ justifyContent: 'space-between' }}>
            <h2>Chapters</h2>
            <input
              className="input"
              style={{ maxWidth: 260 }}
              placeholder="Search chapters"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
            />
            <select
              className="select"
              style={{ maxWidth: 160 }}
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
          <div className="chapter-list" style={{ marginTop: 15 }}>
            {chapters.map((chapter) => (
              <div className="chapter-row" key={chapter.id}>
                <span className="chapter-number">{String(chapter.ordinal).padStart(3, '0')}</span>
                <div>
                  <Link href={`/read/${chapter.id}`}>
                    <strong>{chapter.title}</strong>
                  </Link>
                  <div className="meta">
                    <span>
                      <i className={`status-dot ${chapter.fetched ? 'ready' : ''}`} />{' '}
                      {chapter.fetched ? 'Downloaded' : 'Queued'}
                    </span>
                    <span>
                      <i className={`status-dot ${chapter.translated ? 'ready' : ''}`} />{' '}
                      {chapter.translated ? 'English ready' : 'Chinese only'}
                    </span>
                    <button className="btn" style={{ padding: '3px 7px' }} onClick={() => void mark(chapter)}>
                      {chapter.readAt ? 'Unread' : 'Read'}
                    </button>
                  </div>
                </div>
                {chapter.fetched && !chapter.translated && (
                  <button className="btn" onClick={() => void translate(chapter.id)}>
                    <Languages size={15} /> Translate
                  </button>
                )}
              </div>
            ))}
          </div>
          {pages > 1 && (
            <div className="toolbar" style={{ justifyContent: 'center', marginTop: 16 }}>
              <button className="btn" disabled={page === 1} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <span>
                {page} / {pages}
              </span>
              <button className="btn" disabled={page === pages} onClick={() => setPage(page + 1)}>
                Next
              </button>
            </div>
          )}
        </section>
        <aside className="stack">
          <section className="panel">
            <h2>Automation</h2>
            <div className="toggle">
              <div>
                <strong>Translate ahead</strong>
                <div className="muted">Keep the next unread chapters ready.</div>
              </div>
              <button
                className={`switch ${novel.autoTranslate ? 'on' : ''}`}
                aria-label="Toggle automatic translation"
                onClick={() => void toggle('autoTranslate', !novel.autoTranslate)}
              />
            </div>
            <div className="toggle">
              <div>
                <strong>Check for updates</strong>
                <div className="muted">Poll the source on schedule.</div>
              </div>
              <button
                className={`switch ${novel.autoCheck ? 'on' : ''}`}
                aria-label="Toggle update checks"
                onClick={() => void toggle('autoCheck', !novel.autoCheck)}
              />
            </div>
          </section>
        </aside>
      </div>
      {editing && (
        <div className="dialog-backdrop">
          <div className="dialog">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h2>Edit library details</h2>
              <button className="btn" aria-label="Close" onClick={() => setEditing(false)}>
                <X size={17} />
              </button>
            </div>
            <form className="stack" onSubmit={metadata}>
              <label className="field">
                Custom title
                <input
                  className="input"
                  value={title}
                  placeholder={novel.sourceTitle}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <label className="field">
                Author name (optional)
                <input
                  className="input"
                  maxLength={300}
                  value={author}
                  onChange={(event) => setAuthor(event.target.value)}
                />
              </label>
              <label className="field">
                Description
                <textarea
                  className="textarea"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              <label className="field">
                Cover image
                <input
                  className="input"
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
              <button className="btn primary" type="submit">
                Save details
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
