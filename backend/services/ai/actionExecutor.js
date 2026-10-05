// Executes a confirmed AI proposal. Payloads are re-validated with the same schemas the REST API uses,
// and every write goes through the normal services (conflict checks, alarm sync, notifications).
const { query } = require('../../config/db');
const { toJson, parseJson } = require('../../utils/json');
const { HttpError } = require('../../utils/http');
const schemas = require('../../models/schemas');
const taskService = require('../tasks/taskService');
const recurringService = require('../tasks/recurringService');
const alarmService = require('../alarms/alarmService');
const plannerService = require('../scheduler/plannerService');
const { getUser } = require('../../models/userModel');
const { humanDate, humanTime } = require('../../utils/time');

function check(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(422, `AI action failed validation: ${r.error.issues[0].path.join('.')} ${r.error.issues[0].message}`);
  return r.data;
}

async function run(userId, intent, payload, opts) {
  const user = await getUser(userId);
  const tz = user.timezone;
  const pickStart = (start) => (opts.alternative_index !== undefined && payload.alternatives?.[opts.alternative_index]) || opts.start_at || start;

  switch (intent) {
    case 'CREATE_TASK': {
      const data = check(schemas.taskCreate, { ...payload.task, start_at: pickStart(payload.task.start_at) });
      const task = await taskService.create(userId, data);
      if (payload.repeat && task.start_at) {
        await recurringService.createFromTask(userId, task, { repeat_type: payload.repeat.type, repeat_days: payload.repeat.days, interval_days: payload.repeat.interval }, tz);
      }
      return { summary: `Done — ${task.title} is set for ${humanDate(task.start_at, tz).toLowerCase()} at ${humanTime(task.start_at, tz)}${task.alarm_id ? '. Your phone alarm will sync.' : '.'}`, result: { task } };
    }
    case 'CREATE_TASKS': {
      const created = [];
      for (const t of payload.tasks) created.push(await taskService.create(userId, check(schemas.taskCreate, t)));
      return { summary: `Scheduled ${created.length} sessions.`, result: { tasks: created } };
    }
    case 'CREATE_ALARM': {
      const alarm = await alarmService.create(userId, check(schemas.alarmCreate, payload.alarm));
      return { summary: `Alarm set: ${alarm.title} at ${humanTime(alarm.next_trigger_at, tz)} (${alarm.repeat_label}). It will sync to your phone.`, result: { alarm } };
    }
    case 'MOVE_TASK': {
      const data = check(schemas.reschedule, { start_at: pickStart(payload.start_at), duration_minutes: payload.duration_minutes });
      const task = await taskService.reschedule(userId, payload.task_id, data);
      return { summary: `Moved ${task.title} to ${humanDate(task.start_at, tz).toLowerCase()} at ${humanTime(task.start_at, tz)}.${task.alarm_id ? ' Old alarm cancelled, new alarm syncing to your phone.' : ''}`, result: { task } };
    }
    case 'CANCEL_TASK': {
      if (payload.hard_delete) {
        await taskService.remove(userId, payload.task_id);
        return { summary: 'Deleted.', result: { task_id: payload.task_id } };
      }
      const task = await taskService.update(userId, payload.task_id, { status: 'cancelled' });
      return { summary: `Cancelled ${task.title}.`, result: { task } };
    }
    case 'DELETE_ALARM': {
      await alarmService.remove(userId, payload.alarm_id);
      return { summary: 'Alarm deleted on all devices.', result: { alarm_id: payload.alarm_id } };
    }
    case 'APPLY_PLAN': {
      const items = opts.items || payload.items;
      const out = await plannerService.applyPlan(userId, items, 'plan');
      const failed = out.failed.length ? ` ${out.failed.length} couldn't be placed (${out.failed.map((f) => f.title).join(', ')}).` : '';
      return { summary: `Plan applied: ${out.created} item${out.created === 1 ? '' : 's'} scheduled.${failed}`, result: out };
    }
    default:
      throw new HttpError(400, `Unsupported action ${intent}`);
  }
}

/**
 * @param action ai_actions row
 * @param opts { alternative_index?, start_at?, items? }
 */
async function execute(userId, action, opts = {}) {
  if (action.status !== 'proposed') return { ok: false, summary: `This suggestion was already ${action.status}.` };
  const payload = parseJson(action.payload, {});
  try {
    const out = await run(userId, action.intent, payload, opts);
    await query("UPDATE ai_actions SET status = 'executed', executed_at = UTC_TIMESTAMP(), result = ? WHERE id = ?", [toJson(out.result), action.id]);
    return { ok: true, ...out };
  } catch (err) {
    await query("UPDATE ai_actions SET status = 'failed', result = ? WHERE id = ?", [toJson({ error: err.message }), action.id]);
    if (err.status === 409) return { ok: false, summary: `${err.message}. Ask me for another time.`, result: { error: err.message } };
    if (err.status && err.status < 500) return { ok: false, summary: err.message, result: { error: err.message } };
    throw err;
  }
}

module.exports = { execute };
