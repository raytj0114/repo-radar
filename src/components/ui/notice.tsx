import { AlertTriangle } from 'lucide-react';

/** レート制限や部分的な取得失敗など、画面全体を壊さない警告の帯 */
export function Notice({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <AlertTriangle size={16} className="shrink-0" />
      <p>{message}</p>
    </div>
  );
}
