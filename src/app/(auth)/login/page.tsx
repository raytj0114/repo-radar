import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import styles from '@/components/features/paper/paper.module.css';
import { auth, signIn } from '@/lib/auth';

// ログイン面も紙面の一部なので、テンプレート（%s | RepoRadar）を使わない
export const metadata: Metadata = {
  title: { absolute: 'ご案内｜日刊 RepoRadar' },
};

/**
 * ログイン面（Issue #41）: 題字と一枚の白紙面。購読契約（ログイン）だけを載せる。
 * 未ログインで唯一到達できる面なので、耳・奥付のナビは組まない
 */
export default async function LoginPage() {
  const session = await auth();
  if (session) {
    redirect('/');
  }

  return (
    <main className={styles.backdrop}>
      <div className={`${styles.paper} ${styles.paperNarrow}`}>
        <header>
          <h1 className={styles.daiji}>日刊 RepoRadar</h1>
          <p className={styles.motto}>観測と記録の日刊紙</p>
          <div className={styles.dateline}>
            <span>御購読の御案内</span>
          </div>
        </header>

        <section className={`${styles.section} ${styles.noRule} ${styles.article}`}>
          <p>
            本紙は、購読銘柄（GitHubリポジトリ）のリリースを毎朝観測し、見出しと要約を日本語で組んで届ける日刊紙である。紙面は毎朝六時（日本時間）に切り替わる。
          </p>
          <p>御購読にはGitHubの口座（アカウント）を用いる。下の判子から手続きを。</p>
        </section>

        <section className={styles.section}>
          <form
            action={async () => {
              'use server';
              await signIn('github', { redirectTo: '/' });
            }}
          >
            <button type="submit" className={`${styles.stamp} ${styles.stampShu}`}>
              GitHubでログイン
            </button>
          </form>
        </section>

        <footer className={styles.colophon}>発行　RepoRadar観測所</footer>
      </div>
    </main>
  );
}
