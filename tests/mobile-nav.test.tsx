import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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

// jsdomのmatchMediaはメディアクエリを評価しないため、ビューポート変化を手で起こせる形に差し替える
type MediaChangeListener = (event: MediaQueryListEvent) => void;
const mediaChangeListeners = new Set<MediaChangeListener>();

/** matchMediaが返す現在の評価結果。テストからビューポート幅の変化を模擬する */
let mdMatches = false;

/** md以上へリサイズされ、changeイベントも届いた状態にする */
function resizeToDesktop() {
  mdMatches = true;
  act(() => {
    for (const listener of mediaChangeListeners) {
      listener({ matches: true } as MediaQueryListEvent);
    }
  });
}

/** md以上へリサイズされたがchangeイベントが届かない環境（親がリサイズするiframe等）を模擬する */
function resizeToDesktopWithoutChangeEvent() {
  mdMatches = true;
}

beforeEach(() => {
  mdMatches = false;
  mediaChangeListeners.clear();
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return mdMatches;
    },
    media: query,
    addEventListener: (_type: string, listener: MediaChangeListener) =>
      mediaChangeListeners.add(listener),
    removeEventListener: (_type: string, listener: MediaChangeListener) =>
      mediaChangeListeners.delete(listener),
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

    expect(screen.getByRole('link', { name: '一面' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'トレンド' })).toHaveAttribute('href', '/trending');
    expect(screen.getByRole('link', { name: 'ダイジェスト' })).toHaveAttribute('href', '/digest');
    expect(screen.getByRole('button', { name: 'ログアウト' })).toHaveAttribute('type', 'submit');
  });

  it('開いた直後は先頭のリンクにフォーカスする', () => {
    fireEvent.click(renderNav());
    expect(document.activeElement).toBe(screen.getByRole('link', { name: '一面' }));
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
    const first = screen.getByRole('link', { name: '一面' });
    const last = screen.getByRole('button', { name: 'ログアウト' });

    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('md以上へリサイズされたらメニューを閉じる', () => {
    fireEvent.click(renderNav());
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    resizeToDesktop();

    // 開いたまま非表示になるとフォーカストラップがページ全体のTabを潰すため、状態も閉じる
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'メニューを開く' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });

  it('changeイベントが届かなくてもmd以上ならTabを奪わずメニューを閉じる', () => {
    fireEvent.click(renderNav());
    resizeToDesktopWithoutChangeEvent();

    // preventDefaultされるとブラウザ既定のフォーカス移動が消え、ページ全体のTabが死ぬ
    const notCancelled = fireEvent.keyDown(document, { key: 'Tab' });
    expect(notCancelled).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('リンクを押すとメニューを閉じる', () => {
    fireEvent.click(renderNav());
    fireEvent.click(screen.getByRole('link', { name: 'トレンド' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
