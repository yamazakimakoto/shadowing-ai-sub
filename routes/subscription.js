import { Router } from 'express';
import Stripe from 'stripe';
import {
  getUserById,
  getLatestSubscription,
  getActiveSubscription,
  upsertStripeSubscription,
  renewSubscription,
  updateSubscriptionStatus,
  getSubByCustomerId,
} from '../db.js';
import {
  sendSubscriptionStartEmail,
  sendSubscriptionRenewEmail,
} from '../email.js';
import { requireAuth } from '../middleware/auth.js';
import { isOwner, ownerSubscription } from '../middleware/subscription.js';

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');
const PRICE_ID = process.env.STRIPE_PRICE_ID || '';
const APP_URL  = process.env.APP_URL || 'http://localhost:3002';
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

// ── サブスク状態取得 ────────────────────────────────────────────────
router.get('/status', requireAuth, (req, res) => {
  // オーナー（OWNER_EMAILS）は常にアクティブ扱い（課金不要・無制限）
  if (isOwner(req.user)) {
    return res.json({ active: true, sub: ownerSubscription() });
  }
  const active = getActiveSubscription(req.user.id);
  const latest = getLatestSubscription(req.user.id);
  res.json({
    active:   !!active,
    sub:      active || latest || null,
  });
});

// ── Stripe Checkout セッション作成 ─────────────────────────────────
router.post('/checkout', requireAuth, async (req, res) => {
  if (!PRICE_ID) return res.status(500).json({ error: 'Stripe未設定' });

  // 既存顧客IDを再利用
  const latest = getLatestSubscription(req.user.id);
  const customer = latest?.stripe_customer_id || undefined;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: PRICE_ID, quantity: 1 }],
      customer: customer,
      customer_email: customer ? undefined : req.user.email,
      metadata: { user_id: String(req.user.id) },
      success_url: `${APP_URL}/?sub=success`,
      cancel_url:  `${APP_URL}/?sub=cancel`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('[checkout]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Stripe Customer Portal（支払方法変更・解約） ─────────────────────
router.post('/portal', requireAuth, async (req, res) => {
  const latest = getLatestSubscription(req.user.id);
  if (!latest?.stripe_customer_id) {
    return res.status(400).json({ error: 'サブスクリプションが見つかりません' });
  }
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: latest.stripe_customer_id,
      return_url: `${APP_URL}/`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('[portal]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Stripe Webhook ──────────────────────────────────────────────────
// express.raw() が必要なのでここでは raw body を受け取る
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error('[webhook] signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      // ── 新規サブスク購入 ──────────────────────────────────────────
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode !== 'subscription') break;

        const userId = parseInt(session.metadata?.user_id);
        if (!userId) { console.warn('[webhook] no user_id in metadata'); break; }

        const sub = await stripe.subscriptions.retrieve(session.subscription);
        const startDate = new Date(sub.current_period_start * 1000).toISOString();
        const endDate   = new Date(sub.current_period_end   * 1000).toISOString();

        upsertStripeSubscription({
          userId,
          stripeCustomerId:     session.customer,
          stripeSubscriptionId: session.subscription,
          status:    'active',
          startDate,
          endDate,
        });

        const user = getUserById(userId);
        if (user) await sendSubscriptionStartEmail(user.email, user.name, endDate);
        console.log('[webhook] subscription started for user', userId);
        break;
      }

      // ── 請求書支払い成功（月次更新） ─────────────────────────────
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        if (invoice.billing_reason !== 'subscription_cycle') break; // 初回は checkout.session.completed で処理

        const subId   = invoice.subscription;
        const stripeSub = await stripe.subscriptions.retrieve(subId);
        const newEndDate = new Date(stripeSub.current_period_end * 1000).toISOString();

        renewSubscription(subId, newEndDate);

        const dbSub = getSubByCustomerId(invoice.customer);
        if (dbSub) {
          const user = getUserById(dbSub.user_id);
          if (user) await sendSubscriptionRenewEmail(user.email, user.name, newEndDate);
        }
        console.log('[webhook] subscription renewed', subId);
        break;
      }

      // ── サブスク削除・キャンセル ─────────────────────────────────
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        updateSubscriptionStatus(sub.id, 'canceled');
        console.log('[webhook] subscription canceled', sub.id);
        break;
      }

      // ── サブスク一時停止 ─────────────────────────────────────────
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        if (sub.status === 'past_due' || sub.status === 'unpaid') {
          updateSubscriptionStatus(sub.id, 'inactive');
        }
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error('[webhook] handler error:', err.message);
    // Stripe に 500 を返すと再試行するので 200 を返す
  }

  res.json({ received: true });
});

export default router;
