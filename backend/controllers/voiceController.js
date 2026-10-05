const voiceService = require('../services/voice/voiceService');
const aiService = require('../services/ai/aiService');
const { HttpError } = require('../utils/http');

async function transcribe(req, res) {
  if (!req.file) throw new HttpError(422, 'Upload an audio file in the "audio" field');
  const { text } = await voiceService.transcribe(req.file.buffer, req.file.mimetype, req.body.language);
  if (req.body.process === 'true' && text) {
    return res.json({ text, ...(await aiService.handleMessage(req.user.id, text, 'voice')) });
  }
  res.json({ text });
}

const status = (_req, res) => res.json({ server_transcription: voiceService.isConfigured() });

module.exports = { transcribe, status };
