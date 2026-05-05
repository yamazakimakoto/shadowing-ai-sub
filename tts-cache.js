/**
 * サーバーサイド TTS ディスクキャッシュ
 * Render.com Persistent Disk (/data/tts-cache/) に mp3 を保存する。
 * キー: sha256(voice:text).mp3
 */
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const CACHE_DIR = process.env.TTS_CACHE_DIR ||
  (process.env.NODE_ENV === 'production' ? '/data/tts-cache' : './tts-cache-dev');

const MAX_CACHE_MB = parseInt(process.env.TTS_CACHE_MAX_MB || '200');  // 200MB 上限

function ensureDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

function cacheKey(text, voice) {
  return createHash('sha256').update(`${voice}:${text}`).digest('hex');
}

function cachePath(key) {
  return join(CACHE_DIR, `${key}.mp3`);
}

/** キャッシュから Buffer を取得（なければ null） */
export function getCached(text, voice) {
  ensureDir();
  const p = cachePath(cacheKey(text, voice));
  return existsSync(p) ? readFileSync(p) : null;
}

/** Buffer をキャッシュに書き込む（容量超過時はスキップ） */
export function setCached(text, voice, buffer) {
  ensureDir();
  // 容量チェック（簡易）
  try {
    const files = readdirSync(CACHE_DIR);
    const totalMB = files.reduce((sum, f) => {
      try { return sum + statSync(join(CACHE_DIR, f)).size; } catch { return sum; }
    }, 0) / (1024 * 1024);
    if (totalMB > MAX_CACHE_MB) {
      console.warn(`[tts-cache] ${totalMB.toFixed(0)}MB 超過 — キャッシュスキップ`);
      return;
    }
  } catch { /* 容量チェック失敗は無視 */ }

  try {
    writeFileSync(cachePath(cacheKey(text, voice)), buffer);
  } catch (e) {
    console.warn('[tts-cache] write error:', e.message);
  }
}
