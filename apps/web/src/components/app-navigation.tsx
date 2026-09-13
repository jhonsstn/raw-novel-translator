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
  return <button className={`theme-toggle${compact ? ' compact' : ''}`} type="button" onClick={toggleTheme} aria-label={`Switch to ${dark ? 'light' : 'dark'} theme`} title={`Switch to ${dark ? 'light' : 'dark'} theme`}>
    <Icon size={16}/>{!compact&&<span>{dark ? 'Light theme' : 'Dark theme'}</span>}
  </button>;
}

function NavigationLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return <nav aria-label="Primary navigation">{links.map(({ href, label, icon: Icon }) => {
    const active = href === '/' ? pathname === '/' || pathname.startsWith('/novels/') : pathname.startsWith(href);
    return <Link href={href} key={href} className={active ? 'active' : undefined} aria-current={active ? 'page' : undefined} {...(onNavigate ? { onClick: onNavigate } : {})}>
      <Icon size={17}/><span>{label}</span>
    </Link>;
  })}</nav>;
}

export function AppNavigation() {
  const [menuOpen, setMenuOpen] = useState(false);
  return <>
    <aside className="sidebar">
      <div>
        <Link className="brand" href="/"><span className="brand-mark"><BookOpenText size={19}/></span><span><strong>Novel</strong><small>Library</small></span></Link>
        <div className="nav-label">Workspace</div>
        <NavigationLinks/>
      </div>
      <div className="sidebar-footer"><div className="sidebar-note"><span className="status-dot ready"/><span>Private workspace</span></div><ThemeButton/></div>
    </aside>
    <header className="mobilebar">
      <Link className="brand" href="/"><span className="brand-mark"><BookOpenText size={18}/></span><span><strong>Novel</strong><small>Library</small></span></Link>
      <div className="mobile-actions"><ThemeButton compact/><button className="menu-toggle" type="button" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}>{menuOpen ? <X size={20}/> : <Menu size={20}/>}</button></div>
      {menuOpen&&<div className="mobile-menu"><NavigationLinks onNavigate={() => setMenuOpen(false)}/></div>}
    </header>
  </>;
}
