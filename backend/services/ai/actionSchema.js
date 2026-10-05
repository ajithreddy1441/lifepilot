const { z } = require('zod');
const { DAY_CODES } = require('../../utils/time');

const INTENTS = [
  'CREATE_TASK', 'CREATE_ALARM', 'CREATE_REMINDER', 'UPDATE_TASK', 'RESCHEDULE', 'CANCEL_TASK', 'COMPLETE_TASK',
  'QUERY_SCHEDULE', 'QUERY_ALARMS', 'PLAN_DAY', 'PLAN_WEEK', 'SUGGEST_TIME', 'CONFIRM', 'REJECT', 'UNKNOWN',
];
const CATEGORIES = ['job', 'freelancing', 'personal', 'fitness', 'creative', 'learning', 'home', 'goals'];
const TOD = z.enum(['morning', 'afternoon', 'evening', 'night']).nullish();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullish();

/** Validates whatever the LLM (or rule parser) produced before any service sees it. */
const parsedAction = z.object({
  intent: z.enum(INTENTS),
  task_title: z.string().max(190).nullish(),
  target: z.string().max(190).nullish(),
  task_id: z.coerce.number().int().positive().nullish(),
  category: z.enum(CATEGORIES).nullish().catch(null),
  date,
  time,
  time_of_day: TOD.catch(null),
  duration_minutes: z.coerce.number().int().min(5).max(16 * 60).nullish().catch(null),
  reminder_minutes: z.coerce.number().int().min(0).max(1440).nullish().catch(null),
  repeat: z
    .object({
      type: z.enum(['daily', 'weekly', 'selected_days', 'custom']),
      days: z.array(z.enum(DAY_CODES)).default([]),
      interval: z.coerce.number().int().min(1).max(365).nullish(),
    })
    .nullish()
    .catch(null),
  new_date: date,
  new_time: time,
  new_time_of_day: TOD.catch(null),
  shift_minutes: z.coerce.number().int().min(-1440).max(1440).nullish().catch(null),
  postpone: z.boolean().nullish(),
  is_alarm: z.boolean().nullish(),
  hard_delete: z.boolean().nullish(),
  next: z.boolean().nullish(),
  week: z.enum(['this', 'next']).nullish().catch('this'),
  requests: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        category: z.enum(CATEGORIES).nullish().catch(null),
        sessions: z.coerce.number().int().min(1).max(14).default(1),
        duration_minutes: z.coerce.number().int().min(10).max(480).default(60),
      }),
    )
    .max(20)
    .nullish(),
  reply: z.string().max(600).nullish(),
});

module.exports = { parsedAction, INTENTS, CATEGORIES };
