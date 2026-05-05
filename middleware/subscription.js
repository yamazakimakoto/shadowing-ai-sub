import { getActiveSubscription } from '../db.js';

/** アクティブなサブスクチェック — req.subscription をセット */
export function requireSubscription(req, res, next) {
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
  if (sub.gen_used >= sub.gen_max) {
    return res.status(403).json({
      error: 'QUOTA_EXCEEDED',
      gen_used: sub.gen_used,
      gen_max: sub.gen_max,
    });
  }
  next();
}
