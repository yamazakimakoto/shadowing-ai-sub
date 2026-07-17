# 管理者マニュアル — shadowing-ai-sub（AIサブスク版）

## 概要

このアプリは **サブスクリプション課金型** で、ユーザー登録・Stripe決済・メール認証を備えた完全なSaaS構成です。`shadowing-web`（ライセンスキー方式）とは別の独立サービスとして運用します。

---

## サービス構成

| コンポーネント | 役割 |
|---------------|------|
| Render.com | アプリホスティング（Express サーバー）|
| SQLite | ユーザー・サブスク・保存テキスト DB（`/data/shadowing.db`）|
| Stripe | サブスク課金・Webhook |
| nodemailer (SMTP) | 登録・パスワードリセットメール送信 |
| Anthropic Claude API | 英文生成・解説 |
| OpenAI TTS API | 音声合成 |
| OpenAI Whisper API | 採点・音声認識 |

---

## 課金プラン構成

### 現在のプラン（2026-07-17 改定: ¥980 / 45件）

| 項目 | 値 |
|------|-----|
| 月額料金 | **¥980**（Stripe の Price で設定 → `STRIPE_PRICE_ID`）|
| 月次生成回数 | **45回**（`db.js` の `GEN_MAX` 定数。環境変数 `GEN_MAX_PER_MONTH` で上書き可）|
| TTS（音声合成）| 無制限 |
| 採点（Whisper）| 無制限 |
| テキスト保存 | 無制限 |

### 生成上限の変更方法

1. `db.js` の `GEN_MAX`（または Render 環境変数 `GEN_MAX_PER_MONTH`）を変更
2. デプロイ時に起動マイグレーションが旧値の既存契約者を自動で新値へ引き上げる
3. 表示系（`index.html` の料金表記・本マニュアル）と Stripe の Price も忘れずに更新

### コスト目安（OpenAI / Anthropic・¥150/$換算）

1例文（1生成）あたりの変動費内訳:

| API | 単価 | 1例文あたり | 45例文フル活用 |
|-----|------|------------|---------------|
| Claude 生成（haiku・512tok上限）| $1/M入力・$5/M出力 | ~¥0.2 | ¥9 |
| Claude 解説（毎回使う想定）| 同上・出力~1200tok | ~¥1.0 | ¥45 |
| OpenAI TTS（~250字×音声2種試行）| $0.015/1,000字 | ~¥0.9 | ¥40 |
| OpenAI Whisper 採点（3回×25秒/例文想定）| $0.006/分 | ~¥1.1 | ¥50 |
| **合計** | | **~¥3.2** | **~¥145** |

**1ユーザーあたり月額原価目安:**
- フル活用ユーザー（45件使い切り＋解説・採点多用）: **~¥145**
- 平均的ユーザー（生成20件・解説半分・採点1回/件）: **~¥50〜70**

### 損益モデル（¥980/月）

| 項目 | 金額 |
|------|------|
| 売上 | +¥980 |
| Stripe手数料（3.6%）| -¥36 |
| API変動費 | -¥50〜145 |
| **粗利/人** | **+¥800〜890** |

固定費: Render Starter $7/月（~¥1,050）→ **契約者2人で回収**。

⚠️ 採点・解説・TTSは生成上限の対象外（無制限）。極端なヘビーユーザーが現れたらコスト増になるため、必要に応じて採点回数制限（`score_max`）の導入を検討する。

---

## ユーザー管理

### DBへの直接アクセス

Render.com の Shell タブから:

```bash
# better-sqlite3 を使う簡易確認
node -e "
const Database = require('better-sqlite3');
const db = new Database('/data/shadowing.db');
console.log(db.prepare('SELECT email, verified, created_at FROM users').all());
"

# サブスク状況確認
node -e "
const Database = require('better-sqlite3');
const db = new Database('/data/shadowing.db');
console.log(db.prepare('SELECT u.email, s.status, s.gen_used, s.gen_max, s.end_date FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id').all());
"
```

### よくある操作

**ユーザー手動認証**（メールが届かないケース）:
```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('/data/shadowing.db');
db.prepare('UPDATE users SET verified = 1 WHERE email = ?').run('user@example.com');
"
```

**月次カウントの手動リセット**:
```bash
node -e "
const Database = require('better-sqlite3');
const db = new Database('/data/shadowing.db');
db.prepare('UPDATE subscriptions SET gen_used = 0').run();
"
```

---

## Stripe管理

### Stripe Dashboard で確認すべきもの

- **Customers**: ユーザー一覧・課金履歴
- **Subscriptions**: アクティブなサブスク・解約予定
- **Webhooks**: イベント配信ログ（失敗時の再送）
- **Products / Prices**: 月額料金の変更

### Webhook URL

```
https://shadowing-ai-web.onrender.com/api/sub/webhook
```

> **命名注記:** GitHub リポジトリは `shadowing-ai-sub` だが、Render.com の Service Name と URL は当初の `shadowing-ai-web` を継続利用している（URL変更によるユーザー再周知を避けるため）。リポジトリのコードと URL の名前が異なる点に注意。

イベント: `customer.subscription.created`, `updated`, `deleted`, `invoice.payment_failed`

### サブスク手動解約

Stripe Dashboard → 該当 Subscription → Cancel
→ Webhook で自動的に DB の `status` が `canceled` に更新される

---

## OpenAI / Anthropic コスト管理

### コスト確認

| API | URL |
|-----|-----|
| Anthropic | https://console.anthropic.com/settings/usage |
| OpenAI | https://platform.openai.com/usage |

両APIキーは別請求なので、月次予算管理は両方を確認すること。

### コスト削減の仕組み

1. **TTSディスクキャッシュ**: 同一テキスト+音声の組み合わせは `/data/tts-cache/` に永続保存。複数ユーザー共通で再利用される
2. **生成回数制限**: `subscriptions.gen_max` で月次上限を設定
3. **採点はキャッシュ不可**: 録音内容が毎回異なるため。大量採点ユーザーが出たら `gen_max` 同様に `score_max` 制限を追加することも可能（要 db.js 拡張）

---

## 採点機能のON/OFF

`public/app.js`:
```javascript
const SCORING_ENABLED = true;  // false にするとサーバー呼出スキップ（録音は維持）
```

採点を一時停止したい場合（コスト超過時など）は `false` に変更してデプロイ。サーバー側 `/api/score` は稼働したままだが、クライアントから呼ばれなくなる。

---

## バックアップ

### DB

`/data/shadowing.db` を週1回以上ローカルにダウンロード推奨。

```bash
# Render.com Shell から
cat /data/shadowing.db | base64
# → ローカルで base64 -d > shadowing.db.backup-YYYY-MM-DD で復元可能
```

### TTSキャッシュ

`/data/tts-cache/` も削除しても再生成可能（OpenAI再課金が発生）。コスト最適化のため週1バックアップ推奨。

---

## トラブルシューティング

| 症状 | 原因 | 対応 |
|------|------|------|
| 英文が生成されない | ANTHROPIC_API_KEY 未設定/残高不足 | Anthropic Console で残高確認 |
| 音声が出ない | OPENAI_API_KEY 未設定/残高不足 | OpenAI Billing で残高確認 |
| 採点が動かない | サブスク未加入 / OPENAI_API_KEY 未設定 | DB と OpenAI 残高を確認 |
| 採点が常に0点 | マイク音量不足・無音録音 | ユーザーに大きめの声で再録音してもらう |
| 認証メールが届かない | SMTP設定ミス | Render.com 環境変数で SMTP_* を確認、上記コマンドで手動認証 |
| ログインできない | password_hash 破損 / verified=0 | DBで状態確認、必要に応じて手動更新 |
| サブスク反映が遅い | Stripe Webhook 失敗 | Stripe Dashboard → Webhooks → 該当イベントを再送 |
| 生成回数が0にリセットされない | 月次更新ジョブ未実装 | 手動リセット（上記コマンド）または cron 追加検討 |

---

## セキュリティ注意事項

- `JWT_SECRET` は推測されにくい長い文字列を設定（`openssl rand -base64 32`）
- `STRIPE_WEBHOOK_SECRET` を必ず設定し、Webhook 署名検証を有効に
- DBバックアップファイルにはユーザーメール・パスワードハッシュが含まれる。取り扱い注意
- GitHub に `.env` `data/` `shadowing.db*` がプッシュされていないことを定期確認（`.gitignore` 済み）
- Stripe シークレットキーは絶対に publish しない

---

## 既知の制約・今後の拡張余地

- 月次 `gen_used` の自動リセットは未実装。Stripe Webhook の `invoice.paid` で `gen_used = 0` を実行する処理を追加するか、cron で月初に一括リセットする運用にする
- 採点回数（`score_used` / `score_max`）の上限管理は未実装。コスト爆発リスクがある場合は db.js に追加
- 複数プラン（無料・スタンダード・プレミアム）対応は未実装。`subscriptions.plan` カラム追加で拡張可能
