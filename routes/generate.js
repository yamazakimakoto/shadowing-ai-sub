import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth } from '../middleware/auth.js';
import { requireSubscription, requireGenQuota } from '../middleware/subscription.js';
import { incrementGenUsed } from '../db.js';

const router = Router();
const MODEL = process.env.GENERATION_MODEL || 'claude-haiku-4-5';
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

router.post('/', requireAuth, requireSubscription, requireGenQuota, async (req, res) => {
  const { theme, style = 'dialogue' } = req.body;
  if (!theme) return res.status(400).json({ error: 'テーマを入力してください' });

  const subId = req.subscription.id;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const styleGuide = style === 'monologue'
    ? 'Write a short narrative or descriptive paragraph (NOT a dialogue). Do not use A:/B: format.'
    : 'Write a natural 2-person dialogue. Prefix each speaker\'s line with "A:" or "B:" on separate lines.';

  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `Generate an English conversation practice text about: "${theme}".

Requirements:
- About 200-300 characters
- Natural, everyday English for intermediate learners
- ${styleGuide}

Output ONLY the English text. No title, no label, no explanation.`,
      }],
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    // 生成成功後にカウントを増やす（オーナーはカウント対象外）
    if (!req.subscription.owner) incrementGenUsed(subId);
    const updated = req.subscription;
    res.write(`data: ${JSON.stringify({ done: true, gen_used: updated.gen_used + 1, gen_max: updated.gen_max })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('[generate]', err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

export default router;
