// Habits, goals, reviews and analytics.
const habitService = require('../services/habits/habitService');
const goalService = require('../services/goals/goalService');
const reviewService = require('../services/reviews/reviewService');
const taskService = require('../services/tasks/taskService');
const { localToUtc } = require('../utils/time');

const id = (req) => Number(req.params.id);

module.exports = {
  listHabits: async (req, res) => res.json({ habits: await habitService.list(req.user.id) }),
  createHabit: async (req, res) => res.status(201).json({ habit: await habitService.create(req.user.id, req.body) }),
  updateHabit: async (req, res) => res.json({ habit: await habitService.update(req.user.id, id(req), req.body) }),
  deleteHabit: async (req, res) => { await habitService.remove(req.user.id, id(req)); res.json({ ok: true }); },
  logHabit: async (req, res) => res.json(await habitService.toggleLog(req.user.id, id(req), req.body?.date)),

  listGoals: async (req, res) => res.json({ goals: await goalService.list(req.user.id) }),
  createGoal: async (req, res) => res.status(201).json({ goal: await goalService.create(req.user.id, req.body) }),
  updateGoal: async (req, res) => res.json({ goal: await goalService.update(req.user.id, id(req), req.body) }),
  deleteGoal: async (req, res) => { await goalService.remove(req.user.id, id(req)); res.json({ ok: true }); },
  toggleMilestone: async (req, res) => { await goalService.toggleMilestone(req.user.id, id(req), Number(req.params.mid)); res.json({ ok: true }); },
  breakdownGoal: async (req, res) => res.json({ tasks: await goalService.breakdown(req.user.id, id(req)) }),
  async addGoalTasks(req, res) {
    const created = [];
    for (const t of (req.body?.tasks || []).slice(0, 12)) {
      created.push(await taskService.create(req.user.id, {
        title: String(t.title).slice(0, 190),
        duration_minutes: Math.min(480, Math.max(5, Number(t.duration_minutes) || 60)),
        due_at: t.due_date ? localToUtc(t.due_date, '21:00', req.user.timezone).toISOString() : null,
        goal_id: id(req),
        source: 'ai',
      }));
    }
    res.status(201).json({ tasks: created });
  },

  dailyReview: async (req, res) => res.json(await reviewService.daily(req.user.id, req.query.date)),
  saveDailyReview: async (req, res) => { await reviewService.saveDailyNotes(req.user.id, req.body.date, req.body); res.json({ ok: true }); },
  weeklyReview: async (req, res) => res.json(await reviewService.weekly(req.user.id, req.query.start)),
  analytics: async (req, res) => res.json(await reviewService.analytics(req.user.id, req.query.range)),
};
