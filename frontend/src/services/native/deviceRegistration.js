import { Device } from '@capacitor/device';
import { App } from '@capacitor/app';
import { api } from '../api';
import { getDeviceId, describeBrowser } from '../../utils/device';
import { isAndroidApp, isNative } from './platform';
import { setDeviceDbId, syncAlarms, permissionStatus, scheduleTestAlarm } from './alarmSync';

const FCM_ENABLED = import.meta.env.VITE_ENABLE_FCM === 'true';
let listenersBound = false;

async function registerPushToken() {
  // Requires google-services.json in mobile/android/app; without it PushNotifications.register() crashes the app.
  if (!FCM_ENABLED) return null;
  const { PushNotifications } = await import('@capacitor/push-notifications');
  const perm = await PushNotifications.checkPermissions();
  if (perm.receive !== 'granted') return null;
  return new Promise((resolve) => {
    PushNotifications.addListener('registration', (t) => resolve(t.value));
    PushNotifications.addListener('registrationError', () => resolve(null));
    PushNotifications.addListener('pushNotificationReceived', (n) => {
      if (n.data?.type !== 'sync') return;
      if (n.data.test_alarm_id) scheduleTestAlarm(3, 'Test alarm from website');
      syncAlarms('push');
    });
    PushNotifications.register();
  });
}

/** Register this installation with the backend. Called after login and on each app start. */
export async function registerThisDevice() {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!isNative) {
    const b = describeBrowser();
    return api.post('/devices/register', { device_id: getDeviceId(), device_name: b.name, platform: 'web', timezone }).catch(() => null);
  }
  const [{ identifier }, info, app] = await Promise.all([Device.getId(), Device.getInfo(), App.getInfo().catch(() => ({ version: '1.0.0' }))]);
  const pushToken = await registerPushToken().catch(() => null);
  const perms = await permissionStatus();
  const { device } = await api.post('/devices/register', {
    device_id: identifier,
    device_name: `${info.manufacturer ? `${info.manufacturer[0].toUpperCase()}${info.manufacturer.slice(1)} ` : ''}${info.model || 'Android Phone'}`.trim(),
    platform: isAndroidApp ? 'android' : 'ios',
    push_token: pushToken,
    timezone,
    app_version: app.version,
    capabilities: { os_version: info.osVersion, notification_permission: perms.notifications, exact_alarm: perms.exactAlarm },
  });
  await setDeviceDbId(device.id);

  if (!listenersBound) {
    listenersBound = true;
    App.addListener('resume', () => syncAlarms('resume'));
    setInterval(() => document.visibilityState === 'visible' && syncAlarms('interval'), 5 * 60 * 1000);
  }
  await syncAlarms('register');
  return device;
}
