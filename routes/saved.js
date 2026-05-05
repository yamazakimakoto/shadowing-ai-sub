import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireSubscription } from '../middleware/subscription.js';
import {
  getSavedTexts, getSavedTextById,
  insertSavedText, deleteSavedText, countSavedTexts,
} from '../db.js';

const router = Router();
const MAX_SAVED = 200;

// ── 保存テキスト一覧 ───────────────────────────────────────────────
router.get('/', requireAuth, requireSubscription, (req, res) => {
  const rows = getSavedTexts(req.user.id);
  // items_json を parse してから返す
  const list = rows.map(r => ({
    ...r,
    items: r.items_json ? JSON.parse(r.items_json) : null,
    items_json: undefined,
  }));
  res.json(list);
});

// ── 保存テキスト単体取得 ───────────────────────────────────────────
router.get('/:id', requireAuth, requireSubscription, (req, res) => {
  const row = getSavedTextById(parseInt(req.params.id), req.user.id);
  if (!row) return res.status(404).json({ error: '見つかりません' });
  res.json({
    ...row,
    items: row.items_json ? JSON.parse(row.items_json) : null,
    items_json: undefined,
  });
});

// ── 保存 ──────────────────────────────────────────────────────────
router.post('/', requireAuth, requireSubscription, (req, res) => {
  const { theme = '', text, translation, items } = req.body;
  if (!text) return res.status(400).json({ error: 'テキストが必要です' });

  const cnt = countSavedTexts(req.user.id);
  if (cnt >= MAX_SAVED) {
    return res.status(400).json({ error: `保存上限（${MAX_SAVED}件）に達しました` });
  }

  const id = insertSavedText({
    userId: req.user.id,
    theme,
    text,
    translation: translation || null,
    items_json: items ? JSON.stringify(items) : null,
  });
  res.json({ ok: true, id });
});

// ── 削除 ──────────────────────────────────────────────────────────
router.delete('/:id', requireAuth, requireSubscription, (req, res) => {
  const result = deleteSavedText(parseInt(req.params.id), req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: '見つかりません' });
  res.json({ ok: true });
});

export default router;
