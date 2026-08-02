import { describe, expect, it } from 'vitest';
import {
  rateLimitSchema,
  releaseListSchema,
  releaseSchema,
  repositorySchema,
  searchRepositoriesSchema,
} from '@/lib/github/schemas';
import rateLimitFixture from './fixtures/github/rate-limit.json';
import repositoryFixture from './fixtures/github/repository.json';
import releasesFixture from './fixtures/github/releases.json';
import searchFixture from './fixtures/github/search-repositories.json';

describe('repositorySchema', () => {
  it('実レスポンス相当のfixtureをパースできる（未知フィールドは落とされる）', () => {
    const result = repositorySchema.safeParse(repositoryFixture);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.full_name).toBe('vercel/next.js');
      expect(result.data.owner.login).toBe('vercel');
      // スキーマ外のフィールドは含まれない
      expect(result.data).not.toHaveProperty('topics');
    }
  });

  it('stargazers_count が欠けているとエラーになる', () => {
    const { stargazers_count, ...broken } = repositoryFixture;
    expect(repositorySchema.safeParse(broken).success).toBe(false);
  });

  it('stargazers_count が文字列だとエラーになる', () => {
    const broken = { ...repositoryFixture, stargazers_count: '128000' };
    expect(repositorySchema.safeParse(broken).success).toBe(false);
  });

  it('created_at の欠落は受理する（後付けフィールド。デプロイ跨ぎのData Cacheに旧形式が残るため）', () => {
    const { created_at, ...legacyCached } = repositoryFixture;
    const result = repositorySchema.safeParse(legacyCached);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created_at).toBeUndefined();
    }
  });

  it('description / language / pushed_at はnullを許容する', () => {
    const nullable = {
      ...repositoryFixture,
      description: null,
      language: null,
      pushed_at: null,
    };
    expect(repositorySchema.safeParse(nullable).success).toBe(true);
  });
});

describe('releaseSchema', () => {
  it('通常リリース・prerelease・draft（published_at=null）をすべてパースできる', () => {
    const result = releaseListSchema.safeParse(releasesFixture);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(3);
      expect(result.data[1].name).toBeNull();
      expect(result.data[2].published_at).toBeNull();
    }
  });

  it('body が未定義でもパースできる（draftリリース）', () => {
    const draft = releasesFixture[2];
    expect(draft).not.toHaveProperty('body');
    expect(releaseSchema.safeParse(draft).success).toBe(true);
  });

  it('tag_name が欠けているとエラーになる', () => {
    const { tag_name, ...broken } = releasesFixture[0];
    expect(releaseSchema.safeParse(broken).success).toBe(false);
  });

  it('published_at がISO 8601形式でないとエラーになる', () => {
    const broken = { ...releasesFixture[0], published_at: '2026/07/10' };
    expect(releaseSchema.safeParse(broken).success).toBe(false);
  });
});

describe('searchRepositoriesSchema', () => {
  it('検索結果のfixtureをパースできる', () => {
    const result = searchRepositoriesSchema.safeParse(searchFixture);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.total_count).toBe(4521);
      expect(result.data.items).toHaveLength(2);
      expect(result.data.items[1].language).toBeNull();
    }
  });

  it('items 内の1件が壊れていると全体がエラーになる', () => {
    const broken = {
      ...searchFixture,
      items: [...searchFixture.items, { id: 'not-a-number' }],
    };
    expect(searchRepositoriesSchema.safeParse(broken).success).toBe(false);
  });

  it('items が配列でないとエラーになる', () => {
    const broken = { ...searchFixture, items: null };
    expect(searchRepositoriesSchema.safeParse(broken).success).toBe(false);
  });
});

describe('rateLimitSchema', () => {
  it('実レスポンス相当のfixtureをパースし、coreのみを使う（Issue #31 天気欄）', () => {
    const result = rateLimitSchema.safeParse(rateLimitFixture);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.resources.core).toEqual({ limit: 5000, remaining: 4812 });
    }
  });

  it('resources.core が欠けているとエラーになる', () => {
    expect(rateLimitSchema.safeParse({ resources: {} }).success).toBe(false);
  });
});
