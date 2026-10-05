export function getDeviceId() {
  let id = localStorage.getItem('lp_device_id');
  if (!id) {
    id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/-/g, '');
    localStorage.setItem('lp_device_id', id);
  }
  return id;
}

export function describeBrowser() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  const kind = /Android|iPhone/.test(ua) ? 'phone' : /iPad|Tablet/.test(ua) ? 'tablet' : 'laptop';
  return { name: `${browser} on ${os || 'web'}`, browser, os, kind };
}

export const isStandalonePwa = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
