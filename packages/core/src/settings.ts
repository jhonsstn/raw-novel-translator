import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getDatabase } from '@novel/db';
import { listSourceAdapters } from '@novel/sources';
import { AppError } from './errors.js';
import { enqueueJob } from './jobs.js';

export interface ProviderSettingsView {
  baseUrl: string | null;
  model: string | null;
  revision: number;
  timeoutSeconds: number;
  chunkCharacters: number;
  translationConcurrency: number;
  automaticPaused: boolean;
  hasApiKey: boolean;
}
export interface ProviderCredentials {
  baseUrl: string;
  model: string;
  revision: number;
  timeoutSeconds: number;
  chunkCharacters: number;
  translationConcurrency: number;
  automaticPaused: boolean;
  hasApiKey: true;
  apiKey: string;
}
export interface UpdateProviderInput {
  baseUrl?: string | null | undefined;
  model?: string | null | undefined;
  apiKey?: string | undefined;
  clearApiKey?: boolean | undefined;
  timeoutSeconds?: number | undefined;
  chunkCharacters?: number | undefined;
  translationConcurrency?: number | undefined;
}
interface ProviderRow {
  base_url: string | null;
  model: string | null;
  encrypted_api_key: string | null;
  revision: number;
  timeout_seconds: number;
  chunk_characters: number;
  translation_concurrency: number;
  automatic_paused: number;
}

function secretKey(): Buffer {
  const encoded = process.env.APP_SECRET_KEY;
  if (!encoded) throw new Error('APP_SECRET_KEY is required and must be 32 random bytes encoded as base64');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error('APP_SECRET_KEY must decode to exactly 32 bytes');
  return key;
}

function encrypt(value: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secretKey(), nonce);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [nonce, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64')).join('.');
}

function decrypt(value: string): string {
  const parts = value.split('.').map((part) => Buffer.from(part, 'base64'));
  const nonce = parts[0];
  const tag = parts[1];
  const ciphertext = parts[2];
  if (!nonce || !tag || !ciphertext) throw new Error('Stored provider credential is invalid');
  const decipher = createDecipheriv('aes-256-gcm', secretKey(), nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function row(): ProviderRow {
  const value = getDatabase().sqlite.prepare('SELECT * FROM provider_settings WHERE id=1').get();
  if (!value) throw new Error('Provider settings are not initialized');
  return value as ProviderRow;
}

export function getProviderSettings(): ProviderSettingsView {
  const value = row();
  return {
    baseUrl: value.base_url,
    model: value.model,
    revision: value.revision,
    timeoutSeconds: value.timeout_seconds,
    chunkCharacters: value.chunk_characters,
    translationConcurrency: value.translation_concurrency,
    automaticPaused: value.automatic_paused === 1,
    hasApiKey: value.encrypted_api_key !== null,
  };
}

export function getStoredProviderApiKey(): string | null {
  const encrypted = row().encrypted_api_key;
  return encrypted === null ? null : decrypt(encrypted);
}

export function getProviderCredentials(): ProviderCredentials {
  const value = row();
  if (!value.base_url || !value.model || !value.encrypted_api_key)
    throw new AppError('PROVIDER_NOT_CONFIGURED', 'Configure the translation provider first', 409);
  return {
    ...getProviderSettings(),
    baseUrl: value.base_url,
    model: value.model,
    hasApiKey: true,
    apiKey: decrypt(value.encrypted_api_key),
  };
}

function validateBaseUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AppError('INVALID_PROVIDER_URL', 'Enter a valid provider base URL');
  }
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && url.protocol !== 'http:'))
    throw new AppError(
      'INVALID_PROVIDER_URL',
      'Provider URL must be an HTTP(S) origin/path without credentials, query, or fragment',
    );
  return url.href.replace(/\/$/, '');
}

export function updateProviderSettings(input: UpdateProviderInput): ProviderSettingsView {
  if (input.apiKey !== undefined && input.clearApiKey)
    throw new AppError('INVALID_PROVIDER_SETTINGS', 'Cannot set and clear the API key together');
  const current = row();
  const baseUrl =
    input.baseUrl === undefined ? current.base_url : input.baseUrl ? validateBaseUrl(input.baseUrl) : null;
  const model = input.model === undefined ? current.model : input.model?.trim() || null;
  const timeout = input.timeoutSeconds ?? current.timeout_seconds;
  const chunk = input.chunkCharacters ?? current.chunk_characters;
  const concurrency = input.translationConcurrency ?? current.translation_concurrency;
  if (!Number.isInteger(timeout) || timeout < 30 || timeout > 600)
    throw new AppError('INVALID_TIMEOUT', 'Timeout must be between 30 and 600 seconds');
  if (!Number.isInteger(chunk) || chunk < 500 || chunk > 15000)
    throw new AppError('INVALID_CHUNK_SIZE', 'Chunk size must be between 500 and 15000 code points');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20)
    throw new AppError('INVALID_TRANSLATION_CONCURRENCY', 'Parallel translations must be between 1 and 20');
  const encrypted = input.clearApiKey
    ? null
    : input.apiKey !== undefined
      ? encrypt(input.apiKey)
      : current.encrypted_api_key;
  const providerChanged =
    baseUrl !== current.base_url ||
    model !== current.model ||
    timeout !== current.timeout_seconds ||
    chunk !== current.chunk_characters ||
    input.apiKey !== undefined ||
    (input.clearApiKey === true && current.encrypted_api_key !== null);
  const sqlite = getDatabase().sqlite;
  sqlite.transaction(() => {
    sqlite
      .prepare(
        'UPDATE provider_settings SET base_url=?,model=?,encrypted_api_key=?,timeout_seconds=?,chunk_characters=?,translation_concurrency=?,revision=revision+? WHERE id=1',
      )
      .run(baseUrl, model, encrypted, timeout, chunk, concurrency, providerChanged ? 1 : 0);
    if (providerChanged)
      sqlite
        .prepare("UPDATE jobs SET status='cancelled',updated_at=? WHERE kind='translate_chapter' AND status='queued'")
        .run(Date.now());
  })();
  return getProviderSettings();
}

export function setAutomaticPause(paused: boolean): ProviderSettingsView {
  getDatabase()
    .sqlite.prepare('UPDATE provider_settings SET automatic_paused=? WHERE id=1')
    .run(paused ? 1 : 0);
  return getProviderSettings();
}

export function assertEncryptionConfiguration(): void {
  secretKey();
}

interface SourceSettingsRow {
  source_id: string;
  enabled: number;
  request_interval_ms: number;
  download_concurrency: number;
  next_request_at: number;
  last_error: string | null;
  last_checked_at: number | null;
}

export function listSourceSettings() {
  const adapters = listSourceAdapters();
  const sqlite = getDatabase().sqlite;
  const insert = sqlite.prepare('INSERT OR IGNORE INTO source_settings(source_id) VALUES (?)');
  sqlite.transaction(() => {
    for (const adapter of adapters) insert.run(adapter.id);
  })();
  const rows = getDatabase()
    .sqlite.prepare(
      'SELECT source_id,enabled,request_interval_ms,download_concurrency,next_request_at,last_error,last_checked_at FROM source_settings ORDER BY source_id',
    )
    .all() as SourceSettingsRow[];
  const settings = new Map(rows.map((value) => [value.source_id, value]));
  return adapters.map((adapter) => {
    const value = settings.get(adapter.id);
    return {
      id: adapter.id,
      sourceId: adapter.id,
      name: adapter.name,
      siteUrl: adapter.siteUrl,
      version: adapter.version,
      enabled: value?.enabled === 1,
      requestIntervalMs: value?.request_interval_ms ?? 2000,
      downloadConcurrency: value?.download_concurrency ?? 2,
      nextRequestAt: value?.next_request_at ?? 0,
      lastError: value?.last_error ?? null,
      lastCheckedAt: value?.last_checked_at ?? null,
    };
  });
}

export function updateSourceSettings(
  sourceId: string,
  input: {
    enabled?: boolean | undefined;
    requestIntervalMs?: number | undefined;
    downloadConcurrency?: number | undefined;
  },
) {
  if (!listSourceSettings().some((source) => source.sourceId === sourceId))
    throw new AppError('SOURCE_NOT_FOUND', 'Source not found', 404);
  if (
    input.requestIntervalMs !== undefined &&
    (!Number.isInteger(input.requestIntervalMs) || input.requestIntervalMs < 2000)
  )
    throw new AppError('INVALID_SOURCE_INTERVAL', 'Source interval must be at least 2000ms');
  if (
    input.downloadConcurrency !== undefined &&
    (!Number.isInteger(input.downloadConcurrency) || input.downloadConcurrency < 1 || input.downloadConcurrency > 20)
  )
    throw new AppError('INVALID_SOURCE_CONCURRENCY', 'Parallel downloads must be between 1 and 20');
  getDatabase()
    .sqlite.prepare(
      'UPDATE source_settings SET enabled=COALESCE(?,enabled),request_interval_ms=COALESCE(?,request_interval_ms),download_concurrency=COALESCE(?,download_concurrency) WHERE source_id=?',
    )
    .run(
      input.enabled === undefined ? null : input.enabled ? 1 : 0,
      input.requestIntervalMs ?? null,
      input.downloadConcurrency ?? null,
      sourceId,
    );
  return listSourceSettings().find((item) => item.sourceId === sourceId);
}

export function queueSourceCheck(sourceId: string) {
  const source = listSourceSettings().find((item) => item.sourceId === sourceId);
  if (!source) throw new AppError('SOURCE_NOT_FOUND', 'Source not found', 404);
  if (!source.enabled) throw new AppError('SOURCE_DISABLED', 'Enable this source before testing it', 409);
  return enqueueJob({
    kind: 'source_check',
    payload: { sourceId },
    dedupeKey: `source-check:${sourceId}`,
    origin: 'manual',
  });
}
