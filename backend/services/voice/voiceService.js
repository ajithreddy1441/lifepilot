const env = require('../../config/env');
const { HttpError } = require('../../utils/http');

const isConfigured = () => !!env.ai.apiKey;

/**
 * Server-side speech-to-text (OpenAI-compatible /audio/transcriptions).
 * Browsers with the Web Speech API and the Android app transcribe on-device; this is the fallback
 * for browsers without it (Firefox, some iOS versions) that upload a MediaRecorder clip instead.
 */
async function transcribe(buffer, mimetype = 'audio/webm', language) {
  if (!isConfigured()) throw new HttpError(501, 'Server transcription is not configured. Use a browser with built-in speech recognition (Chrome/Edge) or set AI_API_KEY.');
  const ext = (mimetype.split('/')[1] || 'webm').split(';')[0];
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimetype }), `voice.${ext}`);
  form.append('model', env.ai.transcribeModel);
  if (language) form.append('language', language);
  const res = await fetch(`${env.ai.baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.ai.apiKey}` },
    body: form,
  });
  if (!res.ok) throw new HttpError(502, `Transcription failed (${res.status})`);
  const body = await res.json();
  return { text: (body.text || '').trim() };
}

module.exports = { transcribe, isConfigured };
