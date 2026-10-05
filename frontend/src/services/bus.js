// Tiny app-wide change bus. SSE events from the server and local mutations both publish here,
// and data hooks re-fetch when a topic they care about changes.
const target = new EventTarget();

export function emit(topic, detail = {}) {
  target.dispatchEvent(new CustomEvent(topic, { detail }));
  target.dispatchEvent(new CustomEvent('*', { detail: { topic, ...detail } }));
}

export function on(topic, handler) {
  const fn = (e) => handler(e.detail);
  target.addEventListener(topic, fn);
  return () => target.removeEventListener(topic, fn);
}

// Server event type -> topics it invalidates.
export const EVENT_TOPICS = {
  tasks_changed: ['tasks', 'planner'],
  alarms_changed: ['alarms', 'planner'],
  sync: ['alarms', 'tasks', 'planner'],
  notification: ['notifications'],
  notifications_read: ['notifications'],
  habits_changed: ['habits'],
  goals_changed: ['goals', 'tasks'],
  devices_changed: ['devices'],
};
