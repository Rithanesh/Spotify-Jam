import './globals.css';
import { ThemeProvider } from '../components/ThemeProvider';

export const metadata = {
  title: 'Spotify Jam App',
  description: 'Shared queue jamming for one speaker, everyone\u2019s picks.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
