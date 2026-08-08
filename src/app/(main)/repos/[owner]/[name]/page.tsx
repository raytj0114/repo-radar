import type { Metadata } from 'next';
import { Colophon } from '@/components/features/paper/colophon';
import { MenMasthead } from '@/components/features/paper/men-masthead';
import styles from '@/components/features/paper/paper.module.css';
import { SubscribeToggle } from '@/components/features/favorites/subscribe-toggle';
import { ReleaseSummary } from '@/components/features/releases/release-summary';
import { auth } from '@/lib/auth';
import { favoriteTargetSchema } from '@/lib/favorite-input';
import { fetchReleases, fetchRepository } from '@/lib/github/client';
import { RATE_LIMITED, settle, unwrapSettled } from '@/lib/github/concurrent';
import type { Release, Repository } from '@/lib/github/schemas';
import { formatDateJa } from '@/lib/format';
import { paperDateFor, type PaperDate } from '@/lib/paper';
import { prisma } from '@/lib/prisma';

type Params = Promise<{ owner: string; name: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { owner, name } = await params;
  // 銘柄面も紙面の一部なので、テンプレート（%s | RepoRadar）を使わない
  return { title: { absolute: `${owner}/${name}｜日刊 RepoRadar` } };
}

/**
 * 銘柄面（Issue #41）: 1リポジトリの観測値とリリース履歴の組版。
 * リリース履歴は連載（.serial）、AI要約は囲み引用（.pullquote）で組む。
 *
 * この面は同一ページのServer Action（購読判子・AI要約）を持つため、**Suspense境界を
 * 置かない**（`loading.tsx` も不可）。境界があるとaction応答が届かずUIがpendingで固まる
 * （Issue #47 の実測。`docs/ARCHITECTURE.md` のレンダリング制約）
 */
export default async function RepoDetailPage({ params }: { params: Params }) {
  const session = await auth();
  if (!session?.user?.id) return null; // (main)/layout.tsx でリダイレクト済み

  const paper = paperDateFor(new Date());
  const userName = session.user.name;

  // URLパラメータはGitHubの命名規則で検証してからAPIへ渡す
  const parsedParams = favoriteTargetSchema.safeParse(await params);
  if (!parsedParams.success) {
    return <RepoNotFound paper={paper} userName={userName} />;
  }
  const { owner, name } = parsedParams.data;

  // リポジトリメタ・リリース一覧・お気に入り判定は互いに独立なので同時に投げる（Issue #6）。
  // 直列だと待ち時間がそのまま加算される。リポジトリが404ならリリースの結果は使わないため、
  // 例外を即座に伝播させず settle で受けておき、使う直前に unwrapSettled する
  const [repoSettled, releasesSettled, favorite] = await Promise.all([
    settle(fetchRepository(owner, name)),
    settle(fetchReleases(owner, name)),
    prisma.favoriteRepo.findUnique({
      where: { userId_owner_name: { userId: session.user.id, owner, name } },
      select: { id: true },
    }),
  ]);

  const repo = unwrapSettled(repoSettled);
  if (repo === RATE_LIMITED) {
    return <RateLimitNotice paper={paper} userName={userName} />;
  }

  // 404（消滅・改名・private化）。並行して投げたリリースの結果は成功・失敗とも捨てる
  if (!repo) {
    return <RepoNotFound paper={paper} userName={userName} />;
  }

  const releasesOrLimited = unwrapSettled(releasesSettled);
  if (releasesOrLimited === RATE_LIMITED) {
    return <RateLimitNotice paper={paper} userName={userName} />;
  }
  const releases: Release[] | null = releasesOrLimited;

  return (
    <Face paper={paper} userName={userName}>
      <section className={`${styles.section} ${styles.noRule}`}>
        <span className={styles.kanban}>銘柄</span>
        <h2 className={`${styles.smallHd} ${styles.breakAll}`}>
          <a href={repo.html_url} target="_blank" rel="noopener noreferrer">
            {repo.full_name}
          </a>
        </h2>
        <p>
          <SubscribeToggle
            owner={repo.owner.login}
            name={repo.name}
            avatarUrl={repo.owner.avatar_url}
            isSubscribed={favorite !== null}
          />
        </p>
        {repo.description && (
          <div className={styles.article}>
            <p>{repo.description}</p>
          </div>
        )}
        <Observations repo={repo} />
      </section>

      <div className={styles.serial}>
        <span className={styles.kanban}>連載</span>
        <h2 className={styles.smallHd}>リリース履歴</h2>
        {!releases || releases.length === 0 ? (
          <p className={styles.kyusai}>リリースの記録なし。</p>
        ) : (
          <ol className={styles.tanshin}>
            {releases.map((release) => (
              <li key={release.id} className={styles.breakAll}>
                <p>
                  <a href={release.html_url} target="_blank" rel="noopener noreferrer">
                    <b>{release.name ?? release.tag_name}</b>
                  </a>
                  {release.prerelease && (
                    <>
                      　<span className={styles.markShu}>試</span>
                    </>
                  )}
                </p>
                <p className={styles.fieldNote}>
                  {release.tag_name}
                  {release.published_at && <>　{formatDateJa(release.published_at)}</>}
                </p>
                {release.body && (
                  <>
                    <p className={`${styles.preLine} ${styles.clamp3}`}>{release.body}</p>
                    <ReleaseSummary
                      owner={repo.owner.login}
                      name={repo.name}
                      tagName={release.tag_name}
                    />
                  </>
                )}
              </li>
            ))}
          </ol>
        )}
        <p className={styles.nextNote}>
          <a href={`${repo.html_url}/releases`} target="_blank" rel="noopener noreferrer">
            （全記録はGitHubで）
          </a>
        </p>
      </div>
    </Face>
  );
}

/** 観測値の一行（dateline風）。読み上げにはdl/dt/ddの対で伝える */
function Observations({ repo }: { repo: Repository }) {
  const items: [string, string][] = [
    ['星数', repo.stargazers_count.toLocaleString('ja-JP')],
    ['分岐', repo.forks_count.toLocaleString('ja-JP')],
    ['懸案', repo.open_issues_count.toLocaleString('ja-JP')],
  ];
  if (repo.language) {
    items.push(['言語', repo.language]);
  }
  return (
    <dl className={`${styles.dateline} ${styles.inlinePair}`}>
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Face({
  paper,
  userName,
  children,
}: {
  paper: PaperDate;
  userName: string | null | undefined;
  children: React.ReactNode;
}) {
  return (
    <main className={styles.backdrop}>
      <div className={styles.paper}>
        <MenMasthead paper={paper} title="銘柄面" edition="個別銘柄" />
        {children}
        <Colophon userName={userName} issueNumber={paper.issueNumber} />
      </div>
    </main>
  );
}

function RateLimitNotice({
  paper,
  userName,
}: {
  paper: PaperDate;
  userName: string | null | undefined;
}) {
  return (
    <Face paper={paper} userName={userName}>
      <section className={`${styles.section} ${styles.noRule}`}>
        <p className={styles.kyusai}>
          GitHub
          APIのレート上限に達したため、リポジトリ情報を取得できませんでした。しばらくすると回復します。
        </p>
      </section>
    </Face>
  );
}

function RepoNotFound({
  paper,
  userName,
}: {
  paper: PaperDate;
  userName: string | null | undefined;
}) {
  return (
    <Face paper={paper} userName={userName}>
      <section className={`${styles.section} ${styles.noRule}`}>
        <p className={styles.kyusai}>
          該当銘柄は見当たらない。削除・改名されたか、符丁（URL）が誤っている見込み。
        </p>
      </section>
    </Face>
  );
}
