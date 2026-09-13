'use client';
import { CheckCircle2, Pause, Play, Plus, Save, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

interface Provider {
  baseUrl: string | null;
  model: string | null;
  timeoutSeconds: number;
  chunkCharacters: number;
  automaticPaused: boolean;
  hasApiKey: boolean;
}
interface Source {
  id: string;
  sourceId: string;
  name: string;
  siteUrl: string;
  chapterPathPattern: string;
  indexPathTemplate: string;
  novelIdTemplate: string | null;
  chapterIdTemplate: string | null;
  chapterLinkSelector: string;
  chapterTitleSelector: string;
  chapterTitleExcludeSelector: string | null;
  chapterContentSelector: string;
  chapterContentStartSelector: string | null;
  chapterContentEndSelector: string | null;
  chapterContentEndText: string | null;
  chapterContentExcludeSelector: string | null;
  enabled: boolean;
  requestIntervalMs: number;
  lastError: string | null;
  lastCheckedAt: number | null;
}
type SourceDraft = Omit<Source, 'id' | 'sourceId' | 'enabled' | 'requestIntervalMs' | 'lastError' | 'lastCheckedAt'> & {
  sourceId?: string;
};
interface Health {
  heartbeatAt: number | null;
  healthy: boolean;
}
interface Novel {
  id: string;
  displayTitle: string;
  autoTranslate: boolean;
  autoCheck: boolean;
}
type Tab = 'General' | 'Provider' | 'Sources' | 'Automation' | 'Reader';
function isProvider(value: unknown): value is Provider {
  return !!value && typeof value === 'object' && 'timeoutSeconds' in value && 'automaticPaused' in value;
}
function isSources(value: unknown): value is Source[] {
  return (
    Array.isArray(value) &&
    value.every((item) => !!item && typeof item === 'object' && 'sourceId' in item && 'siteUrl' in item)
  );
}
function isHealth(value: unknown): value is Health {
  return !!value && typeof value === 'object' && 'healthy' in value;
}
function isNovels(value: unknown): value is Novel[] {
  return Array.isArray(value) && value.every((item) => !!item && typeof item === 'object' && 'displayTitle' in item);
}
function apiError(value: unknown, fallback: string) {
  if (!value || typeof value !== 'object' || !('error' in value)) return fallback;
  const error = value.error;
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : fallback;
}

const emptySource: SourceDraft = {
  name: '',
  siteUrl: '',
  chapterPathPattern: '',
  indexPathTemplate: '',
  novelIdTemplate: null,
  chapterIdTemplate: null,
  chapterLinkSelector: '',
  chapterTitleSelector: 'h1',
  chapterTitleExcludeSelector: null,
  chapterContentSelector: 'body',
  chapterContentStartSelector: null,
  chapterContentEndSelector: null,
  chapterContentEndText: null,
  chapterContentExcludeSelector: 'script,style,iframe',
};

function draftFrom(source: Source): SourceDraft {
  return {
    sourceId: source.sourceId,
    name: source.name,
    siteUrl: source.siteUrl,
    chapterPathPattern: source.chapterPathPattern,
    indexPathTemplate: source.indexPathTemplate,
    novelIdTemplate: source.novelIdTemplate,
    chapterIdTemplate: source.chapterIdTemplate,
    chapterLinkSelector: source.chapterLinkSelector,
    chapterTitleSelector: source.chapterTitleSelector,
    chapterTitleExcludeSelector: source.chapterTitleExcludeSelector,
    chapterContentSelector: source.chapterContentSelector,
    chapterContentStartSelector: source.chapterContentStartSelector,
    chapterContentEndSelector: source.chapterContentEndSelector,
    chapterContentEndText: source.chapterContentEndText,
    chapterContentExcludeSelector: source.chapterContentExcludeSelector,
  };
}

const buttonClass =
  'inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border border-line bg-card px-3.5 text-[13px] font-bold text-ink transition-[transform,border-color,background-color,box-shadow] duration-150 enabled:hover:-translate-y-px enabled:hover:border-line-strong enabled:hover:bg-card-hover enabled:hover:shadow-button';
const primaryButtonClass =
  'inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border border-accent bg-accent px-3.5 text-[13px] font-bold text-white shadow-[0_7px_18px_color-mix(in_srgb,var(--color-accent)_22%,transparent)] transition-[transform,border-color,background-color] duration-150 enabled:hover:-translate-y-px enabled:hover:border-accent-hover enabled:hover:bg-accent-hover';
const inputClass =
  'w-full rounded-[10px] border border-line bg-card px-[13px] py-[11px] text-ink outline-none transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-muted/70 hover:border-line-strong focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]';
const panelClass = 'rounded-[15px] border border-line bg-card p-[22px] text-ink shadow-card max-[760px]:p-[17px]';
const fieldClass = 'grid gap-[7px] text-xs font-[720] text-ink';
const switchClass =
  "h-6 w-11 shrink-0 rounded-full border-0 bg-line-strong p-[3px] after:block after:size-[18px] after:rounded-full after:bg-white after:shadow-[0_1px_3px_rgb(0_0_0/25%)] after:transition-transform after:duration-200 after:content-['']";

export function SettingsClient() {
  const [tab, setTab] = useState<Tab>('General');
  const [provider, setProvider] = useState<Provider | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [novels, setNovels] = useState<Novel[]>([]);
  const [apiKey, setApiKey] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [fontSize, setFontSize] = useState(20);
  const [lineHeight, setLineHeight] = useState(1.85);
  const [theme, setTheme] = useState('light');
  const [sourceDraft, setSourceDraft] = useState<SourceDraft | null>(null);
  const [savingSource, setSavingSource] = useState(false);
  const load = useCallback(async () => {
    const responses = await Promise.all([
      fetch('/api/settings/provider', { cache: 'no-store' }),
      fetch('/api/sources', { cache: 'no-store' }),
      fetch('/api/health', { cache: 'no-store' }),
      fetch('/api/novels', { cache: 'no-store' }),
    ]);
    const values: unknown[] = await Promise.all(responses.map((response) => response.json()));
    if (responses[0]?.ok && isProvider(values[0])) setProvider(values[0]);
    if (responses[1]?.ok && isSources(values[1])) setSources(values[1]);
    if (responses[2]?.ok && isHealth(values[2])) setHealth(values[2]);
    if (responses[3]?.ok && isNovels(values[3])) setNovels(values[3]);
  }, []);
  useEffect(() => {
    void load();
    setFontSize(Number(localStorage.getItem('reader-font-size')) || 20);
    setLineHeight(Number(localStorage.getItem('reader-line-height')) || 1.85);
    setTheme(localStorage.getItem('reader-theme') ?? 'light');
  }, [load]);
  async function saveProvider(event: React.FormEvent) {
    event.preventDefault();
    if (!provider) return;
    setError('');
    const response = await fetch('/api/settings/provider', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: provider.baseUrl,
        model: provider.model,
        timeoutSeconds: provider.timeoutSeconds,
        chunkCharacters: provider.chunkCharacters,
        ...(apiKey ? { apiKey } : {}),
      }),
    });
    const value: unknown = await response.json();
    if (response.ok && isProvider(value)) {
      setProvider(value);
      setApiKey('');
      setMessage('Provider settings saved.');
    } else setError('Save failed');
  }
  async function testProvider() {
    const response = await fetch('/api/settings/provider/test', { method: 'POST' });
    setMessage(response.ok ? 'Provider test queued. See Activity for the result.' : '');
    setError(response.ok ? '' : 'Provider test failed');
  }
  async function pause() {
    if (!provider) return;
    const response = await fetch('/api/settings/automation', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused: !provider.automaticPaused }),
    });
    const value: unknown = await response.json();
    if (response.ok && isProvider(value)) setProvider(value);
  }
  async function updateSource(source: Source, changes: { enabled?: boolean; requestIntervalMs?: number }) {
    const response = await fetch(`/api/sources/${source.sourceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    });
    const value: unknown = await response.json();
    const updatedList = [value];
    if (response.ok && isSources(updatedList)) {
      const updated = updatedList[0]!;
      setSources((items) => items.map((item) => (item.sourceId === updated.sourceId ? updated : item)));
    } else setError(apiError(value, 'Source update failed'));
  }
  async function testSource(sourceId: string) {
    const response = await fetch(`/api/sources/${sourceId}/check`, { method: 'POST' });
    setMessage(response.ok ? `${sourceId} test queued.` : '');
    setError(response.ok ? '' : 'Source test failed');
  }
  async function saveSource(event: React.FormEvent) {
    event.preventDefault();
    if (!sourceDraft || savingSource) return;
    setSavingSource(true);
    setError('');
    const id = sourceDraft.sourceId;
    const payload = { ...sourceDraft };
    delete payload.sourceId;
    const response = await fetch(id ? `/api/sources/${id}` : '/api/sources', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const value: unknown = await response.json().catch(() => null);
    if (response.ok) {
      setSourceDraft(null);
      setMessage(id ? 'Source saved.' : 'Source added.');
      await load();
    } else setError(apiError(value, 'Could not save source.'));
    setSavingSource(false);
  }
  async function removeSource(source: Source) {
    if (!window.confirm(`Delete source “${source.name}”?`)) return;
    const response = await fetch(`/api/sources/${source.sourceId}`, { method: 'DELETE' });
    if (response.ok) {
      setMessage('Source deleted.');
      await load();
    } else {
      const value: unknown = await response.json().catch(() => null);
      setError(apiError(value, 'Could not delete source.'));
    }
  }
  async function updateNovel(novel: Novel, changes: { autoTranslate?: boolean; autoCheck?: boolean }) {
    const response = await fetch(`/api/novels/${novel.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    });
    if (response.ok) void load();
    else setError('Novel automation update failed');
  }
  function saveReader() {
    localStorage.setItem('reader-font-size', String(fontSize));
    localStorage.setItem('reader-line-height', String(lineHeight));
    localStorage.setItem('reader-theme', theme);
    setMessage('Reader defaults saved in this browser.');
  }
  function setDraft(key: keyof SourceDraft, value: string) {
    if (!sourceDraft) return;
    setSourceDraft({
      ...sourceDraft,
      [key]:
        value.trim() === '' &&
        key !== 'name' &&
        key !== 'siteUrl' &&
        key !== 'chapterPathPattern' &&
        key !== 'indexPathTemplate' &&
        key !== 'chapterLinkSelector' &&
        key !== 'chapterTitleSelector'
          ? null
          : value,
    });
  }
  if (!provider)
    return (
      <div className="rounded-[15px] border border-dashed border-line-strong bg-card/60 px-6 py-16 text-center text-muted">
        Loading settings…
      </div>
    );
  const tabs: Tab[] = ['General', 'Provider', 'Sources', 'Automation', 'Reader'];
  return (
    <>
      <section className="mb-8 flex items-end justify-between gap-8 max-[760px]:flex-col max-[760px]:items-start max-[760px]:gap-5">
        <div className="max-w-[760px]">
          <div className="mb-2.5 text-[11px] font-extrabold uppercase tracking-[.15em] text-accent-ink">
            Configuration
          </div>
          <h1>Settings</h1>
          <p className="mt-[13px] max-w-[660px] text-muted">
            Credentials stay encrypted at rest and never return to the browser.
          </p>
        </div>
      </section>
      <div className="mb-[22px] flex w-fit max-w-full overflow-x-auto rounded-[11px] border border-line bg-paper-raised p-[3px]">
        {tabs.map((item) => (
          <button
            key={item}
            className={`min-h-[34px] whitespace-nowrap rounded-lg border-0 bg-transparent px-[13px] text-[13px] font-[650] text-muted hover:text-ink ${
              tab === item ? 'bg-card text-ink-strong shadow-[0_1px_4px_rgb(0_0_0/10%)]' : ''
            }`}
            onClick={() => setTab(item)}
          >
            {item}
          </button>
        ))}
      </div>
      {message && (
        <div className="mb-4 rounded-[10px] border border-[color-mix(in_srgb,var(--color-warning)_30%,var(--color-line))] bg-[color-mix(in_srgb,var(--color-warning)_10%,var(--color-card))] px-3.5 py-3 text-warning">
          {message}
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-[10px] border border-[color-mix(in_srgb,var(--color-danger)_35%,var(--color-line))] bg-danger-soft px-3.5 py-3 text-danger">
          {error}
        </div>
      )}
      {tab === 'General' && (
        <section className={panelClass}>
          <h2>Worker</h2>
          <p>
            <i
              className={`mr-1 inline-block size-[7px] rounded-full ${
                health?.healthy
                  ? 'bg-success shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-success)_14%,transparent)]'
                  : 'bg-line-strong'
              }`}
            />{' '}
            {health?.healthy ? 'Healthy' : 'No recent heartbeat'}
          </p>
          <div className="text-muted">
            {health?.heartbeatAt
              ? `Last heartbeat ${new Date(health.heartbeatAt).toLocaleString()}`
              : 'Start the worker process to handle imports and translations.'}
          </div>
        </section>
      )}
      {tab === 'Provider' && (
        <form className={`${panelClass} grid gap-4`} onSubmit={saveProvider}>
          <h2>Translation provider</h2>
          <div className="grid grid-cols-2 gap-3.5 max-[760px]:grid-cols-1">
            <label className={fieldClass}>
              OpenAI-compatible base URL
              <input
                className={inputClass}
                type="url"
                required
                value={provider.baseUrl ?? ''}
                onChange={(event) => setProvider({ ...provider, baseUrl: event.target.value })}
              />
            </label>
            <label className={fieldClass}>
              Model
              <input
                className={inputClass}
                required
                value={provider.model ?? ''}
                onChange={(event) => setProvider({ ...provider, model: event.target.value })}
              />
            </label>
            <label className={fieldClass}>
              API key
              <input
                className={inputClass}
                type="password"
                placeholder={provider.hasApiKey ? 'Stored — enter to replace' : 'Required'}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
              />
            </label>
            <label className={fieldClass}>
              Timeout (seconds)
              <input
                className={inputClass}
                type="number"
                min="30"
                max="600"
                value={provider.timeoutSeconds}
                onChange={(event) => setProvider({ ...provider, timeoutSeconds: Number(event.target.value) })}
              />
            </label>
            <label className={fieldClass}>
              Chunk characters
              <input
                className={inputClass}
                type="number"
                min="500"
                max="15000"
                value={provider.chunkCharacters}
                onChange={(event) => setProvider({ ...provider, chunkCharacters: Number(event.target.value) })}
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-[9px]">
            <button className={primaryButtonClass} type="submit">
              <Save size={16} /> Save provider
            </button>
            <button className={buttonClass} type="button" onClick={() => void testProvider()}>
              <CheckCircle2 size={16} /> Test provider
            </button>
          </div>
        </form>
      )}
      {tab === 'Sources' && (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-[9px]">
            <div>
              <h2>Scraping sources</h2>
              <p className="text-muted">
                Add sites without writing code. URL templates use regex capture groups such as {'{1}'}.
              </p>
            </div>
            <button className={primaryButtonClass} onClick={() => setSourceDraft({ ...emptySource })}>
              <Plus size={16} /> Add source
            </button>
          </div>
          {sourceDraft && (
            <form className={`${panelClass} grid gap-4`} onSubmit={saveSource}>
              <div className="flex flex-wrap items-center justify-between gap-[9px]">
                <h2>{sourceDraft.sourceId ? 'Edit source' : 'New source'}</h2>
                <button className={buttonClass} type="button" onClick={() => setSourceDraft(null)}>
                  <X size={16} /> Close
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3.5 max-[760px]:grid-cols-1">
                <label className={fieldClass}>
                  Name
                  <input
                    className={inputClass}
                    required
                    value={sourceDraft.name}
                    onChange={(e) => setDraft('name', e.target.value)}
                  />
                </label>
                <label className={fieldClass}>
                  Site URL
                  <input
                    className={inputClass}
                    type="url"
                    required
                    placeholder="https://example.com"
                    value={sourceDraft.siteUrl}
                    onChange={(e) => setDraft('siteUrl', e.target.value)}
                  />
                </label>
                <label className={fieldClass}>
                  Chapter URL pattern (regex)
                  <input
                    className={inputClass}
                    required
                    placeholder="^/book/(\\d+)/(\\d+)\\.html$"
                    value={sourceDraft.chapterPathPattern}
                    onChange={(e) => setDraft('chapterPathPattern', e.target.value)}
                  />
                </label>
                <label className={fieldClass}>
                  Index path template
                  <input
                    className={inputClass}
                    required
                    placeholder="/book/{1}/index.html"
                    value={sourceDraft.indexPathTemplate}
                    onChange={(e) => setDraft('indexPathTemplate', e.target.value)}
                  />
                </label>
                <label className={fieldClass}>
                  Novel ID template (optional)
                  <input
                    className={inputClass}
                    placeholder="{1}"
                    value={sourceDraft.novelIdTemplate ?? ''}
                    onChange={(e) => setDraft('novelIdTemplate', e.target.value)}
                  />
                </label>
                <label className={fieldClass}>
                  Chapter ID template (optional)
                  <input
                    className={inputClass}
                    placeholder="{2}"
                    value={sourceDraft.chapterIdTemplate ?? ''}
                    onChange={(e) => setDraft('chapterIdTemplate', e.target.value)}
                  />
                </label>
                <label className={fieldClass}>
                  Directory chapter-link selector
                  <input
                    className={inputClass}
                    required
                    placeholder=".chapter-list a"
                    value={sourceDraft.chapterLinkSelector}
                    onChange={(e) => setDraft('chapterLinkSelector', e.target.value)}
                  />
                </label>
                <label className={fieldClass}>
                  Chapter title selector
                  <input
                    className={inputClass}
                    required
                    placeholder="h1"
                    value={sourceDraft.chapterTitleSelector}
                    onChange={(e) => setDraft('chapterTitleSelector', e.target.value)}
                  />
                </label>
                <label className={fieldClass}>
                  Title exclude selector (optional)
                  <input
                    className={inputClass}
                    placeholder="a,.badge"
                    value={sourceDraft.chapterTitleExcludeSelector ?? ''}
                    onChange={(e) => setDraft('chapterTitleExcludeSelector', e.target.value)}
                  />
                </label>
                <label className={fieldClass}>
                  Content container selector
                  <input
                    className={inputClass}
                    placeholder="#content"
                    value={sourceDraft.chapterContentSelector ?? 'body'}
                    onChange={(e) => setDraft('chapterContentSelector', e.target.value)}
                  />
                </label>
                <label className={fieldClass}>
                  Content start selector (optional)
                  <input
                    className={inputClass}
                    placeholder=".chapter-header"
                    value={sourceDraft.chapterContentStartSelector ?? ''}
                    onChange={(e) => setDraft('chapterContentStartSelector', e.target.value)}
                  />
                </label>
                <label className={fieldClass}>
                  Content end selector (optional)
                  <input
                    className={inputClass}
                    placeholder=".chapter-footer"
                    value={sourceDraft.chapterContentEndSelector ?? ''}
                    onChange={(e) => setDraft('chapterContentEndSelector', e.target.value)}
                  />
                </label>
                <label className={fieldClass}>
                  Content end text (optional)
                  <input
                    className={inputClass}
                    placeholder="Advertisement starts"
                    value={sourceDraft.chapterContentEndText ?? ''}
                    onChange={(e) => setDraft('chapterContentEndText', e.target.value)}
                  />
                </label>
                <label className={fieldClass}>
                  Content exclude selector
                  <input
                    className={inputClass}
                    placeholder="script,style,.ad"
                    value={sourceDraft.chapterContentExcludeSelector ?? ''}
                    onChange={(e) => setDraft('chapterContentExcludeSelector', e.target.value)}
                  />
                </label>
              </div>
              <p className="text-muted">
                Use a content container for normal pages. Use both start and end selectors when the novel text sits
                between page elements instead of inside one container.
              </p>
              <button className={primaryButtonClass} type="submit" disabled={savingSource}>
                <Save size={16} /> {savingSource ? 'Saving…' : 'Save source'}
              </button>
            </form>
          )}
          {sources.map((source) => (
            <section className={panelClass} key={source.sourceId}>
              <div className="flex flex-wrap items-start justify-between gap-[9px]">
                <div>
                  <strong>{source.name}</strong>
                  <div className="text-muted">
                    {source.siteUrl} · {source.sourceId}
                  </div>
                  <div className="text-muted">
                    {source.lastError ??
                      (source.lastCheckedAt
                        ? `Checked ${new Date(source.lastCheckedAt).toLocaleString()}`
                        : 'Not checked yet')}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-[9px]">
                  <button className={buttonClass} onClick={() => setSourceDraft(draftFrom(source))}>
                    Edit
                  </button>
                  <button className={buttonClass} onClick={() => void testSource(source.sourceId)}>
                    Test
                  </button>
                  <button
                    className={buttonClass}
                    aria-label={`Delete ${source.name}`}
                    onClick={() => void removeSource(source)}
                  >
                    <Trash2 size={16} />
                  </button>
                  <button
                    className={`${switchClass} ${source.enabled ? 'bg-success after:translate-x-5' : ''}`}
                    aria-label={`Toggle ${source.name}`}
                    onClick={() => void updateSource(source, { enabled: !source.enabled })}
                  />
                </div>
              </div>
              <label className={`${fieldClass} mt-3.5 max-w-60`}>
                Request interval (ms)
                <input
                  className={inputClass}
                  type="number"
                  min="2000"
                  step="500"
                  value={source.requestIntervalMs}
                  onChange={(event) => void updateSource(source, { requestIntervalMs: Number(event.target.value) })}
                />
              </label>
            </section>
          ))}
        </div>
      )}
      {tab === 'Automation' && (
        <div className="grid gap-4">
          <button className={`${buttonClass} w-fit`} onClick={() => void pause()}>
            {provider.automaticPaused ? (
              <>
                <Play size={16} /> Resume all automatic jobs
              </>
            ) : (
              <>
                <Pause size={16} /> Pause all automatic jobs
              </>
            )}
          </button>
          {novels.map((novel) => (
            <section className={panelClass} key={novel.id}>
              <strong>{novel.displayTitle}</strong>
              <div className="flex items-center justify-between gap-6 border-t border-line py-4">
                <span>Automatic translation</span>
                <button
                  className={`${switchClass} ${novel.autoTranslate ? 'bg-success after:translate-x-5' : ''}`}
                  aria-label={`Toggle translation for ${novel.displayTitle}`}
                  onClick={() => void updateNovel(novel, { autoTranslate: !novel.autoTranslate })}
                />
              </div>
              <div className="flex items-center justify-between gap-6 border-t border-line py-4">
                <span>Automatic update checks</span>
                <button
                  className={`${switchClass} ${novel.autoCheck ? 'bg-success after:translate-x-5' : ''}`}
                  aria-label={`Toggle checks for ${novel.displayTitle}`}
                  onClick={() => void updateNovel(novel, { autoCheck: !novel.autoCheck })}
                />
              </div>
            </section>
          ))}
        </div>
      )}
      {tab === 'Reader' && (
        <section className={`${panelClass} grid gap-4`}>
          <h2>Reader defaults</h2>
          <div className="grid grid-cols-2 gap-3.5 max-[760px]:grid-cols-1">
            <label className={fieldClass}>
              Font size
              <input
                className={inputClass}
                type="number"
                min="16"
                max="28"
                value={fontSize}
                onChange={(event) => setFontSize(Number(event.target.value))}
              />
            </label>
            <label className={fieldClass}>
              Line height
              <select
                className={inputClass}
                value={lineHeight}
                onChange={(event) => setLineHeight(Number(event.target.value))}
              >
                <option value="1.65">Compact</option>
                <option value="1.85">Comfortable</option>
                <option value="2.05">Spacious</option>
              </select>
            </label>
            <label className={fieldClass}>
              Theme
              <select className={inputClass} value={theme} onChange={(event) => setTheme(event.target.value)}>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
          </div>
          <button className={`${primaryButtonClass} w-fit`} onClick={saveReader}>
            <Save size={16} /> Save reader defaults
          </button>
        </section>
      )}
    </>
  );
}
