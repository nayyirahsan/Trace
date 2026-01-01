import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Trace — Structured Log Explorer',
  description: 'Reconstruct request narratives across services from raw JSON logs',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
