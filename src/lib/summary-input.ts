import { z } from 'zod';
import { favoriteTargetSchema } from '@/lib/favorite-input';

// リリース要約Server Actionのクライアント入力スキーマ。
// owner/name/tagName は「識別子」としてのみ使い、プロンプトへは直接埋め込まない
// （サーバーでGitHub APIから引き直したデータだけをプロンプトに使う）。

// Gitタグ名: 英数字と ._-/+@ を許可（スペース・制御文字を拒否）
const tagPattern = /^[A-Za-z0-9._\-/+@]+$/;

export const releaseSummaryInputSchema = favoriteTargetSchema.extend({
  tagName: z.string().min(1).max(200).regex(tagPattern, 'タグ名の形式が不正です'),
});

export type ReleaseSummaryInput = z.infer<typeof releaseSummaryInputSchema>;
