'use client';
import { Settings2, Volume2 } from 'lucide-react';
import { useState } from 'react';
import { SettingsClient } from './settings-client';
import { TtsSettingsPanel } from './tts-settings-panel';

type Section = 'application' | 'tts';

export function SettingsHubClient() {
  const [section, setSection] = useState<Section>('application');
  return (
    <>
      <section className="mb-8 flex items-end justify-between gap-8 max-[760px]:flex-col max-[760px]:items-start max-[760px]:gap-5">
        <div className="max-w-[760px]">
          <div className="mb-2.5 text-[11px] font-extrabold uppercase tracking-[.15em] text-accent-ink">Configuration</div>
          <h1>Settings</h1>
          <p className="mt-[13px] max-w-[660px] text-muted">Configure the application, providers, reader defaults, and narration experience.</p>
        </div>
      </section>
      <div className="mb-5 flex w-fit max-w-full overflow-x-auto rounded-[11px] border border-line bg-paper-raised p-[3px]" aria-label="Settings area">
        <button
          className={`flex min-h-[36px] items-center gap-2 whitespace-nowrap rounded-lg border-0 bg-transparent px-[13px] text-[13px] font-[650] text-muted hover:text-ink ${section === 'application' ? 'bg-card text-ink-strong shadow-[0_1px_4px_rgb(0_0_0/10%)]' : ''}`}
          onClick={() => setSection('application')}
        >
          <Settings2 size={15} /> Application
        </button>
        <button
          className={`flex min-h-[36px] items-center gap-2 whitespace-nowrap rounded-lg border-0 bg-transparent px-[13px] text-[13px] font-[650] text-muted hover:text-ink ${section === 'tts' ? 'bg-card text-ink-strong shadow-[0_1px_4px_rgb(0_0_0/10%)]' : ''}`}
          onClick={() => setSection('tts')}
        >
          <Volume2 size={15} /> Text to speech
        </button>
      </div>
      {section === 'application' ? (
        <div className="[&>section:first-child]:hidden">
          <SettingsClient />
        </div>
      ) : (
        <TtsSettingsPanel />
      )}
    </>
  );
}
