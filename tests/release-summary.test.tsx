import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ReleaseSummary } from '@/components/features/releases/release-summary';

const { getReleaseSummaryMock } = vi.hoisted(() => ({ getReleaseSummaryMock: vi.fn() }));

vi.mock('@/app/actions/summaries', () => ({ getReleaseSummary: getReleaseSummaryMock }));

const PROPS = { owner: 'vercel', name: 'next.js', tagName: 'v16.2.0' };

const SUMMARY_TEXT = '・Turbopackが既定に\n・PPRが安定版に\n・画像最適化のメモリを削減';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

async function showSummary() {
  render(<ReleaseSummary {...PROPS} />);
  fireEvent.click(screen.getByRole('button', { name: 'AI要約を表示' }));
  await screen.findByText('AI要約');
}

describe('ReleaseSummary', () => {
  it('構造化された要約は見出し・前文・3行と破壊的変更バッジを表示する', async () => {
    getReleaseSummaryMock.mockResolvedValue({
      ok: true,
      summary: SUMMARY_TEXT,
      headline: 'Turbopack既定化',
      lede: 'ビルドの既定がTurbopackに切り替わった。',
      hasBreaking: true,
    });

    await showSummary();

    expect(screen.getByText('Turbopack既定化')).toBeInTheDocument();
    expect(screen.getByText('ビルドの既定がTurbopackに切り替わった。')).toBeInTheDocument();
    expect(screen.getByText('破壊的変更')).toBeInTheDocument();
    // 3行は改行のまま保持される（既定のnormalizerは改行を潰すので無効化する）
    expect(screen.getByText(SUMMARY_TEXT, { normalizer: (text) => text })).toBeInTheDocument();
  });

  it('破壊的変更が無ければバッジを出さない', async () => {
    getReleaseSummaryMock.mockResolvedValue({
      ok: true,
      summary: SUMMARY_TEXT,
      headline: 'Turbopack既定化',
      lede: 'ビルドの既定がTurbopackに切り替わった。',
      hasBreaking: false,
    });

    await showSummary();

    expect(screen.queryByText('破壊的変更')).not.toBeInTheDocument();
  });

  it('構造化以前のキャッシュ行は要約テキストだけを表示する', async () => {
    getReleaseSummaryMock.mockResolvedValue({
      ok: true,
      summary: '・旧要約',
      headline: null,
      lede: null,
      hasBreaking: false,
    });

    await showSummary();

    expect(screen.getByText('・旧要約')).toBeInTheDocument();
    expect(screen.queryByText('破壊的変更')).not.toBeInTheDocument();
  });

  it('失敗時はメッセージを出し、要約は表示しない', async () => {
    getReleaseSummaryMock.mockResolvedValue({
      ok: false,
      message: 'しばらく時間をおいて再試行してください',
    });

    render(<ReleaseSummary {...PROPS} />);
    fireEvent.click(screen.getByRole('button', { name: 'AI要約を表示' }));

    expect(await screen.findByText('しばらく時間をおいて再試行してください')).toBeInTheDocument();
    expect(screen.queryByText('AI要約')).not.toBeInTheDocument();
  });
});
