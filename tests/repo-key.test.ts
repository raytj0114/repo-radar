import { describe, expect, it } from 'vitest';
import { normalizeFullName } from '@/lib/repo-key';

// 保存側（星数スナップショット）と表示側（相場欄の前日比）が同じキーで突き合わせるための規則。
// ここが変わると前日比が「履歴の無い銘柄」として静かに欠けるため、規則そのものを固定する。

describe('normalizeFullName', () => {
  it('前後の空白を落として小文字化する（ケース違いを同一視する）', () => {
    expect(normalizeFullName(' Vercel/Next.js ')).toBe('vercel/next.js');
  });

  it('正規化済みの値は変わらない（冪等）', () => {
    expect(normalizeFullName('vercel/next.js')).toBe('vercel/next.js');
  });
});
