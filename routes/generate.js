import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { requireAuth } from '../middleware/auth.js';
import { requireSubscription, requireGenQuota } from '../middleware/subscription.js';
import { incrementGenUsed } from '../db.js';

const router = Router();
const MODEL = process.env.GENERATION_MODEL || 'claude-haiku-4-5';
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// 難易度レベルごとのプロンプト指示（CEFR/英検の目安に対応）
const LEVEL_GUIDES = {
  beginner: `- Level: BEGINNER (CEFR A1-A2 / Eiken Grade 3, Japanese junior high school English)
- Use only simple, common vocabulary (the ~1500 most frequent English words)
- Short sentences (max ~10 words each), present/past/simple future tenses only
- No idioms, no phrasal verbs beyond the most basic ones`,
  intermediate: `- Level: INTERMEDIATE (CEFR B1 / Eiken Grade 2, Japanese high school English)
- Natural, everyday English for intermediate learners
- Moderate sentence length, common idioms are OK`,
  upper: `- Level: UPPER-INTERMEDIATE (CEFR B2 / Eiken Pre-1, TOEIC 700+)
- Sophisticated everyday and business vocabulary, natural idioms and phrasal verbs
- Varied sentence structures including relative clauses and conditionals`,
  advanced: `- Level: ADVANCED (CEFR C1+ / Eiken Grade 1, near-native)
- Advanced vocabulary, nuanced expressions, idiomatic and natural phrasing
- Complex sentence structures, abstract concepts welcome
- The kind of English found in quality journalism or professional discourse`,
};

router.post('/', requireAuth, requireSubscription, requireGenQuota, async (req, res) => {
  const { theme, style = 'dialogue', level = 'intermediate' } = req.body;
  if (!theme) return res.status(400).json({ error: 'テーマを入力してください' });

  const subId = req.subscription.id;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const styleGuide = style === 'monologue'
    ? 'Write a short narrative or descriptive paragraph (NOT a dialogue). Do not use A:/B: format.'
    : 'Write a natural 2-person dialogue. Prefix each speaker\'s line with "A:" or "B:" on separate lines.';
  const levelGuide = LEVEL_GUIDES[level] || LEVEL_GUIDES.intermediate;

  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `Generate an English conversation practice text about: "${theme}".

Requirements:
- About 200-300 characters
${levelGuide}
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
