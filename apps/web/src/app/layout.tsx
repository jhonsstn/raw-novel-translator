import type { Metadata } from 'next';
import { AppNavigation } from '../components/app-navigation';
import './globals.css';

export const metadata: Metadata = {
  title: 'Novel Library',
  description: 'Your private Chinese novel library and translation workspace',
};

const preferencesScript = `(function(){try{var savedTheme=localStorage.getItem('app-theme');var theme=savedTheme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=theme;var sidebar=localStorage.getItem('workspace-sidebar');document.documentElement.dataset.workspaceSidebar=sidebar==='closed'?'closed':'open'}catch(e){}})()`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: preferencesScript }} />
      </head>
      <body>
        <AppNavigation />
        <div className="workspace-content min-h-screen ml-[248px] transition-[margin] duration-200 max-[960px]:ml-[218px] max-[760px]:ml-0">
          {children}
        </div>
      </body>
    </html>
  );
}
