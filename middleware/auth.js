import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

/** JWT 認証ミドルウェア — req.user に { id, email, name } をセット */
export function requireAuth(req, res, next) {
  // httpOnly Cookie または Authorization ヘッダから取得
  const token = req.cookies?.token || extractBearer(req.headers.authorization);
  if (!token) return res.status(401).json({ error: 'ログインが必要です' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.id, email: payload.email, name: payload.name };
    next();
  } catch {
    res.status(401).json({ error: 'セッションが無効です。再ログインしてください。' });
  }
}

function extractBearer(header) {
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7);
}

export function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}
