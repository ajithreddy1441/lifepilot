const { query, one, transaction } = require('../../config/db');
const { notFound } = require('../../utils/http');
const { publish } = require('../../utils/events');
const { DateTime, todayIn } = require('../../utils/time');
const { getUser } = require('../../models/userModel');
const llm = require('../ai/llmClient');
const rules = require('../ai/intentParser');

async function list(userId) {
  const goals = await query(
    `SELECT g.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
       (SELECT COUNT(*) FROM tasks t WHERE t.goal_id = g.id AND t.status <> 'cancelled') AS task_total,
       (SELECT COUNT(*) FROM tasks t WHERE t.goal_id = g.id AND t.status = 'completed') AS task_done
     FROM goals g LEFT JOIN categories c ON c.id = g.category_id WHERE g.user_id = ? ORDER BY g.status, g.target_date IS NULL, g.target_date`,
    [userId],
  );
  if (!goals.length) return [];
  const ms = await query('SELECT * FROM goal_milestones WHERE goal_id IN (?) ORDER BY sort_order, id', [goals.map((g) => g.id)]);
  return goals.map((g) => {
    const milestones = ms.filter((m) => m.goal_id === g.id);
    let progress = 0;
    if (g.target_value) progress = g.current_value / g.target_value;
    else if (milestones.length) progress = milestones.filter((m) => m.completed_at).length / milestones.length;
    else if (g.task_total) progress = g.task_done / g.task_total;
    return { ...g, milestones, progress: Math.min(100, Math.round(progress * 100)) };
  });
}

async function create(userId, data) {
  const id = await transaction(async (q) => {
    const res = await q(
      'INSERT INTO goals (user_id, category_id, title, description, target_value, current_value, unit, target_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [userId, data.category_id || null, data.title, data.description || null, data.target_value || null, data.current_value || 0, data.unit || null, data.target_date || null],
    );
    for (const [i, m] of (data.milestones || []).entries()) {
      await q('INSERT INTO goal_milestones (goal_id, title, due_date, sort_order) VALUES (?, ?, ?, ?)', [res.insertId, m.title, m.due_date || null, i]);
    }
    return res.insertId;
  });
  publish(userId, 'goals_changed', {});
  return (await list(userId)).find((g) => g.id === id);
}

async function update(userId, id, data) {
  const g = await one('SELECT id FROM goals WHERE id = ? AND user_id = ?', [id, userId]);
  if (!g) throw notFound('Goal');
  const cols = ['category_id', 'title', 'description', 'target_value', 'current_value', 'unit', 'target_date', 'status'].filter((c) => data[c] !== undefined);
  if (cols.length) await query(`UPDATE goals SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map((c) => data[c]), id]);
  if (data.milestones) {
    for (const [i, m] of data.milestones.entries()) {
      await query('INSERT INTO goal_milestones (goal_id, title, due_date, sort_order) VALUES (?, ?, ?, ?)', [id, m.title, m.due_date || null, 100 + i]);
    }
  }
  publish(userId, 'goals_changed', {});
  return (await list(userId)).find((x) => x.id === id);
}

async function remove(userId, id) {
  const r = await query('DELETE FROM goals WHERE id = ? AND user_id = ?', [id, userId]);
  if (!r.affectedRows) throw notFound('Goal');
  publish(userId, 'goals_changed', {});
}

async function toggleMilestone(userId, goalId, milestoneId) {
  const m = await one('SELECT m.* FROM goal_milestones m JOIN goals g ON g.id = m.goal_id WHERE m.id = ? AND g.id = ? AND g.user_id = ?', [milestoneId, goalId, userId]);
  if (!m) throw notFound('Milestone');
  await query('UPDATE goal_milestones SET completed_at = IF(completed_at IS NULL, UTC_TIMESTAMP(), NULL) WHERE id = ?', [milestoneId]);
  publish(userId, 'goals_changed', {});
}

/** Break a goal into concrete, unscheduled tasks the user can review before adding. */
async function breakdown(userId, id) {
  const g = await one('SELECT * FROM goals WHERE id = ? AND user_id = ?', [id, userId]);
  if (!g) throw notFound('Goal');
  const user = await getUser(userId);
  const today = todayIn(user.timezone);
  const end = g.target_date || DateTime.fromISO(today).plus({ weeks: 4 }).toISODate();
  const weeks = Math.max(1, Math.round(DateTime.fromISO(end).diff(DateTime.fromISO(today), 'weeks').weeks));

  if (llm.isConfigured()) {
    try {
      const out = await llm.chat([
        { role: 'system', content: 'Break the goal into 3-8 concrete tasks. Reply JSON: {"tasks":[{"title":"...","duration_minutes":30-180,"due_date":"YYYY-MM-DD"}]}. Spread due dates between today and the target date. Keep titles short.' },
        { role: 'user', content: `Today ${today}. Goal: ${g.title}. ${g.description || ''} Target date: ${end}.${g.target_value ? ` Target: ${g.target_value} ${g.unit || ''}` : ''}` },
      ], { json: true });
      if (Array.isArray(out.tasks) && out.tasks.length) {
        return out.tasks.slice(0, 8).map((t) => ({ title: String(t.title).slice(0, 120), duration_minutes: Math.min(240, Math.max(15, Number(t.duration_minutes) || 60)), due_date: /^\d{4}-\d{2}-\d{2}$/.test(t.due_date) ? t.due_date : end }));
      }
    } catch (err) {
      console.warn('[goals] LLM breakdown failed:', err.message);
    }
  }
  const slug = rules.detectCategory(g.title) || 'goals';
  const duration = rules.DEFAULT_DURATION[slug] || 60;
  const count = g.target_value && g.target_value <= 12 ? g.target_value - g.current_value : Math.min(6, weeks * 2);
  const noun = g.title.replace(/^(write|build|complete|finish|lose|read|learn)\s+(\d+\s+)?/i, '').replace(/s$/, '');
  return Array.from({ length: Math.max(1, count) }, (_, i) => ({
    title: g.target_value ? `${g.title.split(' ')[0]} ${noun} #${g.current_value + i + 1}` : `${g.title} — step ${i + 1}`,
    duration_minutes: duration,
    due_date: DateTime.fromISO(today).plus({ days: Math.round(((i + 1) * weeks * 7) / Math.max(1, count)) }).toISODate(),
  }));
}

module.exports = { list, create, update, remove, toggleMilestone, breakdown };
