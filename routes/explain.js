import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth } from '../middleware/auth.js';
import { requireSubscription } from '../middleware/subscription.js';

const router = Router();
const MODEL = process.env.GENERATION_MODEL || 'claude-haiku-4-5';
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

router.post('/', requireAuth, requireSubscription, async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'テキストを指定してください' });

  try {
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 3000,
      messages: [{
        role: 'user',
        content: `以下の英文の日本語訳と、英会話学習者向けのフレーズ・単語解説を作成してください。

英文:
${text}

以下のJSON形式のみを返してください（前後に説明文・コードブロック不要）:
{
  "translation": "日本語訳（全文。A:/B: がある場合は各行を「A: 〜 / B: 〜」の形式で）",
  "items": [
    {
      "phrase": "英語フレーズ/単語",
      "reading": "カタカナ読み",
      "meaning": "日本語の意味",
      "note": "使い方・ポイント（1〜2文）"
    }
  ]
}

itemsは重要度の高いものから最大15個まで。`,
      }],
    });

    const raw = msg.content[0].text.trim();
    let result = { translation: '', items: [] };
    try {
      const m = raw.match(/\{[\s\S]*\}/);
      result = JSON.parse(m ? m[0] : raw);
    } catch {
      result.items = [{ phrase: '解析エラー', reading: '', meaning: '', note: raw.slice(0, 300) }];
    }
    res.json(result);
  } catch (err) {
    console.error('[explain]', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
