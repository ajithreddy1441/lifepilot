const { query, one } = require('../config/db');
const { HttpError, notFound } = require('../utils/http');
const { getPreferences, listCategories, slugify, getUser } = require('../models/userModel');
const { normTime, parseDays, formatDays } = require('../utils/time');
const alarmService = require('../services/alarms/alarmService');

async function updateProfile(req, res) {
  const { name, timezone, theme } = req.body;
  const before = await getUser(req.user.id);
  const sets = [];
  const vals = [];
  if (name !== undefined) { sets.push('name = ?'); vals.push(name); }
  if (timezone !== undefined) { sets.push('timezone = ?'); vals.push(timezone); }
  if (theme !== undefined) { sets.push('theme = ?'); vals.push(theme); }
  if (sets.length) await query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...vals, req.user.id]);

  // Travelling: keep alarms at the same local wall-clock time in the new timezone.
  let movedAlarms = 0;
  if (timezone && timezone !== before.timezone && req.body.move_alarms !== false) {
    const alarms = await query("SELECT id FROM alarms WHERE user_id = ? AND status = 'active' AND timezone = ?", [req.user.id, before.timezone]);
    for (const a of alarms) {
      await alarmService.update(req.user.id, a.id, { timezone });
      movedAlarms += 1;
    }
  }
  res.json({ user: await getUser(req.user.id), moved_alarms: movedAlarms });
}

async function getPrefs(req, res) {
  res.json({ preferences: await getPreferences(req.user.id) });
}

async function updatePrefs(req, res) {
  const body = { ...req.body };
  if (body.work_days) body.work_days = formatDays(body.work_days);
  const cols = Object.keys(body);
  if (cols.length) {
    await query(
      `UPDATE user_preferences SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE user_id = ?`,
      [...cols.map((c) => (typeof body[c] === 'boolean' ? Number(body[c]) : body[c])), req.user.id],
    );
  }
  const prefs = await getPreferences(req.user.id);
  if (req.body.work_start || req.body.work_end || req.body.work_days) {
    await query("UPDATE schedule_blocks SET start_time = ?, end_time = ?, days = ? WHERE user_id = ? AND block_type = 'work'", [prefs.work_start, prefs.work_end, prefs.work_days.join(','), req.user.id]);
  }
  res.json({ preferences: prefs });
}

const getCategories = async (req, res) => res.json({ categories: await listCategories(req.user.id) });

async function createCategory(req, res) {
  const { name, icon, color } = req.body;
  try {
    const r = await query('INSERT INTO categories (user_id, name, slug, icon, color) VALUES (?, ?, ?, ?, ?)', [req.user.id, name, slugify(name), icon || '📌', color || '#6366f1']);
    res.status(201).json({ category: await one('SELECT * FROM categories WHERE id = ?', [r.insertId]) });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'A category with this name already exists');
    throw err;
  }
}

async function updateCategory(req, res) {
  const cat = await one('SELECT * FROM categories WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
  if (!cat) throw notFound('Category');
  const { name, icon, color } = req.body;
  await query('UPDATE categories SET name = ?, icon = ?, color = ? WHERE id = ?', [name ?? cat.name, icon ?? cat.icon, color ?? cat.color, cat.id]);
  res.json({ category: await one('SELECT * FROM categories WHERE id = ?', [cat.id]) });
}

async function deleteCategory(req, res) {
  const cat = await one('SELECT * FROM categories WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
  if (!cat) throw notFound('Category');
  if (cat.is_default) throw new HttpError(400, 'Default categories can be renamed but not deleted');
  await query('DELETE FROM categories WHERE id = ?', [cat.id]);
  res.json({ ok: true });
}

const shapeBlock = (b) => ({ ...b, days: parseDays(b.days), start_time: normTime(b.start_time), end_time: normTime(b.end_time), active: !!b.active });

async function getBlocks(req, res) {
  const rows = await query('SELECT * FROM schedule_blocks WHERE user_id = ? ORDER BY start_time', [req.user.id]);
  res.json({ blocks: rows.map(shapeBlock) });
}

async function createBlock(req, res) {
  const b = req.body;
  const r = await query('INSERT INTO schedule_blocks (user_id, title, block_type, days, start_time, end_time, icon) VALUES (?, ?, ?, ?, ?, ?, ?)', [req.user.id, b.title, b.block_type || 'other', formatDays(b.days), b.start_time, b.end_time, b.icon || null]);
  res.status(201).json({ block: shapeBlock(await one('SELECT * FROM schedule_blocks WHERE id = ?', [r.insertId])) });
}

async function updateBlock(req, res) {
  const b = req.body;
  const r = await query(
    'UPDATE schedule_blocks SET title = ?, block_type = ?, days = ?, start_time = ?, end_time = ?, icon = ?, active = ? WHERE id = ? AND user_id = ?',
    [b.title, b.block_type || 'other', formatDays(b.days), b.start_time, b.end_time, b.icon || null, b.active === false ? 0 : 1, Number(req.params.id), req.user.id],
  );
  if (!r.affectedRows) throw notFound('Block');
  res.json({ block: shapeBlock(await one('SELECT * FROM schedule_blocks WHERE id = ?', [Number(req.params.id)])) });
}

async function deleteBlock(req, res) {
  await query('DELETE FROM schedule_blocks WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
  res.json({ ok: true });
}

module.exports = { updateProfile, getPrefs, updatePrefs, getCategories, createCategory, updateCategory, deleteCategory, getBlocks, createBlock, updateBlock, deleteBlock };
