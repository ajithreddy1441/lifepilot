import { registerPlugin } from '@capacitor/core';

// Implemented in mobile/android/app/src/main/java/com/lifepilot/ai/SpeechPlugin.java using Android SpeechRecognizer.
export const NativeSpeech = registerPlugin('LifePilotSpeech');
