'use client';

import { ErrorState } from '@/components/ui/error-state';

// 認証画面すべてのエラー境界（(chrome)廃止後の1枚。Issue #41）
export default function MainError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState {...props} />;
}
