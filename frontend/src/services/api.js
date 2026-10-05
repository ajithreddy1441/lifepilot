export const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

let token = localStorage.getItem('lp_token');

export const getToken = () => token;
export function setToken(t) {
  token = t;
  if (t) localStorage.setItem('lp_token', t);
  else localStorage.removeItem('lp_token');
}

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function request(path, { method = 'GET', body, form, signal, query } = {}) {
  const qs = query ? `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''))}` : '';
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`${API_BASE}/api${path}${qs}`, {
      method,
      headers,
      credentials: 'include',
      signal,
      body: form || (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, navigator.onLine ? 'Cannot reach the LifePilot server' : 'You are offline');
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token) window.dispatchEvent(new CustomEvent('lp:unauthorized'));
    throw new ApiError(res.status, data?.error || data?.summary || `Request failed (${res.status})`, data?.details ?? data);
  }
  return data;
}

export const api = {
  get: (path, query) => request(path, { query }),
  post: (path, body) => request(path, { method: 'POST', body: body ?? {} }),
  put: (path, body) => request(path, { method: 'PUT', body: body ?? {} }),
  del: (path) => request(path, { method: 'DELETE' }),
  upload: (path, form) => request(path, { method: 'POST', form }),
};
