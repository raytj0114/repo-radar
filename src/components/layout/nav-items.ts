/**
 * ヘッダーのナビゲーション項目。
 * デスクトップのインラインナビとモバイルメニューで同じ定義を共有する。
 */
export const navItems = [
  { href: '/', label: 'ダッシュボード' },
  { href: '/trending', label: 'トレンド' },
  { href: '/digest', label: 'ダイジェスト' },
] as const;
