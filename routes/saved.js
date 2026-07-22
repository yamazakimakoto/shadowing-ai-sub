import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireSubscription } from '../middleware/subscription.js';
import {
  getSavedTexts, getSavedTextById,
  insertSavedText, deleteSavedText, countSavedTexts,
  updateSavedTextExplanation, updateSavedTextChecks, reorderSavedTexts,
} from '../db.js';

const router = Router();
const MAX_SAVED = 200;

// ── 保存テキスト一覧 ───────────────────────────────────────────────
router.get('/', requireAuth, requireSubscription, (req, res) => {
  const rows = getSavedTexts(req.user.id);
  // items_json を parse し、チェック3つを checks 配列として返す
  const list = rows.map(r => ({
    ...r,
    items: r.items_json ? JSON.parse(r.items_json) : null,
    items_json: undefined,
    checks: [!!r.check1, !!r.check2, !!r.check3],
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
    checks: [!!row.check1, !!row.check2, !!row.check3],
  });
});

// ── 保存 ──────────────────────────────────────────────────────────
router.post('/', requireAuth, requireSubscription, (req, res) => {
  const { theme = '', text, translation, items, checks } = req.body;
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
    checks,
  });
  res.json({ ok: true, id });
});

// ── 部分更新（解説の永続化 / 進捗チェック） ─────────────────────────
router.patch('/:id', requireAuth, requireSubscription, (req, res) => {
  const id = parseInt(req.params.id);
  const { translation, items, checks } = req.body;

  let changes = 0;
  // 解説の更新（translation か items が指定された時のみ）
  if (translation !== undefined || items !== undefined) {
    const r = updateSavedTextExplanation(
      id, req.user.id,
      translation || null,
      items ? JSON.stringify(items) : null
    );
    changes += r.changes;
  }
  // 進捗チェックの更新（checks が指定された時のみ）
  if (Array.isArray(checks) && checks.length === 3) {
    const r = updateSavedTextChecks(id, req.user.id, checks);
    changes += r.changes;
  }
  if (changes === 0) return res.status(404).json({ error: '更新対象がありません' });
  res.json({ ok: true });
});

// ── 手動並べ替え ───────────────────────────────────────────────────
router.post('/reorder', requireAuth, requireSubscription, (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length || !ids.every(n => Number.isInteger(n))) {
    return res.status(400).json({ error: 'ids（数値配列）が必要です' });
  }
  reorderSavedTexts(req.user.id, ids);
  res.json({ ok: true });
});

// ── 削除 ──────────────────────────────────────────────────────────
router.delete('/:id', requireAuth, requireSubscription, (req, res) => {
  const result = deleteSavedText(parseInt(req.params.id), req.user.id);
  if (result.changes === 0) return res.status(404).json({ error: '見つかりません' });
  res.json({ ok: true });
});

export default router;
