const { query, one } = require('../config/db');
const aiService = require('../services/ai/aiService');
const executor = require('../services/ai/actionExecutor');
const llm = require('../services/ai/llmClient');
const { HttpError, notFound } = require('../utils/http');

const message = async (req, res) => res.json(await aiService.handleMessage(req.user.id, req.body.text, req.body.input_mode || 'text'));

async function confirm(req, res) {
  const action = await one('SELECT * FROM ai_actions WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
  if (!action) throw notFound('Suggestion');
  const opts = {};
  if (req.body?.alternative_index !== undefined) opts.alternative_index = Number(req.body.alternative_index);
  if (req.body?.start_at) opts.start_at = String(req.body.start_at);
  if (Array.isArray(req.body?.items)) opts.items = req.body.items;
  const out = await executor.execute(req.user.id, action, opts);
  res.status(out.ok ? 200 : 409).json(out);
}

async function reject(req, res) {
  const r = await query("UPDATE ai_actions SET status = 'rejected' WHERE id = ? AND user_id = ? AND status = 'proposed'", [Number(req.params.id), req.user.id]);
  if (!r.affectedRows) throw notFound('Suggestion');
  res.json({ ok: true });
}

const history = async (req, res) => res.json({ messages: await aiService.history(req.user.id, Math.min(Number(req.query.limit) || 50, 200)), llm: llm.isConfigured() });

const planDay = async (req, res) => res.json(await aiService.runIntent(req.user.id, { intent: 'PLAN_DAY', date: req.body?.date || null, time_of_day: req.body?.time_of_day || null }));

async function planWeek(req, res) {
  if (req.body?.text) return res.json(await aiService.handleMessage(req.user.id, req.body.text));
  res.json(await aiService.runIntent(req.user.id, { intent: 'PLAN_WEEK', requests: req.body?.requests || [], week: req.body?.week || 'this' }));
}

async function suggestTime(req, res) {
  const b = req.body || {};
  if (!b.task_id && !b.title) throw new HttpError(422, 'title or task_id is required');
  res.json(await aiService.runIntent(req.user.id, {
    intent: 'SUGGEST_TIME',
    task_id: b.task_id || null,
    task_title: b.title || null,
    target: b.title || null,
    category: b.category || null,
    duration_minutes: b.duration_minutes || null,
    date: b.date || null,
    time_of_day: b.time_of_day || null,
  }));
}

async function reschedule(req, res) {
  const b = req.body || {};
  if (b.text) return res.json(await aiService.handleMessage(req.user.id, b.text));
  if (!b.task_id) throw new HttpError(422, 'task_id or text is required');
  res.json(await aiService.runIntent(req.user.id, { intent: 'RESCHEDULE', task_id: b.task_id, new_date: b.date || null, new_time: b.time || null, new_time_of_day: b.time_of_day || null }));
}

module.exports = { message, confirm, reject, history, planDay, planWeek, suggestTime, reschedule };
