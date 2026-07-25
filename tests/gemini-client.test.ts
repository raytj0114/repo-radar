import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({
  env: { GOOGLE_GEMINI_API_KEY: 'test-gemini-key' },
}));

function fakeResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function successBody(text: string) {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

const fetchMock = vi.fn();

async function importClient() {
  vi.resetModules();
  return import('@/lib/gemini/client');
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('generateText', () => {
  it('成功時はテキストと使用モデルを返す', async () => {
    const { generateText } = await importClient();
    fetchMock.mockResolvedValue(fakeResponse(successBody('・要約1\n・要約2\n・要約3')));
    const result = await generateText('prompt');
    expect(result).toEqual({ text: '・要約1\n・要約2\n・要約3', model: 'gemini-2.5-flash' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
    );
    expect(init.headers['x-goog-api-key']).toBe('test-gemini-key');
  });

  it('429のあと成功したらリトライで回復する', async () => {
    const { generateText } = await importClient();
    fetchMock
      .mockResolvedValueOnce(fakeResponse({ error: 'rate limited' }, 429))
      .mockResolvedValueOnce(fakeResponse(successBody('要約')));
    const result = await generateText('prompt');
    expect(result.model).toBe('gemini-2.5-flash');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('プライマリが失敗し続けたらフォールバックモデルへ切り替える', async () => {
    const { generateText } = await importClient();
    fetchMock
      .mockResolvedValueOnce(fakeResponse({ error: 'boom' }, 500))
      .mockResolvedValueOnce(fakeResponse({ error: 'boom' }, 500))
      .mockResolvedValueOnce(fakeResponse(successBody('フォールバック要約')));
    const result = await generateText('prompt');
    expect(result).toEqual({ text: 'フォールバック要約', model: 'gemini-2.5-flash-lite' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('全滅時はGeminiAPIErrorを投げ、上流の本文を含まない', async () => {
    const { generateText, GeminiAPIError } = await importClient();
    fetchMock.mockResolvedValue(fakeResponse({ error: 'secret internal detail' }, 500));
    const error = await generateText('prompt').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GeminiAPIError);
    expect((error as Error).message).toBe('要約の生成に失敗しました');
    expect((error as Error).message).not.toContain('secret');
    // 2モデル × 2試行
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('429で全滅した場合は再試行を促すメッセージになる', async () => {
    const { generateText, GeminiAPIError } = await importClient();
    fetchMock.mockResolvedValue(fakeResponse({ error: 'rate' }, 429));
    const error = await generateText('prompt').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GeminiAPIError);
    expect((error as Error).message).toBe('しばらく時間をおいて再試行してください');
  });

  it('APIキー不正(400)は同一モデルでリトライせず次のモデルを試す', async () => {
    const { generateText } = await importClient();
    fetchMock
      .mockResolvedValueOnce(fakeResponse({ error: 'bad key' }, 400))
      .mockResolvedValueOnce(fakeResponse(successBody('要約')));
    const result = await generateText('prompt');
    expect(result.model).toBe('gemini-2.5-flash-lite');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
