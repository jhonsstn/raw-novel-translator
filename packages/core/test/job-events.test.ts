import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type * as DatabaseModule from '@novel/db';
import type * as JobsModule from '../src/jobs.js';
import type * as ActivityModule from '../src/activity.js';
import type * as SettingsModule from '../src/settings.js';
import type * as ErrorsModule from '../src/errors.js';

let database: typeof DatabaseModule;
let jobs: typeof JobsModule;
let activity: typeof ActivityModule;
let settings: typeof SettingsModule;
let errors: typeof ErrorsModule;

beforeEach(async () => {
  process.env.DATABASE_PATH = join(tmpdir(), `novel-job-events-${randomUUID()}.sqlite`);
  process.env.APP_SECRET_KEY = Buffer.alloc(32, 9).toString('base64');
  database = await import('@novel/db');
  // Set database/encryption configuration before loading the application module graph.
  jobs = await import('../src/jobs.js');
  activity = await import('../src/activity.js');
  database.migrate();
  settings = await import('../src/settings.js');
  errors = await import('../src/errors.js');
});
afterEach(() => database.closeDatabase());

describe('persistent job diagnostics', () => {
  it('retains failed history and links retries across database reopen', () => {
    const original = jobs.enqueueJob({ kind: 'source_check' });
    const claimed = jobs.claimJob('source', Date.now())!;
    jobs.failJob(original.id, claimed.leaseToken!, new Error('fetch failed', { cause: Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }) }));
    const failedEvents = activity.listJobEvents(original.id);
    const retry = jobs.retryJob(original.id);
    expect(retry.id).not.toBe(original.id);
    expect(jobs.getJob(original.id)?.status).toBe('failed');
    expect(activity.listJobEvents(original.id).slice(0, failedEvents.length)).toEqual(failedEvents);
    expect(activity.listJobEvents(original.id).at(-1)?.details).toContain(retry.id);
    expect(activity.listJobEvents(retry.id).at(-1)?.details).toContain(original.id);
    const retryClaim = jobs.claimJob('source', Date.now())!;
    expect(jobs.finishJob(retry.id, retryClaim.leaseToken!)).toBe(true);
    database.closeDatabase();
    expect(activity.listJobEvents(original.id).some((event) => event.details?.includes('ECONNREFUSED'))).toBe(true);
    expect(activity.listJobEvents(retry.id).at(-1)?.message).toBe('Job completed');
  });

  it('keeps reclaimed attempts and rejects stale or cancelled lease writes', () => {
    const job = jobs.enqueueJob({ kind: 'source_check' });
    const now = Date.now();
    const first = jobs.claimJob('source', now)!;
    expect(jobs.recordJobEvent(job.id, first.leaseToken!, 'First attempt context')).toBe(true);
    const reclaimed = jobs.claimJob('source', now + 90_001)!;
    expect(reclaimed.attempt).toBe(2);
    const before = activity.listJobEvents(job.id);
    expect(jobs.recordJobEvent(job.id, first.leaseToken!, 'Stale context')).toBe(false);
    expect(jobs.failJob(job.id, first.leaseToken!, new Error('Stale failure'))).toBe(false);
    expect(jobs.finishJob(job.id, first.leaseToken!)).toBe(false);
    expect(activity.listJobEvents(job.id)).toEqual(before);
    expect(before.filter((event) => event.message === 'Job claimed by worker').map((event) => event.attempt)).toEqual([1, 2]);
    expect(jobs.cancelJob(job.id)).toBe(true);
    const cancelled = activity.listJobEvents(job.id);
    expect(jobs.recordJobEvent(job.id, reclaimed.leaseToken!, 'Cancelled context')).toBe(false);
    expect(jobs.failJob(job.id, reclaimed.leaseToken!, new Error('Cancelled failure'))).toBe(false);
    expect(activity.listJobEvents(job.id)).toEqual(cancelled);
  });

  it('persists nested fetch causes while redacting credentials and ignoring arbitrary fields', () => {
    const apiKey = 'provider-secret-without-a-label';
    settings.updateProviderSettings({ apiKey });
    const cause = Object.assign(new Error(`socket failed ${apiKey} ${process.env.APP_SECRET_KEY}`), {
      code: 'ECONNREFUSED', syscall: 'connect', hostname: 'source.example', address: '127.0.0.1', port: 443,
      request: { body: 'PRIVATE_BODY', headers: { authorization: 'PRIVATE_HEADER' } },
    });
    const error = new TypeError('fetch failed', { cause: new AggregateError([cause], 'connection attempts failed') });
    const job = jobs.enqueueJob({ kind: 'source_check', payload: { sourceId: 'test-source', privatePayload: 'PRIVATE_PAYLOAD' } });
    const claimed = jobs.claimJob('source', Date.now())!;
    jobs.recordJobEvent(job.id, claimed.leaseToken!, 'Request context', 'GET https://username:password@source.example/novel?token=QUERY_SECRET Authorization: Bearer HEADER_SECRET api-key=KEY_SECRET');
    expect(jobs.failJob(job.id, claimed.leaseToken!, error)).toBe(true);
    expect(jobs.getJob(job.id)?.error).toBe('fetch failed');
    const events = JSON.stringify(activity.listJobEvents(job.id));
    for (const expected of ['ECONNREFUSED', 'connect', 'source.example', '127.0.0.1', '443', 'Aggregate error 1', 'test-source']) expect(events).toContain(expected);
    for (const secret of [apiKey, process.env.APP_SECRET_KEY!, 'username', 'password', 'QUERY_SECRET', 'HEADER_SECRET', 'KEY_SECRET', 'PRIVATE_BODY', 'PRIVATE_HEADER', 'PRIVATE_PAYLOAD']) expect(events).not.toContain(secret);
    expect(activity.listJobEvents(job.id).find((event) => event.details?.includes('ECONNREFUSED'))?.details).toContain('at ');
  });

  it('bounds cyclic diagnostics and returns only the latest 200 events oldest-first', () => {
    const cyclic = new Error('cycle');
    cyclic.cause = cyclic;
    expect(errors.errorDiagnostics(cyclic)).toContain('[circular reference]');
    const large = new AggregateError(Array.from({ length: 30 }, () => new Error('x'.repeat(20_000))), 'many errors');
    expect(errors.errorDiagnostics(large).length).toBeLessThanOrEqual(16_000);
    const job = jobs.enqueueJob({ kind: 'source_check' });
    const claimed = jobs.claimJob('source', Date.now())!;
    for (let index = 0; index < 205; index += 1) jobs.recordJobEvent(job.id, claimed.leaseToken!, `Step ${index}`);
    const events = activity.listJobEvents(job.id);
    expect(events).toHaveLength(200);
    expect(events[0]?.message).toBe('Step 5');
    expect(events.at(-1)?.message).toBe('Step 204');
    expect(events.every((event, index) => index === 0 || event.id > events[index - 1]!.id)).toBe(true);
    expect(activity.listJobEvents('missing-job')).toEqual([]);
  });
});
