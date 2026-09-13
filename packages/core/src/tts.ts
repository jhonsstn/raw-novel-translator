import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getDatabase } from '@novel/db';
import { synthesizeSpeech, type SpeechResult } from '@novel/translation';
import { AppError } from './errors.js';

export interface TtsSettingsView {
  baseUrl: string | null;
  model: string | null;
  voice: string;
  speed: number;
  pitch: number;
  timeoutSeconds: number;
  revision: number;
  hasApiKey: boolean;
}

export interface TtsCredentials extends TtsSettingsView {
  baseUrl: string;
  model: string;
  apiKey: string;
  hasApiKey: true;
}

export interface UpdateTtsSettingsInput {
  baseUrl?: string | null | undefined;
  model?: string | null | undefined;
  apiKey?: string | undefined;
  clearApiKey?: boolean | undefined;
  voice?: string | undefined;
  speed?: number | undefined;
  pitch?: number | undefined;
  timeoutSeconds?: number | undefined;
}

interface TtsRow {
  base_url: string | null;
  model: string | null;
  encrypted_api_key: string | null;
  voice: string;
  speed: number;
  pitch: number;
  timeout_seconds: number;
  revision: number;
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
  if (!nonce || !tag || !ciphertext) throw new Error('Stored TTS provider credential is invalid');
  const decipher = createDecipheriv('aes-256-gcm', secretKey(), nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function row(): TtsRow {
  const value = getDatabase().sqlite.prepare('SELECT * FROM tts_settings WHERE id=1').get();
  if (!value) throw new Error('TTS settings are not initialized');
  return value as TtsRow;
}

function validateBaseUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AppError('INVALID_TTS_URL', 'Enter a valid TTS provider base URL');
  }
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && url.protocol !== 'http:'))
    throw new AppError(
      'INVALID_TTS_URL',
      'TTS provider URL must be an HTTP(S) origin/path without credentials, query, or fragment',
    );
  const exceptions = (process.env.AI_ALLOWED_PRIVATE_ORIGINS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (url.protocol !== 'https:' && !exceptions.includes(url.origin))
    throw new AppError('INVALID_TTS_URL', 'HTTP TTS providers require an exact AI_ALLOWED_PRIVATE_ORIGINS entry');
  return url.href.replace(/\/$/, '');
}

export function getTtsSettings(): TtsSettingsView {
  const value = row();
  return {
    baseUrl: value.base_url,
    model: value.model,
    voice: value.voice,
    speed: value.speed,
    pitch: value.pitch,
    timeoutSeconds: value.timeout_seconds,
    revision: value.revision,
    hasApiKey: value.encrypted_api_key !== null,
  };
}

export function getTtsCredentials(): TtsCredentials {
  const value = row();
  if (!value.base_url || !value.model || !value.encrypted_api_key)
    throw new AppError('TTS_NOT_CONFIGURED', 'Configure the text-to-speech provider first', 409);
  return {
    ...getTtsSettings(),
    baseUrl: value.base_url,
    model: value.model,
    apiKey: decrypt(value.encrypted_api_key),
    hasApiKey: true,
  };
}

export function updateTtsSettings(input: UpdateTtsSettingsInput): TtsSettingsView {
  if (input.apiKey !== undefined && input.clearApiKey)
    throw new AppError('INVALID_TTS_SETTINGS', 'Cannot set and clear the TTS API key together');
  const current = row();
  const baseUrl =
    input.baseUrl === undefined ? current.base_url : input.baseUrl ? validateBaseUrl(input.baseUrl) : null;
  const model = input.model === undefined ? current.model : input.model?.trim() || null;
  const voice = input.voice === undefined ? current.voice : input.voice.trim();
  const speed = input.speed ?? current.speed;
  const pitch = input.pitch ?? current.pitch;
  const timeout = input.timeoutSeconds ?? current.timeout_seconds;
  if (!voice || voice.length > 100) throw new AppError('INVALID_TTS_VOICE', 'Voice must be 1–100 characters');
  if (!Number.isFinite(speed) || speed < 0.25 || speed > 4)
    throw new AppError('INVALID_TTS_SPEED', 'TTS speed must be between 0.25× and 4×');
  if (!Number.isInteger(pitch) || pitch < -12 || pitch > 12)
    throw new AppError('INVALID_TTS_PITCH', 'TTS pitch must be between -12 and +12 semitones');
  if (!Number.isInteger(timeout) || timeout < 10 || timeout > 300)
    throw new AppError('INVALID_TTS_TIMEOUT', 'TTS timeout must be between 10 and 300 seconds');
  const encrypted = input.clearApiKey
    ? null
    : input.apiKey !== undefined
      ? encrypt(input.apiKey)
      : current.encrypted_api_key;
  getDatabase()
    .sqlite.prepare(
      'UPDATE tts_settings SET base_url=?,model=?,encrypted_api_key=?,voice=?,speed=?,pitch=?,timeout_seconds=?,revision=revision+1 WHERE id=1',
    )
    .run(baseUrl, model, encrypted, voice, speed, pitch, timeout);
  return getTtsSettings();
}

function pitchInstructions(pitch: number): string | undefined {
  if (pitch === 0) return undefined;
  const direction = pitch > 0 ? 'higher' : 'lower';
  return `Use a ${direction} vocal pitch than your neutral voice, approximately ${Math.abs(pitch)} semitone${Math.abs(pitch) === 1 ? '' : 's'}. Keep the narration natural and do not change the wording.`;
}

export async function createTtsSpeech(text: string, signal: AbortSignal): Promise<SpeechResult> {
  const normalized = text.trim();
  if (!normalized) throw new AppError('INVALID_TTS_TEXT', 'Speech text cannot be empty');
  if (Array.from(normalized).length > 4096)
    throw new AppError('TTS_TEXT_TOO_LONG', 'Speech text must be 4,096 characters or fewer');
  const settings = getTtsCredentials();
  const timeoutSignal = AbortSignal.timeout(settings.timeoutSeconds * 1000);
  return synthesizeSpeech({
    text: normalized,
    model: settings.model,
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    voice: settings.voice,
    speed: settings.speed,
    instructions: pitchInstructions(settings.pitch),
    timeoutMs: settings.timeoutSeconds * 1000,
    signal: AbortSignal.any([signal, timeoutSignal]),
  });
}
