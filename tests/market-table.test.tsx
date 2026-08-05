import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MarketTable } from '@/components/features/paper/market-table';
import type { MarketDelta, MarketRow } from '@/lib/paper';

// 増減欄の表示規約（Issue #40）。「捏造しない」は最終的にこの1列の刷り方で決まるので、
// 記号・※印・読み上げラベルの対応をここで固定する（E2Eは実データの都合で一部の形態しか踏めない）。

afterEach(() => {
  cleanup();
});

function row(delta: MarketDelta): MarketRow {
  return { fullName: 'astral-sh/ty', href: '/repos/astral-sh/ty', stars: 9000, delta };
}

function renderDelta(delta: MarketDelta) {
  render(<MarketTable rows={[row(delta)]} rateLimited={false} />);
  return screen.getByRole('row', { name: /astral-sh\/ty/ });
}

describe('MarketTable', () => {
  it('前日比の増は▲と朱、減は▼で刷り、読み上げには増減を語で伝える', () => {
    const up = renderDelta({ kind: 'diff', delta: 1234, previousDay: true });
    expect(up).toHaveTextContent('▲1,234');
    expect(screen.getByRole('cell', { name: '前日比 1,234増' })).toBeInTheDocument();
    cleanup();

    const down = renderDelta({ kind: 'diff', delta: -567, previousDay: true });
    expect(down).toHaveTextContent('▼567');
    expect(screen.getByRole('cell', { name: '前日比 567減' })).toBeInTheDocument();
  });

  it('変化なしは符号を付けずに±0と刷る', () => {
    const flat = renderDelta({ kind: 'diff', delta: 0, previousDay: true });
    expect(flat).toHaveTextContent('±0');
    expect(screen.getByRole('cell', { name: '前日比 変わらず' })).toBeInTheDocument();
  });

  it('欠測を挟む差分には※を付け、前日比とは呼ばない', () => {
    const stale = renderDelta({ kind: 'diff', delta: 300, previousDay: false });
    expect(stale).toHaveTextContent('▲300※');
    expect(screen.getByRole('cell', { name: '直近観測比 300増' })).toBeInTheDocument();
    // captionで※の意味を断っている（表の説明として読み上げ環境にも届く）
    expect(screen.getByText(/※は欠測を挟む直近観測比/)).toBeInTheDocument();
  });

  it('履歴が足りない銘柄は日割、日割も出せなければ「─」へ縮退する', () => {
    const perDay = renderDelta({ kind: 'perDay', perDay: 40 });
    expect(perDay).toHaveTextContent('日割 40');
    cleanup();

    const none = renderDelta({ kind: 'none' });
    expect(none).toHaveTextContent('─');
    expect(screen.getByRole('cell', { name: '記録なし' })).toBeInTheDocument();
  });

  it('相場が組めない日は休載枠に倒す（レート上限とそれ以外で文言を分ける）', () => {
    render(<MarketTable rows={null} rateLimited />);
    expect(screen.getByText('検索枠の上限につき本日は休載。')).toBeInTheDocument();
    cleanup();

    render(<MarketTable rows={[]} rateLimited={false} />);
    expect(screen.getByText('データリンク不通につき休載。')).toBeInTheDocument();
  });
});
