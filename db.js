import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

// DB_PATH の決定:
// 1. 環境変数で明示指定されていればそれを使う
// 2. /data が存在すれば（Render Persistent Disk）そこに保存
// 3. それ以外（ローカル開発）は ./shadowing.db
// ★ shadowing-web で発生した教訓: 環境変数未設定だとコンテナの揮発性
//   ファイルシステムに保存され、デプロイごとに全ユーザーデータが消える
const DB_PATH = process.env.DB_PATH
  || (existsSync('/data') ? '/data/shadowing.db' : './shadowing.db');
console.log(`[init] DB_PATH = ${DB_PATH}`);

// Render.com Persistent Disk のディレクトリを事前作成
const dir = dirname(DB_PATH);
if (dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── プラン設定 ────────────────────────────────────────────────────────
// 月間生成上限。変更時はここ（または環境変数 GEN_MAX_PER_MONTH）を更新し、
// Stripe 側の Price と index.html / email.js の表示も合わせること。
// 2026-07-17: 30件/¥700 → 45件/¥980 に改定
export const GEN_MAX = parseInt(process.env.GEN_MAX_PER_MONTH || '45');

// ── テーブル作成 ──────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    email              TEXT    UNIQUE NOT NULL,
    password_hash      TEXT    NOT NULL,
    name               TEXT    NOT NULL DEFAULT '',
    email_verified     INTEGER NOT NULL DEFAULT 0,
    verification_token TEXT,
    created_at         DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id                INTEGER NOT NULL REFERENCES users(id),
    stripe_customer_id     TEXT,
    stripe_subscription_id TEXT,
    status                 TEXT    NOT NULL DEFAULT 'inactive',
    start_date             DATETIME,
    end_date               DATETIME,
    gen_used               INTEGER NOT NULL DEFAULT 0,
    gen_max                INTEGER NOT NULL DEFAULT 45,
    created_at             DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at             DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS saved_texts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    theme       TEXT    NOT NULL DEFAULT '',
    text        TEXT    NOT NULL,
    translation TEXT,
    items_json  TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_sub_user ON subscriptions(user_id);
  CREATE INDEX IF NOT EXISTS idx_saved_user ON saved_texts(user_id);
`);

// ── 既存行のプラン移行 ────────────────────────────────────────────────
// CREATE TABLE IF NOT EXISTS は既存テーブルの DEFAULT を変えないため、
// 旧プラン値(30)のままの行を現行の GEN_MAX へ引き上げる（個別調整済みの
// 行には触れない）。起動時に毎回実行しても冪等。
try {
  const migrated = db.prepare(
    'UPDATE subscriptions SET gen_max = ? WHERE gen_max = 30 AND ? > 30'
  ).run(GEN_MAX, GEN_MAX);
  if (migrated.changes > 0) console.log(`[migrate] gen_max 30 → ${GEN_MAX}: ${migrated.changes}件`);
} catch (e) {
  console.warn('[migrate] gen_max 移行スキップ:', e.message);
}

// ── ヘルパー関数 ──────────────────────────────────────────────────────

/** ユーザーをIDで取得 */
export function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

/** ユーザーをメールで取得 */
export function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
}

/** ユーザー作成 */
export function createUser({ email, password_hash, name, verification_token }) {
  return db.prepare(`
    INSERT INTO users (email, password_hash, name, verification_token)
    VALUES (?, ?, ?, ?)
  `).run(email.toLowerCase(), password_hash, name, verification_token);
}

/** メール認証済みにする */
export function verifyUserEmail(token) {
  const u = db.prepare(
    'SELECT * FROM users WHERE verification_token = ? AND email_verified = 0'
  ).get(token);
  if (!u) return null;
  db.prepare(
    'UPDATE users SET email_verified = 1, verification_token = NULL WHERE id = ?'
  ).run(u.id);
  return u;
}

/** アクティブなサブスクを取得（期限内のもの） */
export function getActiveSubscription(userId) {
  return db.prepare(`
    SELECT * FROM subscriptions
    WHERE user_id = ?
      AND status = 'active'
      AND end_date > datetime('now')
    ORDER BY end_date DESC
    LIMIT 1
  `).get(userId);
}

/** 最新のサブスク取得（期限問わず） */
export function getLatestSubscription(userId) {
  return db.prepare(`
    SELECT * FROM subscriptions
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(userId);
}

/** Stripeサブスクを upsert */
export function upsertStripeSubscription({
  userId, stripeCustomerId, stripeSubscriptionId,
  status, startDate, endDate
}) {
  const existing = db.prepare(
    'SELECT id FROM subscriptions WHERE stripe_subscription_id = ?'
  ).get(stripeSubscriptionId);

  if (existing) {
    db.prepare(`
      UPDATE subscriptions
      SET status = ?, start_date = ?, end_date = ?, updated_at = datetime('now')
      WHERE stripe_subscription_id = ?
    `).run(status, startDate, endDate, stripeSubscriptionId);
  } else {
    db.prepare(`
      INSERT INTO subscriptions
        (user_id, stripe_customer_id, stripe_subscription_id, status, start_date, end_date, gen_max)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, stripeCustomerId, stripeSubscriptionId, status, startDate, endDate, GEN_MAX);
  }
}

/** 月次更新: gen_used リセット＋期限延長（gen_max も現行プラン値に同期） */
export function renewSubscription(stripeSubscriptionId, newEndDate) {
  db.prepare(`
    UPDATE subscriptions
    SET gen_used = 0, gen_max = ?, end_date = ?, status = 'active', updated_at = datetime('now')
    WHERE stripe_subscription_id = ?
  `).run(GEN_MAX, newEndDate, stripeSubscriptionId);
}

/** 生成件数を1増やす（排他的に） */
export function incrementGenUsed(subId) {
  db.prepare(`
    UPDATE subscriptions SET gen_used = gen_used + 1, updated_at = datetime('now')
    WHERE id = ?
  `).run(subId);
}

/** サブスクステータス更新 */
export function updateSubscriptionStatus(stripeSubscriptionId, status) {
  db.prepare(`
    UPDATE subscriptions SET status = ?, updated_at = datetime('now')
    WHERE stripe_subscription_id = ?
  `).run(status, stripeSubscriptionId);
}

/** Stripe顧客IDでサブスク検索 */
export function getSubByCustomerId(customerId) {
  return db.prepare(
    'SELECT * FROM subscriptions WHERE stripe_customer_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(customerId);
}

// ── 保存テキスト ───────────────────────────────────────────────────────

export function getSavedTexts(userId) {
  return db.prepare(
    'SELECT * FROM saved_texts WHERE user_id = ? ORDER BY created_at DESC'
  ).all(userId);
}

export function getSavedTextById(id, userId) {
  return db.prepare(
    'SELECT * FROM saved_texts WHERE id = ? AND user_id = ?'
  ).get(id, userId);
}

export function insertSavedText({ userId, theme, text, translation, items_json }) {
  const res = db.prepare(`
    INSERT INTO saved_texts (user_id, theme, text, translation, items_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, theme, text, translation || null, items_json || null);
  return res.lastInsertRowid;
}

export function deleteSavedText(id, userId) {
  return db.prepare(
    'DELETE FROM saved_texts WHERE id = ? AND user_id = ?'
  ).run(id, userId);
}

export function countSavedTexts(userId) {
  return db.prepare('SELECT COUNT(*) as cnt FROM saved_texts WHERE user_id = ?').get(userId).cnt;
}

export default db;
