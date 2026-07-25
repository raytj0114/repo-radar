import type { ReactNode } from 'react';

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-gray-300 px-6 py-16 text-center">
      <p className="font-medium text-gray-900">{title}</p>
      {description && <p className="max-w-md text-sm text-gray-500">{description}</p>}
      {action}
    </div>
  );
}
