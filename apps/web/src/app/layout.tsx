import type { Metadata } from 'next';
import Link from 'next/link';
import { BookOpenText, Library, ListTodo, Menu, Settings } from 'lucide-react';
import './globals.css';

export const metadata: Metadata = { title: 'Novel Library', description: 'Private Chinese novel library and translator' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>
    <aside className="sidebar"><Link className="brand" href="/"><BookOpenText size={22}/><span>Novel Library</span></Link><nav><Link href="/"><Library size={17}/><span>Library</span></Link><Link href="/activity"><ListTodo size={17}/><span>Activity</span></Link><Link href="/settings"><Settings size={17}/><span>Settings</span></Link></nav></aside>
    <header className="mobilebar"><Link className="brand" href="/"><BookOpenText size={22}/><span>Novel Library</span></Link><details><summary aria-label="Open navigation"><Menu size={22}/></summary><nav><Link href="/"><Library size={17}/>Library</Link><Link href="/activity"><ListTodo size={17}/>Activity</Link><Link href="/settings"><Settings size={17}/>Settings</Link></nav></details></header>
    <div className="app-shell">{children}</div>
  </body></html>;
}
