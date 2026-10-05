// Background scheduler. Runs in-process with the API by default (RUN_WORKER_IN_PROCESS=true) or standalone
// via `npm run worker`. Jobs are claimed atomically from MySQL, so several workers can run side by side.
const os = require('os');
const env = require('../config/env');
const { query, one } = require('../config/db');
const { DateTime, timeToMinutes, todayIn, dayCode, humanTime, dayBoundsUtc, weekStart } = require('../utils/time');
const notifications = require('../services/notifications/notificationService');
const alarmService = require('../services/alarms/alarmService');
const recurringService = require('../services/tasks/recurringService');

const WORKER_ID = `${os.hostname()}:${process.pid}`.slice(0, 64);
const STALE_AFTER_HOURS = 6;
let running = false;
let lastSlowTick = 0;
let lastHourly = 0;

async function processDueNotifications() {
  await query(
    "UPDATE notifications SET status = 'pending', locked_by = NULL WHERE status = 'processing' AND locked_at < UTC_TIMESTAMP() - INTERVAL 5 MINUTE AND attempts < 5",
  );
  const claimed = await query(
    `UPDATE notifications SET status = 'processing', locked_by = ?, locked_at = UTC_TIMESTAMP()
     WHERE status = 'pending' AND scheduled_at <= UTC_TIMESTAMP() ORDER BY scheduled_at LIMIT 100`,
    [WORKER_ID],
  );
  if (!claimed.affectedRows) return 0;
  const rows = await query("SELECT * FROM notifications WHERE locked_by = ? AND status = 'processing'", [WORKER_ID]);
  for (const n of rows) {
    try {
      const ageHours = (Date.now() - new Date(n.scheduled_at).getTime()) / 3600000;
      if (ageHours > STALE_AFTER_HOURS) {
        await query("UPDATE notifications SET status = 'skipped', error = 'expired before delivery', locked_by = NULL WHERE id = ?", [n.id]);
      } else {
        await notifications.deliver(n);
      }
      if (n.notification_type === 'alarm' && n.alarm_id && String(n.dedupe_key || '').startsWith('alarm:')) {
        await alarmService.advance(n.alarm_id);
      }
    } catch (err) {
      console.error(`[worker] notification ${n.id} failed:`, err.message);
      await query(
        "UPDATE notifications SET status = IF(attempts >= 4, 'failed', 'pending'), attempts = attempts + 1, error = ?, locked_by = NULL, scheduled_at = IF(attempts >= 4, scheduled_at, UTC_TIMESTAMP() + INTERVAL 1 MINUTE) WHERE id = ?",
        [err.message.slice(0, 250), n.id],
      );
    }
  }
  return rows.length;
}

/** Recover alarms whose next occurrence was never queued (e.g. worker downtime). */
async function repairAlarms() {
  const rows = await query(
    `SELECT a.* FROM alarms a WHERE a.status = 'active' AND a.enabled = 1
       AND (a.next_trigger_at IS NULL OR a.next_trigger_at < UTC_TIMESTAMP() - INTERVAL 2 MINUTE
            OR NOT EXISTS (SELECT 1 FROM notifications n WHERE n.alarm_id = a.id AND n.status IN ('pending','processing')))
     LIMIT 200`,
  );
  for (const a of rows) {
    const next = await alarmService.scheduleJobs(a);
    if (!next && a.repeat_type === 'once') await query("UPDATE alarms SET status = 'completed' WHERE id = ?", [a.id]);
  }
}

async function markMissedTasks() {
  const rows = await query(
    `SELECT t.id, t.user_id, t.title FROM tasks t
     WHERE t.status = 'pending' AND t.end_at < UTC_TIMESTAMP() - INTERVAL 15 MINUTE AND t.end_at > UTC_TIMESTAMP() - INTERVAL 1 DAY LIMIT 200`,
  );
  for (const t of rows) {
    await query("UPDATE tasks SET status = 'missed', version = version + 1 WHERE id = ? AND status = 'pending'", [t.id]);
    await notifications.notifyNow(t.user_id, {
      type: 'missed_task',
      title: `○ Missed: ${t.title}`,
      message: 'Want to reschedule it? Ask the assistant or open the task.',
      taskId: t.id,
      dedupeKey: `missed:${t.id}`,
      data: { url: `/tasks?open=${t.id}` },
    });
  }
}

const inWindow = (nowMin, targetTime, spanMin = 120) => {
  const t = timeToMinutes(targetTime);
  return nowMin >= t && nowMin < t + spanMin;
};

async function userRoutines() {
  const users = await query(
    `SELECT u.id, u.timezone, np.daily_briefing, np.daily_briefing_time, np.weekly_planning, np.weekly_planning_day, np.weekly_planning_time,
            np.daily_review, up.sleep_time
     FROM users u JOIN notification_preferences np ON np.user_id = u.id JOIN user_preferences up ON up.user_id = u.id`,
  );
  for (const u of users) {
    try {
      const now = DateTime.now().setZone(u.timezone);
      const nowMin = now.hour * 60 + now.minute;
      const today = todayIn(u.timezone);

      if (u.daily_briefing && inWindow(nowMin, u.daily_briefing_time)) {
        const exists = await one('SELECT id FROM notifications WHERE user_id = ? AND dedupe_key = ?', [u.id, `briefing:${today}`]);
        if (!exists) {
          const { start, end } = dayBoundsUtc(today, u.timezone);
          const tasks = await query("SELECT title, start_at FROM tasks WHERE user_id = ? AND start_at >= ? AND start_at < ? AND status IN ('pending','in_progress') ORDER BY start_at", [u.id, start, end]);
          const first = tasks.find((t) => new Date(t.start_at) > new Date());
          await notifications.notifyNow(u.id, {
            type: 'daily_briefing',
            title: '☀️ Your day at a glance',
            message: tasks.length ? `${tasks.length} task${tasks.length > 1 ? 's' : ''} today.${first ? ` First up: ${first.title} at ${humanTime(first.start_at, u.timezone)}.` : ''}` : 'Nothing scheduled yet — tap to plan your day.',
            dedupeKey: `briefing:${today}`,
            data: { url: '/' },
          });
        }
      }

      if (u.weekly_planning && dayCode(now) === u.weekly_planning_day && inWindow(nowMin, u.weekly_planning_time)) {
        await notifications.notifyNow(u.id, {
          type: 'weekly_planning',
          title: '🗓️ Weekly planning',
          message: 'Plan your week — tell the assistant what you need to get done.',
          dedupeKey: `weekly:${weekStart(today, u.timezone)}`,
          data: { url: '/assistant?prompt=Plan%20my%20week' },
        });
      }

      const reviewAt = (timeToMinutes(u.sleep_time) - 45 + 1440) % 1440;
      if (u.daily_review && nowMin >= reviewAt && nowMin < reviewAt + 90) {
        await notifications.notifyNow(u.id, {
          type: 'daily_review',
          title: '🌙 Day review',
          message: 'See what you finished today and reschedule anything left.',
          dedupeKey: `review:${today}`,
          data: { url: '/review' },
        });
      }
    } catch (err) {
      console.error(`[worker] routines for user ${u.id}:`, err.message);
    }
  }
}

async function tick() {
  if (running) return;
  running = true;
  try {
    await processDueNotifications();
    const now = Date.now();
    if (now - lastSlowTick > 5 * 60000) {
      lastSlowTick = now;
      await repairAlarms();
      await markMissedTasks();
      await userRoutines();
    }
    if (now - lastHourly > 60 * 60000) {
      lastHourly = now;
      await recurringService.generateAll();
    }
  } catch (err) {
    console.error('[worker] tick failed:', err.message);
  } finally {
    running = false;
  }
}

function start() {
  console.log(`[worker] ${WORKER_ID} started (every ${env.workerIntervalMs / 1000}s)`);
  tick();
  return setInterval(tick, env.workerIntervalMs);
}

if (require.main === module) {
  if (env.missing.length) {
    console.error(`Missing env vars: ${env.missing.join(', ')}`);
    process.exit(1);
  }
  start();
}

module.exports = { start, tick, processDueNotifications };
