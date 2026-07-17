import { getActiveSubscription } from '../db.js';

// ── オーナー特権 ──────────────────────────────────────────────────────
// 環境変数 OWNER_EMAILS（カンマ区切り）に登録されたメールアドレスのユーザーは
// サブスク未加入でも全機能を無制限で利用できる（開発者の個人利用・テスト用）。
// 例: OWNER_EMAILS=team.yamazaki.2009@gmail.com
const OWNER_EMAILS = (process.env.OWNER_EMAILS || '')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

export function isOwner(user) {
  return OWNER_EMAILS.includes((user?.email || '').toLowerCase());
}

/** オーナー用の擬似サブスク（DBに行を作らない） */
export function ownerSubscription() {
  return {
    id: 0,
    status: 'active',
    gen_used: 0,
    gen_max: 999999,
    end_date: '2099-12-31T00:00:00.000Z',
    owner: true,
  };
}

/** アクティブなサブスクチェック — req.subscription をセット */
export function requireSubscription(req, res, next) {
  if (isOwner(req.user)) {
    req.subscription = ownerSubscription();
    return next();
  }
  const sub = getActiveSubscription(req.user.id);
  if (!sub) {
    return res.status(403).json({ error: 'SUBSCRIPTION_REQUIRED' });
  }
  req.subscription = sub;
  next();
}

/** 生成上限チェック（requireSubscription の後に使う） */
export function requireGenQuota(req, res, next) {
  const sub = req.subscription;
  if (sub.owner) return next();  // オーナーは無制限
  if (sub.gen_used >= sub.gen_max) {
    return res.status(403).json({
      error: 'QUOTA_EXCEEDED',
      gen_used: sub.gen_used,
      gen_max: sub.gen_max,
    });
  }
  next();
}
