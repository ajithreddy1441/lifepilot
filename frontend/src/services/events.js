import { API_BASE, getToken } from './api';
import { emit, EVENT_TOPICS } from './bus';

let source = null;
let retry = 0;
let timer = null;

/** Keep an SSE connection open so changes from the phone (or the worker) show up immediately. */
export function connectEvents() {
  disconnectEvents();
  const token = getToken();
  if (!token || typeof EventSource === 'undefined') return;
  source = new EventSource(`${API_BASE}/api/events/stream?token=${encodeURIComponent(token)}`, { withCredentials: true });
  source.addEventListener('ready', () => {
    retry = 0;
  });
  for (const type of Object.keys(EVENT_TOPICS)) {
    source.addEventListener(type, (e) => {
      let evt = {};
      try {
        evt = JSON.parse(e.data);
      } catch {
        /* ignore malformed */
      }
      emit(`server:${type}`, evt.payload || {});
      for (const topic of EVENT_TOPICS[type]) emit(topic, { source: 'server', type, payload: evt.payload });
    });
  }
  source.onerror = () => {
    source?.close();
    source = null;
    const delay = Math.min(30000, 1000 * 2 ** retry++);
    timer = setTimeout(connectEvents, delay);
  };
}

export function disconnectEvents() {
  clearTimeout(timer);
  source?.close();
  source = null;
}
