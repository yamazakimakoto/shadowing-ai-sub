import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireSubscription } from '../middleware/subscription.js';

const router = Router();

router.post('/', requireAuth, requireSubscription, async (req, res) => {
  const { audio, mimeType = 'audio/webm', reference } = req.body;
  if (!audio || !reference) {
    return res.status(400).json({ error: 'audio と reference が必要です' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'WHISPER_NOT_AVAILABLE' });

  try {
    const buffer = Buffer.from(audio, 'base64');
    const ext    = mimeType.includes('mp4') ? 'mp4'
                 : mimeType.includes('wav') ? 'wav'
                 : 'webm';
    const formData = new FormData();
    formData.append('file', new File([buffer], `audio.${ext}`, { type: mimeType }));
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');

    const upstream = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData,
    });
    if (!upstream.ok) {
      const err = await upstream.json().catch(() => ({}));
      throw new Error(err.error?.message || `Whisper error ${upstream.status}`);
    }
    const data       = await upstream.json();
    const transcript = (data.text || '').trim();
    const score      = calcScore(reference, transcript);

    console.log(`[score] user=${req.user.id} ref="${reference.slice(0, 40)}…" score=${score}`);
    res.json({ score, transcript });
  } catch (err) {
    console.error('[score]', err.message);
    res.status(500).json({ error: err.message });
  }
});

function calcScore(reference, transcript) {
  const norm = s => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().split(/\s+/).filter(Boolean);
  const refW = norm(reference);
  const hypW = norm(transcript);
  if (!refW.length || !hypW.length) return 0;
  const cnt = {};
  refW.forEach(w => { cnt[w] = (cnt[w] || 0) + 1; });
  let matched = 0;
  hypW.forEach(w => { if (cnt[w] > 0) { matched++; cnt[w]--; } });
  return Math.round((matched / refW.length) * 100);
}

export default router;
