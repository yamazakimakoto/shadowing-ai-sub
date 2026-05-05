import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const DB_PATH = process.env.DB_PATH || './shadowing.db';

// Render.com Persistent Disk のディレクトリを事前作成
const dir = dirname(DB_PATH);
if (dir !== '.' && !existsSync(dir)) mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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
    gen_max                INTEGER NOT NULL DEFAULT 30,
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
        (user_id, stripe_customer_id, stripe_subscription_id, status, start_date, end_date)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, stripeCustomerId, stripeSubscriptionId, status, startDate, endDate);
  }
}

/** 月次更新: gen_used リセット＋期限延長 */
export function renewSubscription(stripeSubscriptionId, newEndDate) {
  db.prepare(`
    UPDATE subscriptions
    SET gen_used = 0, end_date = ?, status = 'active', updated_at = datetime('now')
    WHERE stripe_subscription_id = ?
  `).run(newEndDate, stripeSubscriptionId);
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
