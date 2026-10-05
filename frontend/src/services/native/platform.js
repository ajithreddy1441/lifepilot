import { Capacitor } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();
export const nativePlatform = Capacitor.getPlatform(); // 'android' | 'ios' | 'web'
export const isAndroidApp = isNative && nativePlatform === 'android';
