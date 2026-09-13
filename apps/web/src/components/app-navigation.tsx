'use client';

import Link from 'next/link';
import { BookOpenText, Library, ListTodo, Menu, Moon, Settings, Sun, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const links = [
  { href: '/', label: 'Library', icon: Library },
  { href: '/activity', label: 'Activity', icon: ListTodo },
  { href: '/settings', label: 'Settings', icon: Settings },
];

function ThemeButton({ compact = false }: { compact?: boolean }) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.dataset.theme === 'dark');
  }, []);

  function toggleTheme() {
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('app-theme', next);
    setDark(!dark);
  }

  const Icon = dark ? Sun : Moon;
  return (
    <button
      className={`inline-flex min-h-10 items-center justify-center gap-[9px] rounded-[10px] border border-line bg-transparent text-[13px] font-[650] text-muted hover:bg-sidebar-hover hover:text-ink ${
        compact ? 'w-10 px-0' : 'px-[11px]'
      }`}
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${dark ? 'light' : 'dark'} theme`}
      title={`Switch to ${dark ? 'light' : 'dark'} theme`}
    >
      <Icon size={16} />
      {!compact && <span>{dark ? 'Light theme' : 'Dark theme'}</span>}
    </button>
  );
}

function NavigationLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav
      className="grid gap-[5px] [&_a]:flex [&_a]:min-h-[43px] [&_a]:items-center [&_a]:gap-[11px] [&_a]:rounded-[11px] [&_a]:border [&_a]:border-transparent [&_a]:px-3 [&_a]:text-sm [&_a]:font-semibold [&_a]:text-muted [&_a]:transition-[color,background-color,border-color,transform] [&_a]:duration-150 [&_a:hover]:bg-sidebar-hover [&_a:hover]:text-ink [&_a[aria-current=page]]:border-line [&_a[aria-current=page]]:bg-sidebar-active [&_a[aria-current=page]]:text-ink-strong [&_a[aria-current=page]]:shadow-[0_1px_3px_rgb(0_0_0/5%)] [&_a[aria-current=page]_svg]:text-accent"
      aria-label="Primary navigation"
    >
      {links.map(({ href, label, icon: Icon }) => {
        const active = href === '/' ? pathname === '/' || pathname.startsWith('/novels/') : pathname.startsWith(href);
        return (
          <Link
            href={href}
            key={href}
            aria-current={active ? 'page' : undefined}
            {...(onNavigate ? { onClick: onNavigate } : {})}
          >
            <Icon size={17} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function AppNavigation() {
  const [menuOpen, setMenuOpen] = useState(false);
  const brand = (
    <>
      <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-ink-strong text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/12%)] dark:bg-[#f5f5f6] dark:text-[#111113] max-[760px]:size-[34px]">
        <BookOpenText size={19} />
      </span>
      <span className="grid gap-0.5">
        <strong className="font-[750] tracking-[-.02em]">Novel</strong>
        <small className="text-[11px] font-semibold uppercase tracking-[.14em] text-muted">Library</small>
      </span>
    </>
  );

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-20 flex w-[248px] flex-col justify-between border-r border-line bg-sidebar px-[18px] pt-[27px] pb-5 max-[960px]:w-[218px] max-[760px]:hidden">
        <div>
          <Link
            className="inline-flex min-w-0 items-center gap-[11px] text-[15px] leading-[1.1] text-ink-strong"
            href="/"
          >
            {brand}
          </Link>
          <div className="mx-3 mt-[38px] mb-2.5 text-[10px] font-[750] uppercase tracking-[.16em] text-muted">
            Workspace
          </div>
          <NavigationLinks />
        </div>
        <div className="grid gap-3 border-t border-line pt-[17px]">
          <div className="flex items-center gap-[9px] px-[9px] text-xs text-muted">
            <span className="inline-block size-[7px] shrink-0 rounded-full bg-success shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-success)_14%,transparent)]" />
            <span>Private workspace</span>
          </div>
          <ThemeButton />
        </div>
      </aside>
      <header className="sticky top-0 z-30 hidden h-16 items-center justify-between border-b border-line bg-[color-mix(in_srgb,var(--color-sidebar)_90%,transparent)] px-3.5 backdrop-blur-2xl max-[760px]:flex">
        <Link
          className="inline-flex min-w-0 items-center gap-[11px] text-[15px] leading-[1.1] text-ink-strong"
          href="/"
        >
          {brand}
        </Link>
        <div className="flex gap-[7px]">
          <ThemeButton compact />
          <button
            className="inline-flex min-h-10 items-center justify-center rounded-[10px] border border-line bg-transparent px-[11px] text-muted hover:bg-sidebar-hover hover:text-ink"
            type="button"
            aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
        {menuOpen && (
          <div className="absolute top-14 right-3.5 w-[210px] rounded-[13px] border border-line bg-card p-2 shadow-float">
            <NavigationLinks onNavigate={() => setMenuOpen(false)} />
          </div>
        )}
      </header>
    </>
  );
}
