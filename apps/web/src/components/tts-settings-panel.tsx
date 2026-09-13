'use client';
import { CheckCircle2, Loader2, Play, Save, Volume2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface TtsSettings {
  baseUrl: string | null;
  model: string | null;
  language: string | null;
  voice: string;
  speed: number;
  pitch: number;
  timeoutSeconds: number;
  revision: number;
  hasApiKey: boolean;
}

interface TtsModelOption {
  id: string;
  label: string;
}
interface TtsVoiceOption {
  id: string;
  label: string;
  language: string | null;
  locale: string | null;
  gender: string | null;
}
interface TtsCatalog {
  models: TtsModelOption[];
  voices: TtsVoiceOption[];
}
const inputClass =
  'w-full rounded-[10px] border border-line bg-card px-[13px] py-[11px] text-ink outline-none transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-muted/70 hover:border-line-strong focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-accent)_18%,transparent)]';
const panelClass = 'rounded-[15px] border border-line bg-card p-[22px] text-ink shadow-card max-[760px]:p-[17px]';
const fieldClass = 'grid gap-[7px] text-xs font-[720] text-ink';
const buttonClass =
  'inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border border-line bg-card px-3.5 text-[13px] font-bold text-ink transition-[transform,border-color,background-color,box-shadow] duration-150 enabled:hover:-translate-y-px enabled:hover:border-line-strong enabled:hover:bg-card-hover enabled:hover:shadow-button disabled:cursor-not-allowed disabled:opacity-60';
const primaryButtonClass =
  'inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border border-accent bg-accent px-3.5 text-[13px] font-bold text-white shadow-[0_7px_18px_color-mix(in_srgb,var(--color-accent)_22%,transparent)] transition-[transform,border-color,background-color] duration-150 enabled:hover:-translate-y-px enabled:hover:border-accent-hover enabled:hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60';
const switchClass =
  "h-6 w-11 shrink-0 rounded-full border-0 bg-line-strong p-[3px] after:block after:size-[18px] after:rounded-full after:bg-white after:shadow-[0_1px_3px_rgb(0_0_0/25%)] after:transition-transform after:duration-200 after:content-['']";

function isTtsSettings(value: unknown): value is TtsSettings {
  return !!value && typeof value === 'object' && 'voice' in value && 'speed' in value && 'pitch' in value;
}

function apiError(value: unknown, fallback: string): string {
  if (!value || typeof value !== 'object' || !('error' in value)) return fallback;
  const error = value.error;
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
    ? error.message
    : fallback;
}

function isTtsCatalog(value: unknown): value is TtsCatalog {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.models) && Array.isArray(record.voices);
}

export function TtsSettingsPanel() {
  const [settings, setSettings] = useState<TtsSettings | null>(null);
  const [catalog, setCatalog] = useState<TtsCatalog>({ models: [], voices: [] });
  const [availableLanguages, setAvailableLanguages] = useState<string[]>([]);
  const [language, setLanguage] = useState('all');
  const [apiKey, setApiKey] = useState('');
  const [autoNext, setAutoNext] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  async function loadCatalog() {
    const response = await fetch('/api/settings/tts/catalog', { cache: 'no-store' });
    const value: unknown = await response.json();
    if (response.ok && isTtsCatalog(value)) {
      setCatalog(value);
      setAvailableLanguages(
        Array.from(
          new Set(
            value.voices.flatMap((voice) =>
              [voice.locale, voice.language].filter((item): item is string => Boolean(item)),
            ),
          ),
        ).sort(),
      );
    }
  }

  async function loadVoices(selectedLanguage: string): Promise<TtsVoiceOption[]> {
    if (selectedLanguage === 'all') {
      await loadCatalog();
      return [];
    }
    const response = await fetch(`/api/settings/tts/catalog?language=${encodeURIComponent(selectedLanguage)}`, {
      cache: 'no-store',
    });
    const value: unknown = await response.json();
    if (response.ok && isTtsCatalog(value)) {
      setCatalog((current) => ({ ...current, voices: value.voices }));
      return value.voices;
    }
    return [];
  }

  useEffect(() => {
    setAutoNext(localStorage.getItem('reader-tts-auto-next') !== 'false');
    void (async () => {
      const response = await fetch('/api/settings/tts', { cache: 'no-store' });
      const value: unknown = await response.json();
      if (response.ok && isTtsSettings(value)) {
        setSettings(value);
        setLanguage(value.language ?? 'all');
      } else setError(apiError(value, 'Could not load TTS settings.'));
    })();
    void loadCatalog();
    return () => {
      audioRef.current?.pause();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!settings || saving) return;
    setSaving(true);
    setError('');
    setMessage('');
    const response = await fetch('/api/settings/tts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: settings.baseUrl,
        model: settings.model,
        language: language === 'all' ? null : language,
        voice: settings.voice,
        speed: settings.speed,
        pitch: settings.pitch,
        timeoutSeconds: settings.timeoutSeconds,
        ...(apiKey ? { apiKey } : {}),
      }),
    });
    const value: unknown = await response.json();
    if (response.ok && isTtsSettings(value)) {
      setSettings(value);
      setApiKey('');
      void loadCatalog();
      setMessage('TTS provider settings saved.');
    } else setError(apiError(value, 'Could not save TTS settings.'));
    setSaving(false);
  }

  async function testVoice() {
    if (testing) return;
    setTesting(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/tts/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'This is a preview of your novel narration voice.' }),
      });
      if (!response.ok) {
        const value: unknown = await response.json().catch(() => null);
        throw new Error(apiError(value, 'TTS provider test failed.'));
      }
      audioRef.current?.pause();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const objectUrl = URL.createObjectURL(await response.blob());
      objectUrlRef.current = objectUrl;
      const audio = new Audio(objectUrl);
      audioRef.current = audio;
      await audio.play();
      setMessage('Voice preview is playing.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'TTS provider test failed.');
    } finally {
      setTesting(false);
    }
  }

  if (!settings)
    return (
      <div className="rounded-[15px] border border-dashed border-line-strong bg-card/60 px-6 py-16 text-center text-muted">
        {error || 'Loading TTS settings…'}
      </div>
    );

  const configured = Boolean(settings.baseUrl && settings.model && settings.hasApiKey);
  const visibleVoices = catalog.voices;
  const voiceOptions = visibleVoices.some((voice) => voice.id === settings.voice)
    ? visibleVoices
    : [
        { id: settings.voice, label: `${settings.voice} (saved)`, language: null, locale: null, gender: null },
        ...visibleVoices,
      ];
  const modelOptions = catalog.models.some((model) => model.id === settings.model)
    ? catalog.models
    : settings.model
      ? [{ id: settings.model, label: `${settings.model} (saved)` }, ...catalog.models]
      : catalog.models;
  return (
    <div className="grid gap-4">
      {message && (
        <div
          className="rounded-[10px] border border-[color-mix(in_srgb,var(--color-success)_30%,var(--color-line))] bg-[color-mix(in_srgb,var(--color-success)_8%,var(--color-card))] px-3.5 py-3 text-success"
          role="status"
        >
          {message}
        </div>
      )}
      {error && (
        <div
          className="rounded-[10px] border border-[color-mix(in_srgb,var(--color-danger)_35%,var(--color-line))] bg-danger-soft px-3.5 py-3 text-danger"
          role="alert"
        >
          {error}
        </div>
      )}
      <form className={`${panelClass} grid gap-5`} onSubmit={save}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <Volume2 size={18} className="text-accent-ink" />
              <h2>Text-to-speech provider</h2>
            </div>
            <p className="max-w-170 text-sm text-muted">
              OpenAI-compatible speech endpoint used by the novel reader. The API key is encrypted at rest and never
              sent to the browser.
            </p>
          </div>
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${configured ? 'bg-[color-mix(in_srgb,var(--color-success)_12%,var(--color-card))] text-success' : 'bg-paper-raised text-muted'}`}
          >
            {configured ? 'Configured' : 'Not configured'}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3.5 max-[760px]:grid-cols-1">
          <label className={fieldClass}>
            OpenAI-compatible base URL
            <input
              className={inputClass}
              type="url"
              required
              placeholder="https://api.openai.com/v1"
              value={settings.baseUrl ?? ''}
              onChange={(event) => setSettings({ ...settings, baseUrl: event.target.value })}
            />
          </label>
          <label className={fieldClass}>
            Model
            <select
              className={inputClass}
              required
              value={settings.model ?? ''}
              onChange={(event) => setSettings({ ...settings, model: event.target.value })}
            >
              <option value="">Select a model</option>
              {modelOptions.map((model) => (
                <option value={model.id} key={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
          <label className={fieldClass}>
            API key
            <input
              className={inputClass}
              type="password"
              placeholder={settings.hasApiKey ? 'Stored — enter to replace' : 'Required'}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
            />
          </label>
          <label className={fieldClass}>
            Language / locale
            <select
              className={inputClass}
              value={language}
              onChange={(event) => {
                const selectedLanguage = event.target.value;
                setLanguage(selectedLanguage);
                void loadVoices(selectedLanguage).then((voices) => {
                  const firstVoice = voices[0];
                  if (firstVoice) setSettings((current) => (current ? { ...current, voice: firstVoice.id } : current));
                });
              }}
            >
              <option value="all">All languages</option>
              {availableLanguages.map((value) => (
                <option value={value} key={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className={fieldClass}>
            Voice
            <select
              className={inputClass}
              required
              value={settings.voice}
              onChange={(event) => setSettings({ ...settings, voice: event.target.value })}
            >
              {voiceOptions.map((voice) => (
                <option value={voice.id} key={voice.id}>
                  {voice.label}
                  {voice.locale ? ` (${voice.locale})` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className={fieldClass}>
            Timeout (seconds)
            <input
              className={inputClass}
              type="number"
              min="10"
              max="300"
              value={settings.timeoutSeconds}
              onChange={(event) => setSettings({ ...settings, timeoutSeconds: Number(event.target.value) })}
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-5 max-[760px]:grid-cols-1">
          <label className={fieldClass}>
            <span className="flex items-center justify-between gap-3">
              <span>Speed</span>
              <strong>{settings.speed.toFixed(2)}×</strong>
            </span>
            <input
              className="accent-[var(--color-accent)]"
              type="range"
              min="0.25"
              max="4"
              step="0.05"
              value={settings.speed}
              onChange={(event) => setSettings({ ...settings, speed: Number(event.target.value) })}
            />
            <span className="font-normal text-muted">Sent as the standard OpenAI-compatible speed parameter.</span>
          </label>
          <label className={fieldClass}>
            <span className="flex items-center justify-between gap-3">
              <span>Pitch</span>
              <strong>
                {settings.pitch > 0 ? '+' : ''}
                {settings.pitch} st
              </strong>
            </span>
            <input
              className="accent-[var(--color-accent)]"
              type="range"
              min="-12"
              max="12"
              step="1"
              value={settings.pitch}
              onChange={(event) => setSettings({ ...settings, pitch: Number(event.target.value) })}
            />
            <span className="font-normal text-muted">
              Pitch is expressed through speech instructions. Legacy TTS models may ignore it.
            </span>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-[9px]">
          <button className={primaryButtonClass} type="submit" disabled={saving}>
            {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
            {saving ? 'Saving…' : 'Save TTS provider'}
          </button>
          <button
            className={buttonClass}
            type="button"
            disabled={testing || !configured}
            onClick={() => void testVoice()}
          >
            {testing ? <Loader2 className="animate-spin" size={16} /> : <Play size={16} />}
            {testing ? 'Generating…' : 'Test saved voice'}
          </button>
        </div>
        <p className="text-xs text-muted">
          The voice preview uses the last saved provider settings. Save changes before testing them.
        </p>
      </form>
      <section className={panelClass}>
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <CheckCircle2 size={17} className="text-accent-ink" />
              <strong>Continuous reading</strong>
            </div>
            <p className="max-w-[640px] text-sm text-muted">
              When narration reaches the end of a chapter, continue into the next available chapter automatically.
            </p>
          </div>
          <button
            className={`${switchClass} ${autoNext ? 'bg-success after:translate-x-5' : ''}`}
            type="button"
            role="switch"
            aria-checked={autoNext}
            aria-label="Automatically continue to the next chapter"
            onClick={() => {
              const next = !autoNext;
              setAutoNext(next);
              localStorage.setItem('reader-tts-auto-next', String(next));
            }}
          />
        </div>
      </section>
    </div>
  );
}
