const { z } = require('zod');
const plannerService = require('../services/scheduler/plannerService');
const engine = require('../services/scheduler/schedulingEngine');
const taskService = require('../services/tasks/taskService');
const { HttpError } = require('../utils/http');

const planItems = z.object({
  items: z.array(z.object({
    task_id: z.coerce.number().int().positive().optional(),
    habit_id: z.coerce.number().int().positive().optional(),
    title: z.string().min(1).max(190),
    start_at: z.string(),
    duration_minutes: z.coerce.number().int().min(5).max(1440),
    category_id: z.coerce.number().int().positive().nullish(),
    priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    alarm: z.boolean().optional(),
  }).passthrough()).min(1).max(60),
});

const today = async (req, res) => res.json(await plannerService.getDay(req.user.id, req.query.date));
const day = async (req, res) => res.json(await plannerService.getDay(req.user.id, req.params.date));
const week = async (req, res) => res.json(await plannerService.getWeek(req.user.id, req.query.start));

async function schedule(req, res) {
  const parsed = planItems.safeParse(req.body);
  if (!parsed.success) throw new HttpError(422, parsed.error.issues[0].message);
  res.json(await plannerService.applyPlan(req.user.id, parsed.data.items));
}

/** Auto-reschedule a task to the next good slot (or return suggestions with dry_run). */
async function reschedule(req, res) {
  const taskId = Number(req.body.task_id);
  const task = await taskService.get(req.user.id, taskId);
  const s = await engine.suggest(req.user.id, {
    title: task.title,
    category_slug: task.category_slug,
    category_id: task.category_id,
    duration: task.duration_minutes,
    date: req.body.date,
    deadline: task.due_at,
    excludeTaskId: task.id,
    after: req.body.date ? undefined : new Date().toISOString(),
  });
  if (req.body.dry_run || !s.best) return res.json({ suggestion: s });
  const updated = await taskService.reschedule(req.user.id, taskId, { start_at: s.best.start_at });
  res.json({ task: updated, suggestion: s });
}

const planDayPreview = async (req, res) => res.json(await engine.planDay(req.user.id, req.query.date || req.body?.date));

module.exports = { today, day, week, schedule, reschedule, planDayPreview };
