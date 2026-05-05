# テクニカルマニュアル — shadowing-ai-sub（AIサブスク版）

## 概要

英会話シャドウイング練習アプリの **AI生成版（サブスクリプション課金）**。Claude API でテーマから英文を自動生成し、OpenAI TTS で音声化、OpenAI Whisper で発音採点する。ライセンスキー方式の `shadowing-web`（モデル版）とは別系統。

---

## アーキテクチャ

```
ブラウザ（クライアント）
  ├── index.html       メインUI・認証・サブスクUI
  ├── app.js           アプリロジック（生成・TTS・録音・採点）
  ├── auth.js          ログイン・登録UI
  ├── subscription.js  Stripe Checkout 連携
  └── style.css
        ↕ HTTP (REST API・JWT Cookie)
Express サーバー（server.js）
  ├── /api/auth/*      ユーザー登録・ログイン・メール認証
  ├── /api/sub/*       Stripe サブスク・Webhook
  ├── /api/generate    Claude APIで英文生成（要サブスク）
  ├── /api/explain     Claude APIで日本語訳・解説生成（要サブスク）
  ├── /api/tts         OpenAI TTSで音声合成（要サブスク・ディスクキャッシュ）
  ├── /api/score       OpenAI Whisperで採点（要サブスク）
  └── /api/saved/*     保存テキスト管理（要認証）
        ↕ HTTP
Anthropic API（Claude）       — 英文生成・解説
OpenAI TTS API               — 音声合成
OpenAI Whisper API           — 採点・音声認識
Stripe API                   — サブスク課金
```

---

## ディレクトリ構成

```
shadowing-ai-sub/
├── server.js                Expressサーバー（ルーティング集約）
├── db.js                    SQLite DB（users/subscriptions/saved_texts）
├── email.js                 nodemailer（メール認証）
├── tts-cache.js             TTS ディスクキャッシュ
├── shadowing.db             SQLite DB ファイル（gitignore）
├── package.json             ES Module
├── render.yaml              Render.com デプロイ設定
├── .env                     環境変数（gitignore）
│
├── routes/
│   ├── auth.js              ユーザー登録・ログイン・パスワードリセット
│   ├── subscription.js      Stripe Checkout・Webhook
│   ├── generate.js          Claude APIで英文生成（SSEストリーミング）
│   ├── explain.js           Claude APIで日本語訳・解説生成
│   ├── tts.js               OpenAI TTS（ディスクキャッシュ付き）
│   ├── score.js             OpenAI Whisper採点（要サブスク）
│   └── saved.js             保存テキストCRUD
│
├── middleware/
│   ├── auth.js              requireAuth（JWT Cookie検証）
│   └── subscription.js      requireSubscription / requireGenQuota
│
├── public/                  静的ファイル
│   ├── index.html
│   ├── app.js               メインロジック
│   ├── auth.js              ログイン・登録UI
│   ├── subscription.js      Stripe Checkout
│   └── style.css
│
└── docs/                    ドキュメント
    ├── MANUAL_TECHNICAL.md（本ファイル）
    ├── MANUAL_USER.md
    └── MANUAL_ADMIN.md
```

---

## 環境変数

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `ANTHROPIC_API_KEY` | ✅ | Claude API キー（サーバー一括管理・ユーザー入力なし）|
| `OPENAI_API_KEY` | ✅ | OpenAI APIキー（TTS と Whisper で共用）|
| `GENERATION_MODEL` | 任意 | 使用するClaudeモデル（デフォルト: `claude-haiku-4-5`）|
| `JWT_SECRET` | ✅ | JWT 署名シークレット |
| `STRIPE_SECRET_KEY` | ✅ | Stripe シークレット |
| `STRIPE_WEBHOOK_SECRET` | ✅ | Stripe Webhook 検証用 |
| `STRIPE_PRICE_ID` | ✅ | サブスクの Stripe Price ID |
| `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` | ✅ | nodemailer SMTP 設定 |
| `APP_URL` | ✅ | アプリの公開URL（メール内リンク用）|
| `NODE_ENV` | 任意 | `production` で TTS キャッシュを `/data/tts-cache` に保存 |
| `DATA_DIR` | 任意 | データディレクトリパス（デフォルト `./data`）|
| `PORT` | 任意 | リッスンポート（デフォルト 3002）|

---

## APIエンドポイント

### 認証・サブスク

| メソッド | パス | 認証 | 機能 |
|---------|------|------|------|
| POST | `/api/auth/register` | なし | ユーザー登録（確認メール送信）|
| GET | `/api/auth/verify` | なし | メールリンクから認証 |
| POST | `/api/auth/login` | なし | ログイン → JWT Cookie 発行 |
| POST | `/api/auth/logout` | なし | Cookie クリア |
| GET | `/api/auth/me` | Cookie | 現在のユーザー情報 |
| POST | `/api/sub/checkout` | Cookie | Stripe Checkout セッション作成 |
| POST | `/api/sub/webhook` | Stripe署名 | サブスク更新通知（active/past_due/canceled）|
| POST | `/api/sub/cancel` | Cookie | サブスク解約 |

### 機能API（全てJWT Cookie認証＋サブスク必須）

| メソッド | パス | 機能 |
|---------|------|------|
| POST | `/api/generate` | Claude APIで英文生成（SSEストリーミング・gen_used カウント）|
| POST | `/api/explain` | Claude APIで日本語訳・フレーズ解説 |
| POST | `/api/tts` | OpenAI TTS（mp3返却・ディスクキャッシュ付き）|
| POST | `/api/score` | OpenAI Whisperで採点 |
| GET/POST/DELETE | `/api/saved` | 保存テキスト管理 |

---

## Claude API サーバー一括管理

ユーザーがAPIキーを入力する必要はなく、**サーバーの `ANTHROPIC_API_KEY` だけで全ユーザーに対応**する設計。

```javascript
// routes/generate.js
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
```

各リクエストでは `requireAuth → requireSubscription → requireGenQuota` のミドルウェアチェーンで以下を検証:
1. JWTで本人確認
2. `subscriptions.status = 'active'`
3. `gen_used < gen_max`（月次上限）

生成成功後に `incrementGenUsed(subId)` で使用回数を加算。

---

## TTS（音声合成）仕様

### 処理フロー

```
クライアント POST /api/tts {text, voice}
  → ① ディスクキャッシュ確認（/data/tts-cache/<sha256>.mp3）
      ヒット → mp3返却（X-Cache: HIT、料金なし）
  → ② OpenAI TTS API 呼出（X-Cache: MISS）
      → ③ ディスクキャッシュ保存
      → mp3返却
```

### コスト

OpenAI TTS-1: **$0.015 / 1,000文字**（約¥2〜3 / 1テキスト）

ディスクキャッシュにより同じテキストの再生は無料。

---

## 採点（Whisper）仕様

### 処理フロー

```
クライアント: 録音停止
  → ① Blob → base64 エンコード
  → ② POST /api/score { audio, mimeType, reference }
      （JWT Cookie + サブスク必須）
サーバー
  → ③ requireAuth: JWT検証
  → ④ requireSubscription: status='active' チェック
  → ⑤ Buffer.from(audio, 'base64') でデコード
  → ⑥ FormData (file + model=whisper-1 + language=en) で OpenAI Whisper呼出
  → ⑦ 転写テキスト取得
  → ⑧ calcScore(reference, transcript) で単語一致度計算
  → ⑨ { score, transcript } 返却
クライアント
  → ⑩ showScore(score) でリングUI更新
```

### スコア計算ロジック

```javascript
// 正規化: 小文字化・記号除去・トークン化
const norm = s => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().split(/\s+/);

// 単語頻度カウントで一致数集計（リファレンスの単語を消費）
const cnt = {};
refWords.forEach(w => { cnt[w] = (cnt[w] || 0) + 1; });
let matched = 0;
hypWords.forEach(w => { if (cnt[w] > 0) { matched++; cnt[w]--; } });

// スコア = 一致単語数 / リファレンス語数 × 100
return Math.round((matched / refWords.length) * 100);
```

### コスト

OpenAI Whisper-1: **$0.006 / 分**（約¥1 / 録音1回）

採点はキャッシュなし（録音内容が毎回異なるため）。

### 採点機能フラグ

`public/app.js`:
```javascript
const SCORING_ENABLED = true;  // false にすると Whisper 呼出をスキップ
```

UI上の録音は維持されたまま、採点のみ停止可能。

### クライアント実装ポイント

- 録音Blob形式: iOS=`audio/wav`（Web Audio API + PCM→WAV）、PC/Android=`audio/webm` or `audio/mp4`
- `FileReader.readAsDataURL` で base64 化
- `express.json({ limit: '20mb' })` で大きい音声ボディを許容
- 401/403 はそれぞれ「ログイン必要」「サブスク必要」のメッセージで分岐

---

## DB スキーマ

```sql
users (
  id, email, password_hash, name, verified, verification_token,
  password_reset_token, password_reset_expires, created_at
)

subscriptions (
  id, user_id, stripe_customer_id, stripe_subscription_id,
  status,        -- 'inactive' | 'active' | 'past_due' | 'canceled'
  start_date, end_date,
  gen_used,      -- 月次生成回数
  gen_max,       -- 月次上限（デフォルト30）
  created_at, updated_at
)

saved_texts (
  id, user_id, theme, text, translation, items_json, created_at
)
```

---

## ローカル開発

```bash
cd shadowing-ai-sub
npm install

# .env 作成
cat > .env <<EOF
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-proj-...
JWT_SECRET=$(openssl rand -base64 32)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
APP_URL=http://localhost:3002
EOF

npm start          # 本番モード（port 3002）
npm run dev        # ウォッチモード
```

---

## Render.com デプロイ

1. GitHub リポジトリにプッシュ（`data/` `shadowing.db*` は gitignore済み）
2. Render.com → New Web Service → リポジトリ選択
3. Persistent Disk: `/data` 1GB（DBとTTSキャッシュ用）
4. Environment Variables を設定
5. Stripe Webhook URL を Render の URL + `/api/sub/webhook` に設定

---

## 主要依存ライブラリ

| パッケージ | バージョン | 用途 |
|-----------|-----------|------|
| express | ^4.21.2 | HTTPサーバー |
| @anthropic-ai/sdk | ^0.93.0 | Claude API |
| better-sqlite3 | ^9.4.3 | SQLite |
| jsonwebtoken | ^9.0.2 | JWT認証 |
| bcryptjs | ^2.4.3 | パスワードハッシュ |
| stripe | ^16.0.0 | サブスク課金 |
| nodemailer | ^6.9.16 | メール送信 |
| cookie-parser | ^1.4.7 | Cookie認証 |
| dotenv | ^16.4.7 | 環境変数 |

Node.js v20.20.1 以上推奨。
