const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const { migrateOnce } = require('../db/migrateLib');
const { asyncHandler: h, HttpError } = require('../utils/http');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const S = require('../models/schemas');

const auth = require('../controllers/authController');
const tasks = require('../controllers/taskController');
const planner = require('../controllers/plannerController');
const assistant = require('../controllers/assistantController');
const voice = require('../controllers/voiceController');
const alarms = require('../controllers/alarmController');
const devices = require('../controllers/deviceController');
const notifications = require('../controllers/notificationController');
const settings = require('../controllers/settingsController');
const life = require('../controllers/lifeController');
const events = require('../controllers/eventsController');
const admin = require('../controllers/adminController');

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many attempts, try again later' } });
const aiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Slow down — too many assistant requests' } });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const r = express.Router();

r.use((req, res, next) => {
  if (env.missing.length) {
    return next(
      new HttpError(
        503,
        `API is missing ${env.missing.join(', ')}. Add ${env.missing.join(', ')} in the Vercel backend project → Settings → Environment Variables (Production), then Redeploy.`,
      ),
    );
  }
  next();
});

r.use(
  h(async (_req, _res, next) => {
    try {
      await migrateOnce();
    } catch (err) {
      throw new HttpError(503, `Could not prepare the database (${err.code || err.message}).`);
    }
    next();
  }),
);

// Auth
r.post('/auth/register', authLimiter, validate(S.register), h(auth.register));
r.post('/auth/login', authLimiter, validate(S.login), h(auth.login));
r.post('/auth/logout', h(auth.logout));
r.get('/notifications/vapid-public-key', notifications.vapidKey);

r.use(requireAuth);
r.get('/auth/me', h(auth.me));
r.post('/auth/change-password', authLimiter, h(auth.changePassword));

// Live updates
r.get('/events/stream', events.stream);

// Tasks
r.get('/tasks', h(tasks.list));
r.post('/tasks', validate(S.taskCreate), h(tasks.create));
r.get('/tasks/:id', h(tasks.get));
r.put('/tasks/:id', validate(S.taskUpdate), h(tasks.update));
r.delete('/tasks/:id', h(tasks.remove));
r.post('/tasks/:id/complete', h(tasks.complete));
r.post('/tasks/:id/reschedule', validate(S.reschedule), h(tasks.reschedule));

// Planner
r.get('/planner/today', h(planner.today));
r.get('/planner/day/:date', h(planner.day));
r.get('/planner/week', h(planner.week));
r.get('/planner/plan-day', h(planner.planDayPreview));
r.post('/planner/schedule', h(planner.schedule));
r.post('/planner/reschedule', h(planner.reschedule));

// AI assistant
r.post('/assistant/message', aiLimiter, validate(S.assistantMessage), h(assistant.message));
r.get('/assistant/history', h(assistant.history));
r.post('/assistant/actions/:id/confirm', h(assistant.confirm));
r.post('/assistant/actions/:id/reject', h(assistant.reject));
r.post('/assistant/plan-day', aiLimiter, h(assistant.planDay));
r.post('/assistant/plan-week', aiLimiter, h(assistant.planWeek));
r.post('/assistant/suggest-time', aiLimiter, h(assistant.suggestTime));
r.post('/assistant/reschedule', aiLimiter, h(assistant.reschedule));

// Voice
r.get('/voice/status', voice.status);
r.post('/voice/transcribe', aiLimiter, upload.single('audio'), h(voice.transcribe));

// Alarms
r.get('/alarms', h(alarms.list));
r.post('/alarms', validate(S.alarmCreate), h(alarms.create));
r.get('/alarms/:id', h(alarms.get));
r.put('/alarms/:id', validate(S.alarmUpdate), h(alarms.update));
r.delete('/alarms/:id', h(alarms.remove));
r.post('/alarms/:id/enable', h(alarms.enable));
r.post('/alarms/:id/disable', h(alarms.disable));
r.post('/alarms/:id/test', h(alarms.test));
r.post('/alarms/:id/snooze', h(alarms.snooze));

// Devices + alarm sync
r.post('/devices/register', validate(S.deviceRegister), h(devices.register));
r.get('/devices', h(devices.list));
r.get('/devices/diagnostics', h(devices.diagnostics));
r.get('/devices/alarms', h(devices.alarmsFeed));
r.post('/devices/test-alarm', h(devices.testAlarm));
r.delete('/devices/:id', h(devices.remove));
r.post('/devices/:id/sync', validate(S.deviceSync), h(devices.sync));

// Notifications
r.get('/notifications', h(notifications.list));
r.get('/notifications/upcoming', h(notifications.upcoming));
r.post('/notifications/subscribe', validate(S.pushSubscribe), h(notifications.subscribe));
r.post('/notifications/unsubscribe', h(notifications.unsubscribe));
r.post('/notifications/test', h(notifications.test));
r.post('/notifications/read-all', h(notifications.readAll));
r.get('/notifications/preferences', h(notifications.getPreferences));
r.put('/notifications/preferences', validate(S.notificationPreferences), h(notifications.updatePreferences));
r.put('/notifications/:id/read', h(notifications.read));
r.delete('/notifications/:id', h(notifications.remove));

// Settings
r.put('/settings/profile', validate(S.profile.extend({ move_alarms: S.z.boolean().optional() })), h(settings.updateProfile));
r.get('/settings/preferences', h(settings.getPrefs));
r.put('/settings/preferences', validate(S.preferences), h(settings.updatePrefs));
r.get('/categories', h(settings.getCategories));
r.post('/categories', validate(S.category), h(settings.createCategory));
r.put('/categories/:id', validate(S.category.partial()), h(settings.updateCategory));
r.delete('/categories/:id', h(settings.deleteCategory));
r.get('/schedule-blocks', h(settings.getBlocks));
r.post('/schedule-blocks', validate(S.scheduleBlock), h(settings.createBlock));
r.put('/schedule-blocks/:id', validate(S.scheduleBlock), h(settings.updateBlock));
r.delete('/schedule-blocks/:id', h(settings.deleteBlock));

// Habits & goals
r.get('/habits', h(life.listHabits));
r.post('/habits', validate(S.habit), h(life.createHabit));
r.put('/habits/:id', validate(S.habit.partial()), h(life.updateHabit));
r.delete('/habits/:id', h(life.deleteHabit));
r.post('/habits/:id/log', h(life.logHabit));
r.get('/goals', h(life.listGoals));
r.post('/goals', validate(S.goal), h(life.createGoal));
r.put('/goals/:id', validate(S.goal.partial()), h(life.updateGoal));
r.delete('/goals/:id', h(life.deleteGoal));
r.post('/goals/:id/milestones/:mid/toggle', h(life.toggleMilestone));
r.post('/goals/:id/breakdown', aiLimiter, h(life.breakdownGoal));
r.post('/goals/:id/tasks', h(life.addGoalTasks));

// Reviews & analytics
r.get('/reviews/daily', h(life.dailyReview));
r.put('/reviews/daily', h(life.saveDailyReview));
r.get('/reviews/weekly', h(life.weeklyReview));
r.get('/analytics', h(life.analytics));

// Admin (role-gated)
r.get('/admin/overview', requireAdmin, h(admin.overview));
r.get('/admin/users', requireAdmin, h(admin.listUsers));
r.get('/admin/users/:id', requireAdmin, h(admin.getUser));

module.exports = r;
