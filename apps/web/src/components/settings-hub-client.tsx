'use client';
import { Activity, Bot, BookOpen, Globe2, Volume2, Zap } from 'lucide-react';
import { useState } from 'react';
import { SettingsClient } from './settings-client';
import { TtsSettingsPanel } from './tts-settings-panel';

type Section = 'General' | 'Provider' | 'Sources' | 'Automation' | 'Reader' | 'tts';

const navigation = [
  {
    label: 'System',
    items: [{ id: 'General', label: 'Worker', icon: Activity }],
  },
  {
    label: 'Translation',
    items: [
      { id: 'Provider', label: 'Provider', icon: Bot },
      { id: 'Sources', label: 'Sources', icon: Globe2 },
      { id: 'Automation', label: 'Automation', icon: Zap },
    ],
  },
  {
    label: 'Reading',
    items: [
      { id: 'Reader', label: 'Reader', icon: BookOpen },
      { id: 'tts', label: 'Text to speech', icon: Volume2 },
    ],
  },
] as const;

export function SettingsHubClient() {
  const [section, setSection] = useState<Section>('General');

  return (
    <>
      <section className="mb-8 flex items-end justify-between gap-8 max-[760px]:flex-col max-[760px]:items-start max-[760px]:gap-5">
        <div className="max-w-[760px]">
          <div className="mb-2.5 text-[11px] font-extrabold uppercase tracking-[.15em] text-accent-ink">
            Configuration
          </div>
          <h1>Settings</h1>
          <p className="mt-[13px] max-w-[660px] text-muted">
            Configure translation, sources, reader defaults, and narration.
          </p>
        </div>
      </section>

      <div className="grid grid-cols-[210px_minmax(0,1fr)] items-start gap-6 max-[860px]:grid-cols-1">
        <nav
          className="sticky top-5 rounded-[15px] border border-line bg-card p-2 shadow-card max-[860px]:static"
          aria-label="Settings sections"
        >
          {navigation.map((group, groupIndex) => (
            <div key={group.label} className={groupIndex === 0 ? '' : 'mt-2 border-t border-line pt-2'}>
              <div className="px-3 pb-1.5 pt-1 text-[10px] font-extrabold uppercase tracking-[.13em] text-muted">
                {group.label}
              </div>
              <div className="grid gap-1 max-[860px]:grid-cols-2 max-[520px]:grid-cols-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = section === item.id;

                  return (
                    <button
                      key={item.id}
                      className={`flex min-h-10 w-full items-center gap-2.5 rounded-[10px] border-0 px-3 text-left text-[13px] font-[680] transition-colors ${
                        active
                          ? 'bg-accent-soft text-accent-ink'
                          : 'bg-transparent text-muted hover:bg-paper-raised hover:text-ink'
                      }`}
                      aria-current={active ? 'page' : undefined}
                      onClick={() => setSection(item.id)}
                    >
                      <Icon size={16} aria-hidden="true" />
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="min-w-0">{section === 'tts' ? <TtsSettingsPanel /> : <SettingsClient tab={section} />}</div>
      </div>
    </>
  );
}
