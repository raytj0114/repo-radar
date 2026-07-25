import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'RepoRadar',
    template: '%s | RepoRadar',
  },
  description: 'GitHubリポジトリのリリース・トレンドを追跡し、AIがリリースノートを日本語要約',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen bg-white text-gray-900 antialiased">{children}</body>
    </html>
  );
}
