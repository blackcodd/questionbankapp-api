import jwt from 'jsonwebtoken';

export function requireAuth(req, res, next) {
  const h = req.headers.authorization ?? '';
  if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'Please log in' });
  
  const token = h.slice(7).trim();

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (e) {
    console.log('AUTH FAIL:', e.message);
    res.status(401).json({ error: 'Session expired, please log in again' });
  }
}