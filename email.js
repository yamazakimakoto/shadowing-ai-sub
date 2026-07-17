import nodemailer from 'nodemailer';
import { GEN_MAX } from './db.js';

const APP_URL  = process.env.APP_URL  || 'http://localhost:3002';
const APP_NAME = 'English Shadowing AI';
const FROM     = process.env.SMTP_FROM || `"${APP_NAME}" <noreply@shadowing-ai.app>`;

// SMTPトランスポート（環境変数で設定）
function createTransport() {
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  // 開発環境: Ethereal（実際には送信せず確認用URL出力）
  return null;
}

/** メール認証リンク送信 */
export async function sendVerificationEmail(to, name, token) {
  const link = `${APP_URL}/api/auth/verify?token=${token}`;
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 16px">
      <h2 style="color:#0ea5e9">✨ ${APP_NAME}</h2>
      <p>${name} さん、ご登録ありがとうございます！</p>
      <p>以下のボタンをクリックしてメールアドレスを確認してください。</p>
      <p style="margin:24px 0">
        <a href="${link}" style="background:#0ea5e9;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
          メールアドレスを確認する
        </a>
      </p>
      <p style="font-size:0.85rem;color:#64748b">
        ボタンが機能しない場合は以下のURLをコピーしてブラウザに貼り付けてください：<br>
        <a href="${link}" style="color:#0ea5e9">${link}</a>
      </p>
      <hr style="margin:24px 0;border:none;border-top:1px solid #e2e8f0">
      <p style="font-size:0.78rem;color:#94a3b8">
        このメールに心当たりがない場合は無視してください。
      </p>
    </div>`;

  return sendMail({ to, subject: `【${APP_NAME}】メールアドレスの確認`, html });
}

/** サブスク開始通知 */
export async function sendSubscriptionStartEmail(to, name, endDate) {
  const d = new Date(endDate).toLocaleDateString('ja-JP');
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 16px">
      <h2 style="color:#0ea5e9">✨ ${APP_NAME}</h2>
      <p>${name} さん、ご契約ありがとうございます！</p>
      <div style="background:#f0f9ff;border-radius:12px;padding:16px;margin:16px 0">
        <p style="margin:4px 0">📅 <strong>有効期限：</strong>${d}</p>
        <p style="margin:4px 0">📊 <strong>生成可能件数：</strong>${GEN_MAX}件/月</p>
      </div>
      <p>
        <a href="${APP_URL}" style="background:#0ea5e9;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
          練習を始める
        </a>
      </p>
    </div>`;

  return sendMail({ to, subject: `【${APP_NAME}】サブスクリプション開始のお知らせ`, html });
}

/** サブスク更新通知 */
export async function sendSubscriptionRenewEmail(to, name, endDate) {
  const d = new Date(endDate).toLocaleDateString('ja-JP');
  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 16px">
      <h2 style="color:#0ea5e9">✨ ${APP_NAME}</h2>
      <p>${name} さん、今月も更新されました！</p>
      <div style="background:#f0f9ff;border-radius:12px;padding:16px;margin:16px 0">
        <p style="margin:4px 0">📅 <strong>次回期限：</strong>${d}</p>
        <p style="margin:4px 0">📊 <strong>生成件数：</strong>0/${GEN_MAX} 件にリセットされました</p>
      </div>
    </div>`;

  return sendMail({ to, subject: `【${APP_NAME}】サブスクリプション更新のお知らせ`, html });
}

/** 汎用メール送信 */
async function sendMail({ to, subject, html }) {
  const transport = createTransport();
  if (!transport) {
    // 開発環境: コンソールにURLを表示
    console.log('\n📧 [DEV EMAIL]', { to, subject });
    console.log('   (SMTPが未設定のため実際には送信されません)\n');
    return;
  }
  try {
    const info = await transport.sendMail({ from: FROM, to, subject, html });
    console.log('[email] sent:', info.messageId);
  } catch (err) {
    console.error('[email] error:', err.message);
    // メール失敗は致命的エラーとしない
  }
}
