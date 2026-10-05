import { useCallback, useEffect, useRef, useState } from 'react';
import { isNative } from '../../services/native/platform';
import { NativeSpeech } from '../../services/native/speech';
import { api } from '../../services/api';

const WebRecognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

function detectMode() {
  if (isNative) return 'native';
  if (WebRecognition) return 'web';
  if (typeof MediaRecorder !== 'undefined' && navigator.mediaDevices?.getUserMedia) return 'record';
  return 'none';
}

const IGNORE_ERRORS = new Set(['aborted', 'canceled', 'cancelled', 'no-speech']);

/**
 * Speech-to-text across platforms:
 *  - Chrome/Edge/Android Chrome/Safari: Web Speech API
 *  - Android app: native SpeechRecognizer via LifePilotSpeech
 *  - Other browsers: MediaRecorder + /api/voice/transcribe
 *
 * Chrome only allows SpeechRecognition.start() inside a user gesture.
 * Call start() from a click/tap — not from useEffect — or it reports "aborted".
 */
export function useSpeech({ onFinal, lang = navigator.language || 'en-US' } = {}) {
  const [mode] = useState(detectMode);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState(null);
  const [processing, setProcessing] = useState(false);
  const recRef = useRef(null);
  const finalRef = useRef('');
  const onFinalRef = useRef(onFinal);
  const listeningRef = useRef(false);
  onFinalRef.current = onFinal;

  const finish = useCallback((text) => {
    listeningRef.current = false;
    setListening(false);
    const t = (text || '').trim();
    if (t) onFinalRef.current?.(t);
  }, []);

  const stopEngine = useCallback(() => {
    const rec = recRef.current;
    recRef.current = null;
    try {
      rec?.stop?.();
    } catch {
      /* already stopped */
    }
    if (mode === 'native') NativeSpeech.stop().catch(() => {});
  }, [mode]);

  const startWeb = () => {
    stopEngine();
    const rec = new WebRecognition();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    finalRef.current = '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const r = e.results[i];
        if (r.isFinal) finalRef.current += r[0].transcript;
        else interim += r[0].transcript;
      }
      setTranscript((finalRef.current + interim).trim());
    };
    rec.onerror = (e) => {
      if (IGNORE_ERRORS.has(e.error)) return;
      setError(
        e.error === 'not-allowed' || e.error === 'service-not-allowed'
          ? 'Microphone access is blocked. Allow it in your browser’s site settings (lock icon in the address bar).'
          : e.error === 'audio-capture'
            ? 'No microphone was found. Plug one in or check Windows sound settings.'
            : e.error === 'network'
              ? 'Speech needs a network connection in this browser. Check Wi‑Fi and try again.'
              : `Could not hear you (${e.error}). Tap the mic and try again.`,
      );
      listeningRef.current = false;
      setListening(false);
    };
    rec.onend = () => {
      recRef.current = null;
      finish(finalRef.current || '');
    };
    recRef.current = rec;
    rec.start();
  };

  const startNative = async () => {
    const avail = await NativeSpeech.available().catch(() => ({ available: false }));
    if (!avail.available) throw new Error('Speech recognition is not available on this phone.');
    const perm = await NativeSpeech.requestPermission();
    if (perm.granted !== true) throw new Error('Microphone permission is needed so LifePilot can hear your request.');
    const sub = await NativeSpeech.addListener('partial', (d) => setTranscript(d.text || ''));
    try {
      const res = await NativeSpeech.start({ language: lang });
      setTranscript(res.text || '');
      finish(res.text || '');
    } finally {
      sub.remove();
    }
  };

  const startRecord = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream);
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      listeningRef.current = false;
      setListening(false);
      setProcessing(true);
      try {
        const form = new FormData();
        form.append('audio', new Blob(chunks, { type: rec.mimeType || 'audio/webm' }), 'voice.webm');
        const { text } = await api.upload('/voice/transcribe', form);
        setTranscript(text);
        finish(text);
      } catch (err) {
        setError(err.message);
      } finally {
        setProcessing(false);
      }
    };
    recRef.current = rec;
    rec.start();
    setTimeout(() => rec.state === 'recording' && rec.stop(), 12000);
  };

  const start = useCallback(async () => {
    if (listeningRef.current) return;
    listeningRef.current = true;
    setError(null);
    setTranscript('');
    setListening(true);
    try {
      if (mode === 'web') startWeb();
      else if (mode === 'native') await startNative();
      else if (mode === 'record') await startRecord();
      else throw new Error('Voice input is not supported in this browser. Try Chrome or Edge, or type instead.');
    } catch (err) {
      listeningRef.current = false;
      setError(err.name === 'NotAllowedError' ? 'Microphone access was denied. Enable it in your browser settings.' : err.message);
      setListening(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, lang]);

  const stop = useCallback(() => {
    listeningRef.current = false;
    stopEngine();
    setListening(false);
    finish(finalRef.current || '');
  }, [finish, stopEngine]);

  useEffect(() => () => {
    listeningRef.current = false;
    try {
      recRef.current?.stop?.();
    } catch {
      /* ignore */
    }
  }, []);

  return { mode, supported: mode !== 'none', listening, processing, transcript, setTranscript, error, start, stop };
}
