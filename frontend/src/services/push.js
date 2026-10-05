import { api, getToken, API_BASE } from './api';
import { getDeviceId, describeBrowser } from '../utils/device';
import { isNative } from './native/platform';

export const pushSupported = () => !isNative && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export const permissionState = () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);

let registration = null;

export async function registerServiceWorker() {
  if (isNative || !('serviceWorker' in navigator)) return null;
  // Vite HMR + a service worker fighting over JS modules causes "Invalid hook call" / blank screens.
  if (import.meta.env.DEV) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    return null;
  }
  try {
    registration = await navigator.serviceWorker.register('/service-worker.js');
    await navigator.serviceWorker.ready;
    sendConfigToWorker();
    return registration;
  } catch (err) {
    console.warn('Service worker registration failed', err);
    return null;
  }
}

export function sendConfigToWorker() {
  const sw = navigator.serviceWorker?.controller || registration?.active;
  sw?.postMessage({ type: 'config', config: { token: getToken(), apiBase: API_BASE } });
}

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = registration || (await navigator.serviceWorker.getRegistration());
  return reg ? reg.pushManager.getSubscription() : null;
}

/**
 * Ask permission (only on an explicit user action) and register this browser for Web Push.
 * @returns {'granted'|'denied'|'default'|'unsupported'|'server-unconfigured'}
 */
export async function enablePush() {
  if (!pushSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission;
  const { publicKey, configured } = await api.get('/notifications/vapid-public-key');
  if (!configured || !publicKey) return 'server-unconfigured';
  const reg = registration || (await registerServiceWorker());
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
  const b = describeBrowser();
  await api.post('/notifications/subscribe', { subscription: sub.toJSON(), device_id: getDeviceId(), device_name: b.name });
  return 'granted';
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (sub) {
    await api.post('/notifications/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe();
  }
}

/** In-tab fallback when the page is open: show a system notification without a push round-trip. */
export function showLocalNotification(title, body, data = {}) {
  if (permissionState() !== 'granted') return;
  navigator.serviceWorker?.getRegistration().then((reg) => reg?.showNotification(title, { body, icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', data }));
}
