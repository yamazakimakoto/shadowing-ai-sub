import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireSubscription } from '../middleware/subscription.js';
import { getCached, setCached } from '../tts-cache.js';

const router = Router();

const VALID_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];

router.post('/', requireAuth, requireSubscription, async (req, res) => {
  const { text, voice = 'nova' } = req.body;
  if (!text) return res.status(400).json({ error: 'テキストが必要です' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY が未設定です' });

  const useVoice = VALID_VOICES.includes(voice) ? voice : 'nova';

  // ── ①ディスクキャッシュ確認 ───────────────────────────────────────
  const cached = getCached(text, useVoice);
  if (cached) {
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Cache', 'HIT');
    return res.send(cached);
  }

  // ── ② OpenAI TTS API 呼び出し ────────────────────────────────────
  try {
    const upstream = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: text.slice(0, 4096),
        voice: useVoice,
        response_format: 'mp3',
      }),
    });

    if (!upstream.ok) {
      const err = await upstream.json().catch(() => ({}));
      throw new Error(err.error?.message || `OpenAI TTS error ${upstream.status}`);
    }

    const buf = Buffer.from(await upstream.arrayBuffer());

    // ③ ディスクに保存（非同期・失敗しても処理継続）
    setCached(text, useVoice, buf);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Cache', 'MISS');
    res.send(buf);
  } catch (err) {
    console.error('[tts]', err.message);
    res.removeHeader('Content-Type');
    res.status(500).json({ error: err.message });
  }
});

export default router;
