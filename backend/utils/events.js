const { EventEmitter } = require('events');

// In-process change bus feeding the SSE stream (/api/events) so open websites refresh live.
// For multi-instance deployments swap this for Redis pub/sub; callers only use publish().
const bus = new EventEmitter();
bus.setMaxListeners(1000);

function publish(userId, type, payload = {}) {
  bus.emit(`user:${userId}`, { type, payload, at: new Date().toISOString() });
}

function subscribe(userId, handler) {
  bus.on(`user:${userId}`, handler);
  return () => bus.off(`user:${userId}`, handler);
}

module.exports = { publish, subscribe };
