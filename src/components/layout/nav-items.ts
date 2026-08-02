/**
 * ヘッダーのナビゲーション項目。
 * デスクトップのインラインナビとモバイルメニューで同じ定義を共有する。
 */
export const navItems = [
  // トップは紙面化した（Issue #31）。ヘッダーの残る画面から一面へ戻るためのラベル
  { href: '/', label: '一面' },
  { href: '/trending', label: 'トレンド' },
  { href: '/digest', label: 'ダイジェスト' },
] as const;
