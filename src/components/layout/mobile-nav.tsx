'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { navItems } from './nav-items';

/** フォーカストラップの対象。パネル内にはリンクとボタンしか置かない */
const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled])';

/**
 * md未満で表示するハンバーガーメニュー。
 * ログアウトはServer Actionをpropsで受け取り、デスクトップと同じフォーム送信で実行する。
 */
export function MobileNav({ signOutAction }: { signOutAction: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  /** 閉じたあとはトリガーへフォーカスを戻す（Esc・オーバーレイクリック用） */
  const closeAndRestoreFocus = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // 画面遷移したらメニューを閉じる（遷移先へフォーカスを渡すため復帰はしない）。
  // レンダー中のstate調整で行う（effectでのsetStateは連鎖レンダーになるため避ける）
  const [renderedPathname, setRenderedPathname] = useState(pathname);
  if (pathname !== renderedPathname) {
    setRenderedPathname(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;

    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeAndRestoreFocus();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const outside = !(active instanceof Node) || !panel.contains(active);

      if (event.shiftKey && (outside || active === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (outside || active === last)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, closeAndRestoreFocus]);

  return (
    <div className="md:hidden">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls="mobile-nav-panel"
        aria-label={open ? 'メニューを閉じる' : 'メニューを開く'}
        className="-mr-2 flex h-11 w-11 items-center justify-center rounded-md text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
      >
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>

      {open && (
        <>
          {/* 背景クリックで閉じる。キーボードにはEscの経路があるため装飾扱い */}
          <div
            className="fixed inset-0 z-30 bg-black/20"
            onClick={closeAndRestoreFocus}
            aria-hidden="true"
          />
          <div
            id="mobile-nav-panel"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="メニュー"
            className="absolute inset-x-0 top-full z-40 border-b border-gray-200 bg-white shadow-lg"
          >
            <nav className="flex flex-col p-2">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="flex min-h-[44px] items-center rounded-md px-3 text-sm text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <form action={signOutAction} className="border-t border-gray-200 p-2">
              <button
                type="submit"
                className="flex min-h-[44px] w-full items-center rounded-md px-3 text-sm text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
              >
                ログアウト
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
