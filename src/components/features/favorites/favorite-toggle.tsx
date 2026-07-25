'use client';

import { useTransition } from 'react';
import { Star } from 'lucide-react';
import { addFavorite, removeFavorite } from '@/app/actions/favorites';

export function FavoriteToggle({
  owner,
  name,
  avatarUrl,
  isFavorite,
}: {
  owner: string;
  name: string;
  avatarUrl?: string | null;
  isFavorite: boolean;
}) {
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    startTransition(async () => {
      if (isFavorite) {
        await removeFavorite({ owner, name });
      } else {
        await addFavorite({ owner, name, avatarUrl });
      }
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={isFavorite}
      aria-label={isFavorite ? 'お気に入りから外す' : 'お気に入りに追加'}
      title={isFavorite ? 'お気に入りから外す' : 'お気に入りに追加'}
      className="rounded-md p-2 transition-colors hover:bg-gray-100 disabled:opacity-50"
    >
      <Star size={18} className={isFavorite ? 'fill-amber-400 text-amber-400' : 'text-gray-400'} />
    </button>
  );
}
