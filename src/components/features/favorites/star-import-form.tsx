'use client';

import { useState, useTransition } from 'react';
import { importStarredFavorites } from '@/app/actions/favorites';
import styles from '@/components/features/paper/paper.module.css';

export type StarRow = {
  /** GitHubリポジトリの数値ID。actionへ送るのはこれだけ（owner/name文字列は送らない） */
  id: number;
  fullName: string;
  description: string | null;
  subscribed: boolean;
};

/** フォームのchecked状態から選択済みidを読む。actionへの入力はここで数値に閉じる */
function selectedIds(form: HTMLFormElement): number[] {
  return Array.from(form.querySelectorAll<HTMLInputElement>('input[name="repoId"]:checked'), (el) =>
    Number(el.value)
  );
}

/**
 * 星取帳の記帳フォーム。チェックした銘柄のidのみを `importStarredFavorites` へ送る。
 * canonicalなowner/nameはサーバーがスター一覧から引き直すため、ここでは一切扱わない
 */
export function StarImportForm({ rows }: { rows: StarRow[] }) {
  const [pending, startTransition] = useTransition();
  const [selectedCount, setSelectedCount] = useState(0);
  const [failed, setFailed] = useState(false);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const ids = selectedIds(event.currentTarget);
    if (ids.length === 0) return;
    startTransition(async () => {
      const result = await importStarredFavorites({ ids });
      if (!result.ok) {
        // 失敗は欄内の朱帯で報じ、選択は保持する（面ごとerror境界に落とさない。#42レビュー指摘2）
        setFailed(true);
        return;
      }
      setFailed(false);
      // 取り込んだ行は再描画で「購読中」（チェック不能）になるため、選択件数の表示も畳む。
      // リセットしないと「選択　N銘柄」と有効なボタンだけが残り、表示が実態と食い違う
      setSelectedCount(0);
    });
  };

  return (
    <form
      onSubmit={submit}
      onChange={(event) => setSelectedCount(selectedIds(event.currentTarget).length)}
    >
      <ul className={styles.starList}>
        {rows.map((row) => (
          <li key={row.id}>
            {row.subscribed ? (
              <span className={styles.starLabel}>
                <input
                  type="checkbox"
                  className={styles.check}
                  aria-label={`${row.fullName}（購読中）`}
                  checked
                  disabled
                />
                <span className={styles.breakAll}>
                  <b>{row.fullName}</b>　<span className={styles.markShu}>購読中</span>
                  {row.description && <small className={styles.repoDesc}>{row.description}</small>}
                </span>
              </span>
            ) : (
              <label className={styles.starLabel}>
                <input
                  type="checkbox"
                  name="repoId"
                  value={row.id}
                  className={styles.check}
                  disabled={pending}
                />
                <span className={styles.breakAll}>
                  <b>{row.fullName}</b>
                  {row.description && <small className={styles.repoDesc}>{row.description}</small>}
                </span>
              </label>
            )}
          </li>
        ))}
      </ul>
      <div className={styles.importBar}>
        <button
          type="submit"
          disabled={pending || selectedCount === 0}
          className={`${styles.stamp} ${styles.stampShu}`}
        >
          {pending ? '記帳中…' : '選択の銘柄を一括購読'}
        </button>
        <p className={styles.fieldNote} aria-live="polite">
          {selectedCount > 0 ? `選択　${selectedCount}銘柄` : '取り込む銘柄に印を。'}
        </p>
      </div>
      <div aria-live="polite">
        {failed && !pending && (
          <p className={styles.stopPress}>星取帳の照合に失敗。時間をおいて再度お試しを。</p>
        )}
      </div>
    </form>
  );
}
