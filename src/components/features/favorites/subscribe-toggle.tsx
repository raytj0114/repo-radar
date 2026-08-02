'use client';

import { useTransition } from 'react';
import clsx from 'clsx';
import { addFavorite, removeFavorite } from '@/app/actions/favorites';
import styles from './favorites.module.css';

/**
 * 紙面版の購読トグル（判子）。呼ぶactionは既存のFavoriteToggle（chrome画面用）と同じで、
 * 見た目だけを紙面の語彙で持つ。真の状態はrevalidate後のサーバー再描画が返す
 * （useOptimisticは導入しない方針。Issue #42）
 */
export function SubscribeToggle({
  owner,
  name,
  avatarUrl,
  isSubscribed,
}: {
  owner: string;
  name: string;
  avatarUrl?: string | null;
  isSubscribed: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const fullName = `${owner}/${name}`;

  const toggle = () => {
    startTransition(async () => {
      if (isSubscribed) {
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
      aria-pressed={isSubscribed}
      aria-label={isSubscribed ? `${fullName}の購読をやめる` : `${fullName}を購読する`}
      className={clsx(styles.stamp, styles.stampSmall, !isSubscribed && styles.stampShu)}
    >
      {pending ? '手配中' : isSubscribed ? '解約' : '購読'}
    </button>
  );
}
