const bcrypt = require('bcryptjs');
const { query, one } = require('../config/db');
const env = require('../config/env');
const { HttpError } = require('../utils/http');
const { signToken, setAuthCookie, clearAuthCookie } = require('../middleware/auth');
const { ensureUserDefaults, getPreferences } = require('../models/userModel');
const activity = require('../services/activityService');

function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    timezone: row.timezone,
    theme: row.theme,
    role: row.role || 'user',
  };
}

async function register(req, res) {
  const { name, email, password, timezone } = req.body;
  const exists = await one('SELECT id FROM users WHERE email = ?', [email]);
  if (exists) throw new HttpError(409, 'An account with this email already exists');
  const hash = await bcrypt.hash(password, 12);
  const r = await query('INSERT INTO users (name, email, password_hash, timezone) VALUES (?, ?, ?, ?)', [name, email, hash, timezone || env.defaultTimezone]);
  await ensureUserDefaults(r.insertId);
  const user = publicUser(await one('SELECT id, name, email, timezone, theme, role FROM users WHERE id = ?', [r.insertId]));
  const token = signToken(user);
  setAuthCookie(res, token);
  activity.touchSession(user.id).catch(() => {});
  res.status(201).json({ user, token, preferences: await getPreferences(user.id) });
}

async function login(req, res) {
  const { email, password } = req.body;
  const row = await one('SELECT * FROM users WHERE email = ?', [email]);
  // Compare against a dummy hash when the user doesn't exist to keep timing uniform.
  const ok = await bcrypt.compare(password, row ? row.password_hash : '$2a$12$C6UzMDM.H6dfI/f/IKcEeO5k1Ff3Yd6ZsVq1n1lXJb2I3sQGkX7lK');
  if (!row || !ok) throw new HttpError(401, 'Invalid email or password');
  await ensureUserDefaults(row.id);
  const user = publicUser(row);
  const token = signToken(user);
  setAuthCookie(res, token);
  activity.touchSession(user.id).catch(() => {});
  res.json({ user, token, preferences: await getPreferences(user.id) });
}

async function me(req, res) {
  res.json({ user: req.user, preferences: await getPreferences(req.user.id) });
}

async function logout(_req, res) {
  clearAuthCookie(res);
  res.json({ ok: true });
}

async function changePassword(req, res) {
  const { current_password: current, new_password: next } = req.body;
  if (!next || next.length < 8) throw new HttpError(422, 'New password must be at least 8 characters');
  const row = await one('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (!(await bcrypt.compare(String(current || ''), row.password_hash))) throw new HttpError(401, 'Current password is incorrect');
  await query('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(next, 12), req.user.id]);
  res.json({ ok: true });
}

module.exports = { register, login, me, logout, changePassword };
