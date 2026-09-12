import type { LookupAddress, LookupAllOptions } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  addresses: [] as LookupAddress[],
  error: null as NodeJS.ErrnoException | null,
  lookup: undefined as LookupFunction | undefined,
}));

vi.mock('node:dns', () => ({
  lookup: (_hostname: string, _options: LookupAllOptions, callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => callback(state.error, state.addresses),
}));
vi.mock('undici', () => ({
  Agent: class {
    constructor(options: { connect: { lookup: LookupFunction } }) { state.lookup = options.connect.lookup; }
  },
  fetch: vi.fn(),
}));

import '../src/http.js';

beforeEach(() => {
  state.addresses = [{ address: '93.184.215.14', family: 4 }, { address: '2606:4700:4700::1111', family: 6 }];
  state.error = null;
});

function resolveHost(all: boolean) {
  return new Promise<{ error: NodeJS.ErrnoException | null; address: string | LookupAddress[]; family?: number }>((resolve) => {
    if (!state.lookup) throw new Error('Source agent lookup is missing');
    state.lookup('www.piaotia.com', { all }, (error, address, family) => resolve({ error, address, family }));
  });
}

it('returns address objects when Node requests all addresses for family selection', async () => {
  const result = await resolveHost(true);
  expect(result.error).toBeNull();
  expect(result.address).toEqual(state.addresses);
});

it('returns a single address and family for legacy lookup callers', async () => {
  expect(await resolveHost(false)).toEqual({ error: null, address: '93.184.215.14', family: 4 });
});

it('rejects mixed public and private DNS answers in both callback modes', async () => {
  state.addresses.push({ address: '127.0.0.1', family: 4 });
  for (const all of [true, false]) {
    expect((await resolveHost(all)).error).toMatchObject({ code: 'ENETUNREACH' });
  }
});

it('propagates DNS failures and rejects empty answers', async () => {
  state.error = Object.assign(new Error('DNS lookup failed'), { code: 'ENOTFOUND' });
  expect((await resolveHost(true)).error).toBe(state.error);
  state.error = null;
  state.addresses = [];
  expect((await resolveHost(true)).error).toMatchObject({ code: 'ENETUNREACH' });
});
