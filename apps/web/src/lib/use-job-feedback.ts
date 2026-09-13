'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type JobFeedbackState =
  'submitting' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'request-error';

export interface JobFeedbackAction {
  jobId: string | null;
  state: JobFeedbackState;
  error: string | null;
}

const POLL_INTERVAL_MS = 3000;
const activeStates = new Set<JobFeedbackState>(['submitting', 'queued', 'running']);
const memoryActiveJobs = new Map<string, Record<string, string>>();

interface JobResponse {
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  error: string | null;
}

function isJobResponse(value: unknown): value is JobResponse {
  if (!value || typeof value !== 'object' || !('status' in value)) return false;
  const status = value.status;
  return (
    (status === 'queued' ||
      status === 'running' ||
      status === 'succeeded' ||
      status === 'failed' ||
      status === 'cancelled') &&
    (!('error' in value) || value.error === null || typeof value.error === 'string')
  );
}

function errorMessage(value: unknown, fallback: string): string {
  if (
    value &&
    typeof value === 'object' &&
    'error' in value &&
    value.error &&
    typeof value.error === 'object' &&
    'message' in value.error &&
    typeof value.error.message === 'string'
  )
    return value.error.message;
  return fallback;
}

function readActiveJobs(scope: string): Record<string, string> {
  try {
    const stored = window.sessionStorage.getItem(`job-feedback:${scope}`);
    if (stored === null) return { ...(memoryActiveJobs.get(scope) ?? {}) };
    const value: unknown = JSON.parse(stored);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  } catch {
    return { ...(memoryActiveJobs.get(scope) ?? {}) };
  }
}

function writeActiveJobs(scope: string, jobs: Record<string, string>): void {
  memoryActiveJobs.set(scope, { ...jobs });
  try {
    if (Object.keys(jobs).length === 0) window.sessionStorage.removeItem(`job-feedback:${scope}`);
    else window.sessionStorage.setItem(`job-feedback:${scope}`, JSON.stringify(jobs));
  } catch {
    // The in-memory copy keeps tracking alive when session storage is unavailable.
  }
}

export function isJobFeedbackActive(action: JobFeedbackAction | undefined): boolean {
  return action !== undefined && activeStates.has(action.state);
}

export function useJobFeedback(scope: string) {
  const [actions, setActions] = useState<Record<string, JobFeedbackAction>>({});
  const controllers = useRef(new Map<string, AbortController>());
  const timers = useRef(new Map<string, number>());
  const activeJobIds = useRef<Record<string, string>>({});

  const stopTracking = useCallback(
    (key: string, jobId: string) => {
      controllers.current.delete(key);
      const timer = timers.current.get(key);
      if (timer !== undefined) window.clearTimeout(timer);
      timers.current.delete(key);
      if (activeJobIds.current[key] === jobId) {
        const next = { ...activeJobIds.current };
        delete next[key];
        activeJobIds.current = next;
        writeActiveJobs(scope, next);
      }
    },
    [scope],
  );

  const schedulePoll = useCallback(
    (key: string, jobId: string, controller: AbortController, delay = POLL_INTERVAL_MS) => {
      const run = async () => {
        timers.current.delete(key);
        try {
          const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
            cache: 'no-store',
            signal: controller.signal,
          });
          if (controller.signal.aborted) return;
          if (response.status === 404) {
            setActions((current) => ({
              ...current,
              [key]: { jobId, state: 'request-error', error: 'Job no longer available.' },
            }));
            stopTracking(key, jobId);
            return;
          }
          if (!response.ok) throw new Error('Job status request failed.');
          const value: unknown = await response.json();
          if (!isJobResponse(value)) throw new Error('Invalid job status response.');
          setActions((current) => ({
            ...current,
            [key]: {
              jobId,
              state: value.status,
              error: value.status === 'failed' ? (value.error ?? 'Job failed.') : null,
            },
          }));
          if (value.status === 'succeeded' || value.status === 'failed' || value.status === 'cancelled') {
            stopTracking(key, jobId);
            return;
          }
        } catch {
          if (controller.signal.aborted) return;
          setActions((current) => {
            const action = current[key];
            if (!action || action.jobId !== jobId) return current;
            return {
              ...current,
              [key]: { ...action, error: 'Status unavailable; reconnecting…' },
            };
          });
        }
        if (!controller.signal.aborted && controllers.current.get(key) === controller) {
          const timer = window.setTimeout(() => void run(), POLL_INTERVAL_MS);
          timers.current.set(key, timer);
        }
      };

      const timer = window.setTimeout(() => void run(), delay);
      timers.current.set(key, timer);
    },
    [stopTracking],
  );

  useEffect(() => {
    const stored = readActiveJobs(scope);
    activeJobIds.current = stored;
    setActions(
      Object.fromEntries(
        Object.entries(stored).map(([key, jobId]) => [key, { jobId, state: 'queued' as const, error: null }]),
      ),
    );
    for (const [key, jobId] of Object.entries(stored)) {
      const controller = new AbortController();
      controllers.current.set(key, controller);
      schedulePoll(key, jobId, controller, 0);
    }

    const activeControllers = controllers.current;
    const activeTimers = timers.current;
    return () => {
      for (const controller of activeControllers.values()) controller.abort();
      activeControllers.clear();
      for (const timer of activeTimers.values()) window.clearTimeout(timer);
      activeTimers.clear();
    };
  }, [schedulePoll, scope]);

  const start = useCallback(
    async (key: string, url: string, body?: unknown) => {
      if (controllers.current.has(key) || isJobFeedbackActive(actions[key])) return;
      const controller = new AbortController();
      controllers.current.set(key, controller);
      setActions((current) => ({
        ...current,
        [key]: { jobId: null, state: 'submitting', error: null },
      }));
      try {
        const init: RequestInit = { method: 'POST', signal: controller.signal };
        if (body !== undefined) {
          init.headers = { 'Content-Type': 'application/json' };
          init.body = JSON.stringify(body);
        }
        const response = await fetch(url, init);
        let value: unknown = null;
        try {
          value = await response.json();
        } catch {
          if (response.ok) throw new Error('Invalid job response.');
        }
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(errorMessage(value, 'Could not queue job.'));
        if (!value || typeof value !== 'object' || !('jobId' in value) || typeof value.jobId !== 'string')
          throw new Error('Invalid job response.');

        const jobId = value.jobId;
        activeJobIds.current = { ...activeJobIds.current, [key]: jobId };
        writeActiveJobs(scope, activeJobIds.current);
        setActions((current) => ({
          ...current,
          [key]: { jobId, state: 'queued', error: null },
        }));
        schedulePoll(key, jobId, controller);
      } catch (cause) {
        if (controller.signal.aborted) return;
        controllers.current.delete(key);
        setActions((current) => ({
          ...current,
          [key]: {
            jobId: null,
            state: 'request-error',
            error: cause instanceof Error ? cause.message : 'Could not queue job.',
          },
        }));
      }
    },
    [actions, schedulePoll, scope],
  );

  return { actions, start };
}
