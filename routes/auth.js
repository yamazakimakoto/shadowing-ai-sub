import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import {
  getUserByEmail, createUser, verifyUserEmail, getUserById
} from '../db.js';
import { sendVerificationEmail } from '../email.js';
import { signToken, requireAuth } from '../middleware/auth.js';

const router = Router();
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30日
};

// ── 登録 ──────────────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'メールアドレス、パスワード、お名前を入力してください' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'パスワードは6文字以上にしてください' });
  }

  const existing = getUserByEmail(email);
  if (existing) return res.status(409).json({ error: 'このメールアドレスは既に登録されています' });

  const password_hash = await bcrypt.hash(password, 10);
  const verification_token = crypto.randomBytes(32).toString('hex');

  try {
    createUser({ email, password_hash, name, verification_token });
    await sendVerificationEmail(email, name, verification_token);
    res.json({ ok: true, message: '確認メールを送信しました。メールをご確認ください。' });
  } catch (err) {
    console.error('[register]', err.message);
    res.status(500).json({ error: '登録に失敗しました。しばらくしてからお試しください。' });
  }
});

// ── ログイン ──────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'メールアドレスとパスワードを入力してください' });
  }

  const user = getUserByEmail(email);
  if (!user) return res.status(401).json({ error: 'メールアドレスまたはパスワードが正しくありません' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'メールアドレスまたはパスワードが正しくありません' });

  if (!user.email_verified) {
    return res.status(403).json({ error: 'EMAIL_NOT_VERIFIED' });
  }

  const token = signToken(user);
  res.cookie('token', token, COOKIE_OPTS);
  res.json({ ok: true, user: { id: user.id, email: user.email, name: user.name } });
});

// ── メール確認 ────────────────────────────────────────────────────────
router.get('/verify', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('トークンが見つかりません');

  const user = verifyUserEmail(token);
  if (!user) {
    return res.status(400).send(`
      <!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
      <title>確認失敗</title>
      <style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#f0f9ff;margin:0}
      .box{text-align:center;background:#fff;padding:40px;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08)}</style>
      </head><body><div class="box">
        <h2 style="color:#ef4444">確認失敗</h2>
        <p>リンクが無効または期限切れです。</p>
        <a href="/" style="color:#0ea5e9">トップに戻る</a>
      </div></body></html>`);
  }

  // 自動ログイン
  const jwt_token = signToken(user);
  res.cookie('token', jwt_token, COOKIE_OPTS);
  res.redirect('/?verified=1');
});

// ── 自分の情報 ────────────────────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  const user = getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'ユーザーが見つかりません' });
  res.json({ id: user.id, email: user.email, name: user.name });
});

// ── ログアウト ────────────────────────────────────────────────────────
router.post('/logout', (_req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

// ── 確認メール再送 ─────────────────────────────────────────────────────
router.post('/resend-verify', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'メールアドレスを入力してください' });

  const user = getUserByEmail(email);
  if (!user) return res.json({ ok: true }); // セキュリティ上ユーザー存在を隠す
  if (user.email_verified) return res.json({ ok: true }); // 既に確認済み

  try {
    await sendVerificationEmail(email, user.name, user.verification_token);
    res.json({ ok: true });
  } catch (err) {
    console.error('[resend-verify]', err.message);
    res.status(500).json({ error: '送信に失敗しました' });
  }
});

export default router;
