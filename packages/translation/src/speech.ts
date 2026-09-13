import OpenAI from 'openai';
import { providerFetch } from './client.js';

export interface SpeechInput {
  text: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  voice: string;
  speed: number;
  instructions?: string | undefined;
  timeoutMs: number;
  signal: AbortSignal;
}

export interface SpeechResult {
  bytes: Uint8Array;
  contentType: string;
}

export async function synthesizeSpeech(input: SpeechInput): Promise<SpeechResult> {
  const client = new OpenAI({
    apiKey: input.apiKey,
    baseURL: input.baseUrl,
    timeout: input.timeoutMs,
    maxRetries: 1,
    fetch: providerFetch(input.baseUrl),
  });
  const response = await client.audio.speech.create(
    {
      model: input.model,
      voice: input.voice,
      input: input.text,
      response_format: 'mp3',
      speed: input.speed,
      ...(input.instructions ? { instructions: input.instructions } : {}),
    },
    { signal: input.signal },
  );
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    contentType: 'audio/mpeg',
  };
}
