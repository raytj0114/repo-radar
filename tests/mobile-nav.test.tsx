import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MobileNav } from '@/components/layout/mobile-nav';

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { children: ReactNode }) => (
    <a {...props}>{children}</a>
  ),
}));

afterEach(cleanup);

const signOutAction = vi.fn(async () => {});

function renderNav() {
  render(<MobileNav signOutAction={signOutAction} />);
  return screen.getByRole('button', { name: 'メニューを開く' });
}

describe('MobileNav', () => {
  it('初期状態ではパネルを表示しない', () => {
    const trigger = renderNav();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('開くとナビリンクとログアウトが操作できる', () => {
    const trigger = renderNav();
    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByRole('dialog', { name: 'メニュー' });
    expect(panel).toHaveAttribute('id', 'mobile-nav-panel');
    expect(trigger).toHaveAttribute('aria-controls', 'mobile-nav-panel');

    expect(screen.getByRole('link', { name: 'ダッシュボード' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'トレンド' })).toHaveAttribute('href', '/trending');
    expect(screen.getByRole('link', { name: 'ダイジェスト' })).toHaveAttribute('href', '/digest');
    expect(screen.getByRole('button', { name: 'ログアウト' })).toHaveAttribute('type', 'submit');
  });

  it('開いた直後は先頭のリンクにフォーカスする', () => {
    fireEvent.click(renderNav());
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'ダッシュボード' }));
  });

  it('Escで閉じてトリガーへフォーカスを戻す', () => {
    const trigger = renderNav();
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('Tabでフォーカスがパネル内を循環する', () => {
    fireEvent.click(renderNav());
    const first = screen.getByRole('link', { name: 'ダッシュボード' });
    const last = screen.getByRole('button', { name: 'ログアウト' });

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('リンクを押すとメニューを閉じる', () => {
    fireEvent.click(renderNav());
    fireEvent.click(screen.getByRole('link', { name: 'トレンド' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
