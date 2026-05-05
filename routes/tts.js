import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireSubscription } from '../middleware/subscription.js';

const router = Router();

router.post('/', requireAuth, requireSubscription, async (req, res) => {
  const { text, voice = 'nova' } = req.body;
  if (!text) return res.status(400).json({ error: 'テキストが必要です' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY が未設定です' });

  const VALID_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];
  const useVoice = VALID_VOICES.includes(voice) ? voice : 'nova';

  try {
    const upstream = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: text.slice(0, 4096), // OpenAI上限
        voice: useVoice,
        response_format: 'mp3',
      }),
    });

    if (!upstream.ok) {
      const err = await upstream.json().catch(() => ({}));
      throw new Error(err.error?.message || `OpenAI TTS error ${upstream.status}`);
    }

    // ブラウザ側でも1日キャッシュできるよう設定
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');

    const buf = await upstream.arrayBuffer();
    res.send(Buffer.from(buf));
  } catch (err) {
    console.error('[tts]', err.message);
    // JSON エラーを返す（音声コンテンツ型にしない）
    res.removeHeader('Content-Type');
    res.status(500).json({ error: err.message });
  }
});

export default router;
