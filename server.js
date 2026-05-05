import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

import authRoutes         from './routes/auth.js';
import subscriptionRoutes from './routes/subscription.js';
import generateRoutes     from './routes/generate.js';
import explainRoutes      from './routes/explain.js';
import savedRoutes        from './routes/saved.js';
import ttsRoutes          from './routes/tts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// ── Stripe Webhook は raw body が必要 ─────────────────────────────
app.use('/api/sub/webhook', express.raw({ type: 'application/json' }));

// ── 共通ミドルウェア ──────────────────────────────────────────────
app.use(express.json());
app.use(cookieParser());
app.use(express.static(join(__dirname, 'public')));

// ── API ルーティング ─────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/sub',  subscriptionRoutes);
app.use('/api/generate', generateRoutes);
app.use('/api/explain',  explainRoutes);
app.use('/api/saved',    savedRoutes);
app.use('/api/tts',      ttsRoutes);

// ── API ステータス ────────────────────────────────────────────────
app.get('/api/status', (_req, res) => {
  res.json({ ok: true, model: process.env.GENERATION_MODEL || 'claude-haiku-4-5' });
});

// ── SPA フォールバック ────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`\n✨ English Shadowing AI — サブスク版`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   モデル: ${process.env.GENERATION_MODEL || 'claude-haiku-4-5'}`);
  console.log(`   Stripe: ${process.env.STRIPE_SECRET_KEY ? '✓ 設定済み' : '未設定'}\n`);
});
