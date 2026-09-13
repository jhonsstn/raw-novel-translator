'use client';
import { Check, Copy, RefreshCw, RotateCcw, XCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SelectMenu } from './select-menu';

interface Activity {
  id: string;
  kind: string;
  status: string;
  origin: string;
  attempt: number;
  error: string | null;
  novelTitle: string | null;
  chapterTitle: string | null;
  createdAt: number;
  updatedAt: number;
}
interface Health {
  healthy: boolean;
  heartbeatAt: number | null;
}
interface JobEvent {
  id: number;
  jobId: string;
  attempt: number;
  level: 'info' | 'error';
  message: string;
  details: string | null;
  createdAt: number;
}
function isActivityList(value: unknown): value is Activity[] {
  return (
    Array.isArray(value) &&
    value.every((item) => !!item && typeof item === 'object' && 'id' in item && 'status' in item && 'updatedAt' in item)
  );
}
function isHealth(value: unknown): value is Health {
  return !!value && typeof value === 'object' && 'healthy' in value && typeof value.healthy === 'boolean';
}
function isEventList(value: unknown): value is JobEvent[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        !!item &&
        typeof item === 'object' &&
        typeof item.id === 'number' &&
        typeof item.jobId === 'string' &&
        typeof item.attempt === 'number' &&
        (item.level === 'info' || item.level === 'error') &&
        typeof item.message === 'string' &&
        (item.details === null || typeof item.details === 'string') &&
        typeof item.createdAt === 'number',
    )
  );
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed. Please try again.';
}
async function requestJson(url: string, signal: AbortSignal, method = 'GET'): Promise<unknown> {
  const response = await fetch(url, { cache: 'no-store', signal, method });
  if (!response.ok) {
    let message = `Request failed (HTTP ${response.status}).`;
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
        message = `${body.error.message} (HTTP ${response.status})`;
    } catch {
      /* Non-JSON errors still expose the HTTP status. */
    }
    throw new Error(message);
  }
  return response.json();
}

const buttonClass =
  'inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border border-line bg-card px-3.5 text-[13px] font-bold text-ink transition-[transform,border-color,background-color,box-shadow] duration-150 enabled:hover:-translate-y-px enabled:hover:border-line-strong enabled:hover:bg-card-hover enabled:hover:shadow-button';
const errorClass =
  'rounded-[10px] border border-[color-mix(in_srgb,var(--color-danger)_35%,var(--color-line))] bg-danger-soft px-3.5 py-3 text-danger';
const activityStatusOptions = [
  { value: 'all', label: 'All statuses' },
  { value: 'queued', label: 'Queued' },
  { value: 'running', label: 'Running' },
  { value: 'failed', label: 'Failed' },
  { value: 'succeeded', label: 'Succeeded' },
  { value: 'cancelled', label: 'Cancelled' },
] as const;

function JobDetails({ item, refresh }: { item: Activity; refresh: number }) {
  const [events, setEvents] = useState<JobEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const value = await requestJson(`/api/jobs/${encodeURIComponent(item.id)}/events`, controller.signal);
      if (!isEventList(value)) throw new Error('Invalid job events response. Please refresh to try again.');
      if (!controller.signal.aborted) {
        setEvents(value);
        setError(null);
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause));
    } finally {
      if (request.current === controller) {
        request.current = null;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
  }, [item.id]);
  useEffect(() => {
    void load();
  }, [load, refresh]);
  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  async function copyErrorLog() {
    setCopied(false);
    setCopyError(null);
    const errors = events?.filter((event) => event.level === 'error') ?? [];
    const log = errors.length
      ? errors
          .map(
            (event) =>
              `[${new Date(event.createdAt).toISOString()}] Attempt ${event.attempt}\n${event.message}${event.details ? `\n${event.details}` : ''}`,
          )
          .join('\n\n')
      : item.error;
    if (!log) return;
    try {
      await navigator.clipboard.writeText(`Job: ${item.id}\nKind: ${item.kind}\n\n${log}`);
      setCopied(true);
    } catch {
      setCopyError(
        'Could not copy the error log. Allow clipboard access or select and copy the diagnostic text below.',
      );
    }
  }
  return (
    <div
      className="col-span-full rounded-[11px] border border-line bg-paper-raised p-[17px] [&_button:disabled]:cursor-wait"
      id={`job-details-${item.id}`}
    >
      <dl className="mb-5 flex flex-wrap gap-x-7 gap-y-3.5 [&>div]:min-w-0 [&_dt]:text-[11px] [&_dt]:font-bold [&_dt]:text-muted [&_dd]:mt-1">
        <div>
          <dt>Job ID</dt>
          <dd>
            <code>{item.id}</code>
          </dd>
        </div>
        <div>
          <dt>Attempt</dt>
          <dd>{item.attempt}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{new Date(item.createdAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{new Date(item.updatedAt).toLocaleString()}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center gap-[9px]">
        <strong>Event timeline</strong>
        <span className="text-muted">Most recent 200 events, oldest first</span>
        <button
          className={buttonClass}
          aria-label={copied ? 'Error log copied' : 'Copy error log'}
          title={copied ? 'Copied' : 'Copy error log'}
          disabled={events === null || (!item.error && !events.some((event) => event.level === 'error'))}
          onClick={() => void copyErrorLog()}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
      </div>
      {copyError && (
        <div className={`${errorClass} mt-3`} role="alert">
          {copyError}
        </div>
      )}
      {error && (
        <div className={`${errorClass} mt-3`} role="alert">
          Could not load job events: {error} {events && 'Showing previously loaded events.'}
          <button className={`${buttonClass} m-2`} disabled={loading} onClick={() => void load()}>
            Retry loading
          </button>
        </div>
      )}
      {events?.length === 0 && (
        <p className="text-muted">
          No recorded events for this job. Historical jobs have no diagnostic logs; retry a failed job to capture
          diagnostics for a new attempt.
        </p>
      )}
      {!!events?.length && (
        <ol className="mt-3.5 max-h-[480px] list-none overflow-auto overscroll-contain p-0">
          {events.map((event) => (
            <li
              key={event.id}
              className={`rounded-r-lg border-l-[3px] bg-card p-3 [&+&]:mt-[9px] ${
                event.level === 'error' ? 'border-danger' : 'border-line-strong'
              }`}
            >
              <div className="flex flex-wrap items-center gap-[9px] text-[11px] text-muted">
                <time dateTime={new Date(event.createdAt).toISOString()}>
                  {new Date(event.createdAt).toLocaleString()}
                </time>
                <span
                  className={`text-[10px] font-[850] uppercase tracking-[.11em] ${
                    event.level === 'error' ? 'text-danger' : 'text-muted'
                  }`}
                >
                  {event.level}
                </span>
                <span>Attempt {event.attempt}</span>
              </div>
              <pre className="mt-2 wrap-anywhere text-xs leading-relaxed whitespace-pre-wrap break-words select-text">
                {event.message}
                {event.details ? `\n${event.details}` : ''}
              </pre>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function ActivityClient() {
  const [items, setItems] = useState<Activity[]>([]);
  const [healthy, setHealthy] = useState(true);
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [refresh, setRefresh] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const request = useRef<AbortController | null>(null);
  const actions = useRef(new Map<string, AbortController>());
  const load = useCallback(async (force = false) => {
    if (request.current && !force) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setRefresh((value) => value + 1);
    await Promise.all([
      (async () => {
        try {
          const value = await requestJson('/api/activity?limit=250', controller.signal);
          if (!isActivityList(value)) throw new Error('Invalid activity response.');
          if (!controller.signal.aborted) {
            setItems(value);
            setLoaded(true);
            setActivityError(null);
          }
        } catch (cause) {
          if (!controller.signal.aborted) setActivityError(errorMessage(cause));
        }
      })(),
      (async () => {
        try {
          const value = await requestJson('/api/health', controller.signal);
          if (!isHealth(value)) throw new Error('Invalid worker health response.');
          if (!controller.signal.aborted) {
            setHealthy(value.healthy);
            setHealthError(null);
          }
        } catch (cause) {
          if (!controller.signal.aborted) setHealthError(errorMessage(cause));
        }
      })(),
    ]);
    if (request.current === controller) request.current = null;
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 3000);
    const activeActions = actions.current;
    return () => {
      clearInterval(timer);
      request.current?.abort();
      request.current = null;
      for (const controller of activeActions.values()) controller.abort();
      activeActions.clear();
    };
  }, [load]);
  async function act(id: string, action: 'cancel' | 'retry') {
    if (actions.current.has(id)) return;
    const controller = new AbortController();
    actions.current.set(id, controller);
    setPending((value) => new Set(value).add(id));
    setActionErrors((value) => {
      const next = { ...value };
      delete next[id];
      return next;
    });
    try {
      const value = await requestJson(`/api/jobs/${encodeURIComponent(id)}/${action}`, controller.signal, 'POST');
      if (
        action === 'cancel' &&
        (!value || typeof value !== 'object' || !('cancelled' in value) || value.cancelled !== true)
      )
        throw new Error('Job could not be cancelled. It may have already finished. Refresh to see its current status.');
      if (!controller.signal.aborted) await load(true);
    } catch (cause) {
      if (!controller.signal.aborted)
        setActionErrors((value) => ({ ...value, [id]: `Could not ${action} job: ${errorMessage(cause)}` }));
    } finally {
      if (actions.current.get(id) === controller) {
        actions.current.delete(id);
        if (!controller.signal.aborted)
          setPending((value) => {
            const next = new Set(value);
            next.delete(id);
            return next;
          });
      }
    }
  }
  const filtered = useMemo(
    () => (filter === 'all' ? items : items.filter((item) => item.status === filter)),
    [items, filter],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 50));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * 50, currentPage * 50);
  return (
    <>
      <section className="mb-8 flex items-end justify-between gap-8 max-[760px]:flex-col max-[760px]:items-start max-[760px]:gap-5">
        <div className="max-w-[760px]">
          <div className="mb-2.5 text-[11px] font-extrabold uppercase tracking-[.15em] text-accent-ink">
            Background work
          </div>
          <h1>Activity</h1>
          <p className="mt-[13px] max-w-[660px] text-muted">
            Imports, downloads, checks, and translations update here while the worker runs.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-[9px]">
          <SelectMenu
            className="w-44 max-[520px]:w-full"
            ariaLabel="Filter jobs by status"
            value={filter}
            options={activityStatusOptions}
            onChange={(value) => {
              setFilter(value);
              setPage(1);
            }}
          />
          <button className={buttonClass} onClick={() => void load(true)}>
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
      </section>
      {activityError && (
        <div className={`${errorClass} mb-[18px]`} role="alert">
          Could not load activity: {activityError} {loaded && 'Showing previously loaded jobs.'} Use Refresh to try
          again.
        </div>
      )}
      {healthError && (
        <div className={`${errorClass} mb-[18px]`} role="alert">
          Could not check worker health: {healthError}
        </div>
      )}
      {!healthy && !healthError && (
        <div className={`${errorClass} mb-[18px]`}>
          Worker offline: queued jobs will not run until a recent heartbeat is recorded.
        </div>
      )}
      <section className="rounded-[15px] border border-line bg-card p-[22px] text-ink shadow-card max-[760px]:p-[17px]">
        {visible.length === 0 ? (
          loaded ? (
            <div className="rounded-[15px] border border-dashed border-line-strong bg-card/60 px-6 py-16 text-center text-muted">
              No matching jobs.
            </div>
          ) : null
        ) : (
          visible.map((item) => (
            <div
              className="grid grid-cols-[130px_minmax(0,1fr)_170px] items-center gap-4 border-b border-line px-1 py-4 last:border-b-0 max-[760px]:grid-cols-[1fr_auto] [&>*]:min-w-0 [&>*]:wrap-anywhere [&>*:nth-child(2)]:max-[760px]:col-span-full [&>*:nth-child(2)]:max-[760px]:row-start-2"
              key={item.id}
            >
              <div>
                <span
                  className={`text-[10px] font-[850] uppercase tracking-[.11em] ${
                    item.status === 'succeeded'
                      ? 'text-success'
                      : item.status === 'failed'
                        ? 'text-danger'
                        : item.status === 'running'
                          ? 'text-warning'
                          : 'text-muted'
                  }`}
                >
                  {item.status}
                </span>
                <div className="mt-1 text-xs text-muted">{new Date(item.createdAt).toLocaleString()}</div>
              </div>
              <div>
                <strong>{item.kind.replaceAll('_', ' ')}</strong>
                <div className="text-muted">
                  {item.chapterTitle ?? item.novelTitle ?? item.origin}
                  {item.error ? ` · ${item.error}` : ''}
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-[9px] [&_button:disabled]:cursor-wait">
                <button
                  className={buttonClass}
                  aria-expanded={expanded.has(item.id)}
                  aria-controls={`job-details-${item.id}`}
                  onClick={() =>
                    setExpanded((value) => {
                      const next = new Set(value);
                      if (next.has(item.id)) next.delete(item.id);
                      else next.add(item.id);
                      return next;
                    })
                  }
                >
                  {expanded.has(item.id) ? 'Hide details' : 'Details'}
                </button>
                {(item.status === 'queued' || item.status === 'running') && (
                  <button
                    className={`${buttonClass} text-danger`}
                    disabled={pending.has(item.id)}
                    onClick={() => void act(item.id, 'cancel')}
                    title="Cancel"
                    aria-label="Cancel job"
                  >
                    <XCircle size={16} />
                  </button>
                )}
                {item.status === 'failed' && (
                  <button
                    className={buttonClass}
                    disabled={pending.has(item.id)}
                    onClick={() => void act(item.id, 'retry')}
                  >
                    <RotateCcw size={16} /> Retry
                  </button>
                )}
                {pending.has(item.id) && (
                  <span className="text-muted" role="status">
                    Updating job…
                  </span>
                )}
              </div>
              {actionErrors[item.id] && (
                <div className={`${errorClass} col-span-full`} role="alert">
                  {actionErrors[item.id]}
                </div>
              )}
              {expanded.has(item.id) && <JobDetails item={item} refresh={refresh} />}
            </div>
          ))
        )}
        {pages > 1 && (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-[9px]">
            <button className={buttonClass} disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
              Previous
            </button>
            <span>
              {currentPage} / {pages}
            </span>
            <button className={buttonClass} disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>
              Next
            </button>
          </div>
        )}
      </section>
    </>
  );
}
