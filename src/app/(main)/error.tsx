'use client';

import { ErrorState } from '@/components/ui/error-state';

// /（紙面）のエラー境界。chrome画面側は (chrome)/error.tsx が受ける
export default function MainError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState {...props} />;
}
