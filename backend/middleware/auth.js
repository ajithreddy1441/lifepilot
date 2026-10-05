const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { one } = require('../config/db');
const { HttpError } = require('../utils/http');
const activity = require('../services/activityService');

const COOKIE = 'lp_token';

function signToken(user) {
  return jwt.sign({ sub: user.id }, env.jwtSecret, { expiresIn: env.jwtExpiresIn });
}

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  if (req.cookies && req.cookies[COOKIE]) return req.cookies[COOKIE];
  // EventSource cannot send headers; only the SSE route accepts a query token.
  if (req.path.endsWith('/events/stream') && req.query.token) return String(req.query.token);
  return null;
}

async function requireAuth(req, _res, next) {
  try {
    const token = extractToken(req);
    if (!token) throw new HttpError(401, 'Authentication required');
    let payload;
    try {
      payload = jwt.verify(token, env.jwtSecret);
    } catch {
      throw new HttpError(401, 'Session expired, please sign in again');
    }
    const user = await one('SELECT id, name, email, timezone, theme, role, last_seen_at FROM users WHERE id = ?', [payload.sub]);
    if (!user) throw new HttpError(401, 'Account not found');
    req.user = user;
    activity.touchSession(user.id).catch(() => {});
    next();
  } catch (err) {
    next(err);
  }
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: env.isProd ? 'none' : 'lax',
    maxAge: 30 * 24 * 3600 * 1000,
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE, { httpOnly: true, secure: env.isProd, sameSite: env.isProd ? 'none' : 'lax' });
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return next(new HttpError(403, 'Admin access required'));
  }
  next();
}

module.exports = { requireAuth, requireAdmin, signToken, setAuthCookie, clearAuthCookie };
