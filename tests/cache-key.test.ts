import { describe, expect, it } from 'vitest';
import { dailyDigestKey, releaseSummaryKey } from '@/lib/github/cache-key';

describe('releaseSummaryKey', () => {
  it('owner/repo は小文字に正規化される', () => {
    expect(releaseSummaryKey('Vercel', 'Next.js', 'v15.0.0')).toBe('vercel/next.js@v15.0.0');
  });

  it('tagName の大文字小文字は保持する（GitHub上のタグは大文字小文字を区別するため）', () => {
    expect(releaseSummaryKey('a', 'b', 'V1.0-RC1')).toBe('a/b@V1.0-RC1');
  });

  it('前後の空白を除去する', () => {
    expect(releaseSummaryKey(' a ', ' b ', ' v1 ')).toBe('a/b@v1');
  });
});

describe('dailyDigestKey', () => {
  it('UTC日付でキーを生成する', () => {
    const d = new Date(Date.UTC(2026, 6, 19));
    expect(dailyDigestKey(d, 'user_123')).toBe('digest:2026-07-19:user_123');
  });
});
