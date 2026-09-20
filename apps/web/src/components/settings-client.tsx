'use client';
import { CheckCircle2, Link, Loader2, Pause, Play, Save } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useJobFeedback, isJobFeedbackActive } from '../lib/use-job-feedback';
import { SelectMenu } from './select-menu';

interface Provider {
  baseUrl: string | null;
  model: string | null;
  timeoutSeconds: number;
  chunkCharacters: number;
  translationConcurrency: number;
  automaticPaused: boolean;
  hasApiKey: boolean;
}
interface Source {
  id: string;
  sourceId: string;
  name: string;
  siteUrl: string;
  version: string;
  enabled: boolean;
  requestIntervalMs: number;
  downloadConcurrency: number;
  lastError: string | null;
  lastCheckedAt: number | null;
}
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
  return (
    !!value &&
    typeof value === 'object' &&
    'timeoutSeconds' in value &&
    'translationConcurrency' in value &&
    'automaticPaused' in value
  );
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
const readerLineHeightOptions = [
  { value: '1.65', label: 'Compact' },
  { value: '1.85', label: 'Comfortable' },
  { value: '2.05', label: 'Spacious' },
] as const;
export function SettingsClient({ tab }: { tab: Tab }) {
  const [provider, setProvider] = useState<Provider | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [novels, setNovels] = useState<Novel[]>([]);
  const [apiKey, setApiKey] = useState('');
  const [chunkCharacters, setChunkCharacters] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [fontSize, setFontSize] = useState(20);
  const [lineHeight, setLineHeight] = useState(1.85);
  const { actions: jobActions, start: startJob } = useJobFeedback('settings');
  const refreshedSourceTests = useRef(new Set<string>());
  const loadSources = useCallback(async () => {
    const response = await fetch('/api/sources', { cache: 'no-store' });
    const value: unknown = await response.json();
    if (response.ok && isSources(value)) setSources(value);
  }, []);
  const load = useCallback(async () => {
    const sourcesRequest = loadSources();
    const responses = await Promise.all([
      fetch('/api/settings/provider', { cache: 'no-store' }),
      fetch('/api/health', { cache: 'no-store' }),
      fetch('/api/novels', { cache: 'no-store' }),
    ]);
    const values: unknown[] = await Promise.all(responses.map((response) => response.json()));
    if (responses[0]?.ok && isProvider(values[0])) {
      setProvider(values[0]);
      setChunkCharacters(String(values[0].chunkCharacters));
    }
    if (responses[1]?.ok && isHealth(values[1])) setHealth(values[1]);
    if (responses[2]?.ok && isNovels(values[2])) setNovels(values[2]);
    await sourcesRequest;
  }, [loadSources]);
  useEffect(() => {
    void load();
    setFontSize(Number(localStorage.getItem('reader-font-size')) || 20);
    setLineHeight(Number(localStorage.getItem('reader-line-height')) || 1.85);
  }, [load]);
  useEffect(() => {
    let shouldRefresh = false;
    for (const [key, action] of Object.entries(jobActions)) {
      if (
        key.startsWith('source-test:') &&
        (action.state === 'succeeded' || action.state === 'failed' || action.state === 'cancelled') &&
        action.jobId &&
        !refreshedSourceTests.current.has(action.jobId)
      ) {
        refreshedSourceTests.current.add(action.jobId);
        shouldRefresh = true;
      }
    }
    if (shouldRefresh) void loadSources();
  }, [jobActions, loadSources]);
  async function saveProvider(event: React.FormEvent) {
    event.preventDefault();
    if (!provider) return;
    setError('');
    const chunkSize = Number(chunkCharacters);
    if (!/^[0-9]+$/.test(chunkCharacters) || !Number.isSafeInteger(chunkSize) || chunkSize < 500 || chunkSize > 15000) {
      setError('Chunk characters must be a whole number between 500 and 15,000.');
      return;
    }
    if (
      !Number.isSafeInteger(provider.translationConcurrency) ||
      provider.translationConcurrency < 1 ||
      provider.translationConcurrency > 20
    ) {
      setError('Parallel translations must be a whole number between 1 and 20.');
      return;
    }
    const response = await fetch('/api/settings/provider', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: provider.baseUrl,
        model: provider.model,
        timeoutSeconds: provider.timeoutSeconds,
        chunkCharacters: chunkSize,
        translationConcurrency: provider.translationConcurrency,
        ...(apiKey ? { apiKey } : {}),
      }),
    });
    const value: unknown = await response.json();
    if (response.ok && isProvider(value)) {
      setProvider(value);
      setChunkCharacters(String(value.chunkCharacters));
      setApiKey('');
      setMessage('Provider settings saved. Parallel translation changes apply to the running worker automatically.');
    } else setError(apiError(value, 'Save failed'));
  }
  function testProvider() {
    return startJob('provider-test', '/api/settings/provider/test');
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
  async function updateSource(
    source: Source,
    changes: { enabled?: boolean; requestIntervalMs?: number; downloadConcurrency?: number },
  ) {
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
  function testSource(sourceId: string) {
    return startJob(`source-test:${sourceId}`, `/api/sources/${sourceId}/check`);
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
    setMessage('Reader defaults saved in this browser.');
  }
  if (!provider)
    return (
      <div className="rounded-[15px] border border-dashed border-line-strong bg-card/60 px-6 py-16 text-center text-muted">
        Loading settings…
      </div>
    );

  const providerTest = jobActions['provider-test'];
  const providerTestActive = isJobFeedbackActive(providerTest);
  const providerTestLabel =
    providerTest?.state === 'submitting'
      ? 'Queueing…'
      : providerTest?.state === 'queued'
        ? 'Queued'
        : providerTest?.state === 'running'
          ? 'Testing…'
          : 'Test provider';
  const providerTestDetail =
    providerTest?.state === 'succeeded'
      ? 'Provider test succeeded.'
      : (providerTest?.error ?? (providerTest?.state === 'cancelled' ? 'Provider test cancelled.' : null));
  const providerTestTerminal =
    providerTest?.state === 'succeeded' ||
    providerTest?.state === 'failed' ||
    providerTest?.state === 'cancelled' ||
    providerTest?.state === 'request-error';
  const providerTestFailed =
    providerTest?.state === 'failed' || providerTest?.state === 'cancelled' || providerTest?.state === 'request-error';
  return (
    <>
      {message && (
        <div
          className="mb-4 rounded-[10px] border border-[color-mix(in_srgb,var(--color-warning)_30%,var(--color-line))] bg-[color-mix(in_srgb,var(--color-warning)_10%,var(--color-card))] px-3.5 py-3 text-warning"
          role="status"
        >
          {message}
        </div>
      )}
      {error && (
        <div
          className="mb-4 rounded-[10px] border border-[color-mix(in_srgb,var(--color-danger)_35%,var(--color-line))] bg-danger-soft px-3.5 py-3 text-danger"
          role="alert"
        >
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
          <div>
            <h2>Translation provider</h2>
            <p className="mt-1 text-sm text-muted">
              Configure generation limits and how many chapters may translate at the same time.
            </p>
          </div>
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
                type="text"
                inputMode="numeric"
                pattern="[0-9]+"
                required
                value={chunkCharacters}
                onChange={(event) => {
                  const value = event.target.value;
                  if (/^[0-9]*$/.test(value)) setChunkCharacters(value);
                }}
              />
            </label>
            <label className={fieldClass}>
              Parallel translations
              <input
                className={inputClass}
                type="number"
                min="1"
                max="20"
                step="1"
                required
                value={provider.translationConcurrency}
                onChange={(event) => setProvider({ ...provider, translationConcurrency: Number(event.target.value) })}
              />
              <span className="font-normal leading-relaxed text-muted">
                Maximum chapter translations running at once. Default is 1; changes apply without restarting the worker.
              </span>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-[9px]">
            <button className={primaryButtonClass} type="submit">
              <Save size={16} /> Save provider
            </button>
            <button
              className={`${buttonClass} disabled:cursor-not-allowed disabled:opacity-60`}
              aria-busy={providerTestActive}
              type="button"
              disabled={providerTestActive}
              onClick={() => void testProvider()}
            >
              {providerTestActive ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />}
              {providerTestLabel}
            </button>
          </div>
          <p className="text-xs text-muted">Tests saved settings; unsaved edits above are not included.</p>
          {providerTest && !providerTestDetail && (
            <span className="sr-only" role="status">
              {providerTestLabel}
            </span>
          )}
          {providerTestDetail && (
            <div
              className={`flex flex-wrap items-center gap-2 text-sm ${
                providerTestFailed ? 'text-danger' : providerTest?.error ? 'text-warning' : 'text-success'
              }`}
              role={providerTestFailed ? 'alert' : 'status'}
            >
              <span>{providerTestDetail}</span>
              {providerTestTerminal && (
                <Link className="text-xs font-bold underline" href="/activity">
                  View activity
                </Link>
              )}
            </div>
          )}
        </form>
      )}
      {tab === 'Sources' && (
        <div className="grid gap-4">
          <div>
            <h2>Scraping sources</h2>
            <p className="mt-1 text-sm text-muted">
              Source adapters are maintained in code. Configure only how each adapter runs here.
            </p>
          </div>
          {sources.map((source) => {
            const sourceTest = jobActions[`source-test:${source.sourceId}`];
            const sourceTestActive = isJobFeedbackActive(sourceTest);
            const sourceTestLabel =
              sourceTest?.state === 'submitting'
                ? 'Queueing…'
                : sourceTest?.state === 'queued'
                  ? 'Queued'
                  : sourceTest?.state === 'running'
                    ? 'Testing…'
                    : 'Test';
            const sourceTestDetail =
              sourceTest?.state === 'succeeded'
                ? 'Source test succeeded.'
                : (sourceTest?.error ?? (sourceTest?.state === 'cancelled' ? 'Source test cancelled.' : null));
            const sourceTestTerminal =
              sourceTest?.state === 'succeeded' ||
              sourceTest?.state === 'failed' ||
              sourceTest?.state === 'cancelled' ||
              sourceTest?.state === 'request-error';
            const sourceTestFailed =
              sourceTest?.state === 'failed' ||
              sourceTest?.state === 'cancelled' ||
              sourceTest?.state === 'request-error';
            return (
              <section className={panelClass} key={source.sourceId}>
                <div className="flex flex-wrap items-start justify-between gap-[9px]">
                  <div>
                    <strong>{source.name}</strong>
                    <div className="text-muted">
                      {source.siteUrl} · {source.version}
                    </div>
                    <div className="text-muted">
                      {source.lastError ??
                        (source.lastCheckedAt
                          ? `Checked ${new Date(source.lastCheckedAt).toLocaleString()}`
                          : 'Not checked yet')}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-[9px]">
                    <button
                      className={`${buttonClass} disabled:cursor-not-allowed disabled:opacity-60`}
                      aria-busy={sourceTestActive}
                      disabled={sourceTestActive || !source.enabled}
                      onClick={() => void testSource(source.sourceId)}
                    >
                      {sourceTestActive && <Loader2 className="animate-spin" size={16} />}
                      {sourceTestLabel}
                    </button>
                    <button
                      className={`${switchClass} ${source.enabled ? 'bg-success after:translate-x-5' : ''}`}
                      aria-label={`Toggle ${source.name}`}
                      onClick={() => void updateSource(source, { enabled: !source.enabled })}
                    />
                  </div>
                </div>
                {sourceTest && !sourceTestDetail && (
                  <span className="sr-only" role="status">
                    {sourceTestLabel}
                  </span>
                )}
                {sourceTestDetail && (
                  <div
                    className={`mt-3 flex flex-wrap items-center gap-2 text-sm ${
                      sourceTestFailed ? 'text-danger' : sourceTest?.error ? 'text-warning' : 'text-success'
                    }`}
                    role={sourceTestFailed ? 'alert' : 'status'}
                  >
                    <span>{sourceTestDetail}</span>
                    {sourceTestTerminal && (
                      <Link className="text-xs font-bold underline" href="/activity">
                        View activity
                      </Link>
                    )}
                  </div>
                )}
                <div className="mt-4 grid max-w-xl grid-cols-2 gap-3.5 max-[760px]:grid-cols-1">
                  <label className={fieldClass}>
                    Parallel downloads
                    <input
                      className={inputClass}
                      type="number"
                      min="1"
                      max="20"
                      step="1"
                      value={source.downloadConcurrency}
                      onChange={(event) =>
                        void updateSource(source, { downloadConcurrency: Number(event.target.value) })
                      }
                    />
                    <span className="font-normal leading-relaxed text-muted">
                      Maximum source jobs that may run at the same time.
                    </span>
                  </label>
                  <label className={fieldClass}>
                    Request interval (ms)
                    <input
                      className={inputClass}
                      type="number"
                      min="2000"
                      step="500"
                      value={source.requestIntervalMs}
                      onChange={(event) => void updateSource(source, { requestIntervalMs: Number(event.target.value) })}
                    />
                    <span className="font-normal leading-relaxed text-muted">
                      Minimum delay between requests sent to this site.
                    </span>
                  </label>
                </div>
              </section>
            );
          })}
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
            <div className={fieldClass}>
              <span>Line height</span>
              <SelectMenu
                ariaLabel="Line height"
                value={String(lineHeight)}
                options={readerLineHeightOptions}
                onChange={(value) => setLineHeight(Number(value))}
              />
            </div>
          </div>
          <button className={`${primaryButtonClass} w-fit`} onClick={saveReader}>
            <Save size={16} /> Save reader defaults
          </button>
        </section>
      )}
    </>
  );
}
