'use client';

import { ErrorState } from '@/components/ui/error-state';

// chrome画面（trending/digest/repos）のエラー境界。(chrome)/layout のヘッダーとコンテナを保ったまま受ける
export default function ChromeError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState {...props} />;
}
