export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 px-4">
      <h1 className="text-4xl font-bold tracking-tight">RepoRadar</h1>
      <p className="text-center text-gray-600">
        GitHubリポジトリのリリース・トレンドを追跡し、AIがリリースノートを日本語要約するアプリ。
        機能はPhase 1以降で実装されます。
      </p>
    </main>
  );
}
