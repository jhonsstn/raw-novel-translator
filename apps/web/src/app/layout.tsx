import type { Metadata } from 'next';
import { AppNavigation } from '../components/app-navigation';
import './globals.css';

export const metadata: Metadata = {
  title: 'Novel Library',
  description: 'Your private Chinese novel library and translation workspace',
};

const themeScript = `(function(){try{var saved=localStorage.getItem('app-theme');var theme=saved||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=theme}catch(e){}})()`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <AppNavigation />
        <div className="app-shell">{children}</div>
      </body>
    </html>
  );
}
