const { z } = require('zod');
const { isValidTimezone, DAY_CODES } = require('../utils/time');

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'must be HH:mm');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const timezone = z.string().refine(isValidTimezone, 'invalid IANA timezone');
const isoDateTime = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'invalid datetime');
const priority = z.enum(['low', 'medium', 'high', 'critical']);
const days = z.array(z.enum(DAY_CODES)).max(7);
const notifyTarget = z.enum(['all', 'phone', 'laptop']);
const id = z.coerce.number().int().positive();

const register = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(190),
  password: z.string().min(8, 'must be at least 8 characters').max(128),
  timezone: timezone.optional(),
});

const login = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
});

const taskBase = {
  title: z.string().trim().min(1).max(190),
  description: z.string().max(5000).nullish(),
  category_id: id.nullish(),
  goal_id: id.nullish(),
  start_at: isoDateTime.nullish(),
  duration_minutes: z.coerce.number().int().min(5).max(24 * 60).optional(),
  due_at: isoDateTime.nullish(),
  priority: priority.optional(),
  is_critical_deadline: z.boolean().optional(),
  reminder_minutes: z.coerce.number().int().min(0).max(7 * 24 * 60).nullish(),
  alarm_enabled: z.boolean().optional(),
  force: z.boolean().optional(),
};

const taskCreate = z.object({
  ...taskBase,
  source: z.enum(['manual', 'ai', 'voice', 'habit', 'recurring', 'plan']).optional(),
  repeat: z
    .object({
      repeat_type: z.enum(['daily', 'weekly', 'selected_days', 'custom']),
      repeat_days: days.optional(),
      interval_days: z.coerce.number().int().min(1).max(365).optional(),
      end_date: date.nullish(),
    })
    .nullish(),
});

const taskUpdate = z.object({
  ...Object.fromEntries(Object.entries(taskBase).map(([k, v]) => [k, v.optional()])),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled', 'missed']).optional(),
  version: z.coerce.number().int().optional(),
});

const reschedule = z.object({
  start_at: isoDateTime,
  duration_minutes: z.coerce.number().int().min(5).max(1440).optional(),
  force: z.boolean().optional(),
});

const alarmBase = {
  title: z.string().trim().min(1).max(190),
  description: z.string().max(2000).nullish(),
  task_id: id.nullish(),
  category_id: id.nullish(),
  alarm_date: date,
  alarm_time: time,
  timezone: timezone.optional(),
  duration_minutes: z.coerce.number().int().min(1).max(1440).nullish(),
  repeat_type: z.enum(['once', 'daily', 'selected_days', 'weekly', 'custom']).default('once'),
  repeat_days: days.nullish(),
  repeat_interval_days: z.coerce.number().int().min(1).max(365).nullish(),
  repeat_until: date.nullish(),
  sound: z.string().max(60).optional(),
  vibration: z.boolean().optional(),
  reminder_minutes: z.coerce.number().int().min(0).max(24 * 60).nullish(),
  snooze_minutes: z.coerce.number().int().min(1).max(120).optional(),
  priority: priority.optional(),
  notify_target: notifyTarget.optional(),
  enabled: z.boolean().optional(),
};

const refineAlarm = (a, ctx) => {
  if (a.repeat_type === 'selected_days' && !(a.repeat_days && a.repeat_days.length)) {
    ctx.addIssue({ code: 'custom', path: ['repeat_days'], message: 'pick at least one day' });
  }
  if (a.repeat_type === 'custom' && !a.repeat_interval_days) {
    ctx.addIssue({ code: 'custom', path: ['repeat_interval_days'], message: 'custom repeat needs an interval' });
  }
};

const alarmCreate = z.object(alarmBase).superRefine(refineAlarm);
const alarmUpdate = z
  .object(Object.fromEntries(Object.entries(alarmBase).map(([k, v]) => [k, v.optional()])))
  .extend({ version: z.coerce.number().int().optional() });

const preferences = z.object({
  wake_time: time.optional(),
  sleep_time: time.optional(),
  work_start: time.optional(),
  work_end: time.optional(),
  work_days: days.optional(),
  preferred_workout_time: z.enum(['morning', 'afternoon', 'evening']).optional(),
  preferred_creative_time: z.enum(['morning', 'afternoon', 'evening', 'night']).optional(),
  preferred_freelance_time: z.enum(['morning', 'afternoon', 'evening', 'night']).optional(),
  min_break_minutes: z.coerce.number().int().min(0).max(120).optional(),
  max_focus_minutes: z.coerce.number().int().min(15).max(480).optional(),
  default_reminder_minutes: z.coerce.number().int().min(0).max(1440).optional(),
  default_snooze_minutes: z.coerce.number().int().min(1).max(120).optional(),
  default_alarm_sound: z.string().max(60).optional(),
  default_vibration: z.boolean().optional(),
  notify_target: notifyTarget.optional(),
  onboarded: z.boolean().optional(),
});

const notificationPreferences = z.object({
  web_push: z.boolean().optional(),
  mobile_push: z.boolean().optional(),
  in_app: z.boolean().optional(),
  upcoming_tasks: z.boolean().optional(),
  deadlines: z.boolean().optional(),
  reminders: z.boolean().optional(),
  daily_briefing: z.boolean().optional(),
  daily_briefing_time: time.optional(),
  weekly_planning: z.boolean().optional(),
  weekly_planning_day: z.enum(DAY_CODES).optional(),
  weekly_planning_time: time.optional(),
  missed_tasks: z.boolean().optional(),
  daily_review: z.boolean().optional(),
  quiet_hours_start: time.nullish(),
  quiet_hours_end: time.nullish(),
});

const profile = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  timezone: timezone.optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
});

const category = z.object({
  name: z.string().trim().min(1).max(60),
  icon: z.string().max(16).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

const habit = z.object({
  title: z.string().trim().min(1).max(120),
  icon: z.string().max(16).optional(),
  category_id: id.nullish(),
  repeat_days: days.min(1).optional(),
  target_per_week: z.coerce.number().int().min(1).max(7).optional(),
  reminder_time: time.nullish(),
  duration_minutes: z.coerce.number().int().min(5).max(480).optional(),
  reminder_minutes: z.coerce.number().int().min(0).max(240).optional(),
  alarm_enabled: z.boolean().optional(),
  active: z.boolean().optional(),
});

const goal = z.object({
  title: z.string().trim().min(1).max(190),
  description: z.string().max(5000).nullish(),
  category_id: id.nullish(),
  target_value: z.coerce.number().int().min(1).nullish(),
  current_value: z.coerce.number().int().min(0).optional(),
  unit: z.string().max(40).nullish(),
  target_date: date.nullish(),
  status: z.enum(['active', 'completed', 'archived']).optional(),
  milestones: z.array(z.object({ title: z.string().min(1).max(190), due_date: date.nullish() })).optional(),
});

const scheduleBlock = z.object({
  title: z.string().trim().min(1).max(120),
  block_type: z.enum(['work', 'meal', 'sleep', 'routine', 'focus', 'other']).optional(),
  days: days.min(1),
  start_time: time,
  end_time: time,
  icon: z.string().max(16).nullish(),
  active: z.boolean().optional(),
});

const deviceRegister = z.object({
  device_id: z.string().min(6).max(100),
  device_name: z.string().min(1).max(120),
  platform: z.enum(['android', 'ios', 'web', 'desktop']),
  push_token: z.string().max(4096).nullish(),
  timezone: timezone.optional(),
  app_version: z.string().max(30).optional(),
  capabilities: z.record(z.any()).optional(),
});

const deviceSync = z.object({
  local_alarms: z.array(z.object({ id, version: z.coerce.number().int() })).default([]),
  results: z
    .array(
      z.object({
        alarm_id: id,
        version: z.coerce.number().int(),
        status: z.enum(['scheduled', 'cancelled', 'failed']),
        error: z.string().max(255).nullish(),
      }),
    )
    .default([]),
  capabilities: z.record(z.any()).optional(),
  timezone: timezone.optional(),
});

const pushSubscribe = z.object({
  subscription: z.object({
    endpoint: z.string().url().max(700),
    keys: z.object({ p256dh: z.string().max(255), auth: z.string().max(255) }),
  }),
  device_id: z.string().max(100).optional(),
  device_name: z.string().max(120).optional(),
});

const assistantMessage = z.object({
  text: z.string().trim().min(1).max(2000),
  input_mode: z.enum(['text', 'voice']).optional(),
});

module.exports = {
  z,
  time,
  date,
  timezone,
  isoDateTime,
  register,
  login,
  taskCreate,
  taskUpdate,
  reschedule,
  alarmCreate,
  alarmUpdate,
  preferences,
  notificationPreferences,
  profile,
  category,
  habit,
  goal,
  scheduleBlock,
  deviceRegister,
  deviceSync,
  pushSubscribe,
  assistantMessage,
};
