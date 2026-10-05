const env = require('../../config/env');

const isConfigured = () => !!env.ai.apiKey;

async function chat(messages, { json = false, temperature = 0.2, maxTokens = 900, timeoutMs = 20000 } = {}) {
  if (!isConfigured()) throw new Error('AI_API_KEY not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${env.ai.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.ai.apiKey}` },
      body: JSON.stringify({
        model: env.ai.model,
        messages,
        temperature,
        max_tokens: maxTokens,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    const content = body.choices?.[0]?.message?.content || '';
    return json ? JSON.parse(content.replace(/^```(json)?|```$/g, '').trim()) : content.trim();
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { isConfigured, chat };
