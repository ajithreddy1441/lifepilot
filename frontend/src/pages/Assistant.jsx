import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bot, Mic, Send, Square, Sparkles } from 'lucide-react';
import { api } from '../services/api';
import { useSpeech } from '../features/voice/useSpeech';
import { useVoice } from '../features/voice/VoiceContext';
import ActionPreview from '../features/assistant/ActionPreview';
import { PageLoader, Spinner } from '../components/ui';
import { fmtTime } from '../utils/format';

const SUGGESTIONS = [
  'What do I have today?',
  'Plan my day',
  'Tomorrow at 6:40 AM remind me to workout for 40 minutes',
  'When should I work on freelancing this week?',
  'Set an alarm every Monday, Wednesday and Friday at 6:30 AM for gym',
  'Move my workout to the evening',
  'Plan my week: 3 workouts, 4 hours freelancing, 2 story writing sessions',
  'What alarms do I have?',
];

function Bubble({ m }) {
  const mine = m.role === 'user';
  return (
    <div className={`flex gap-3 ${mine ? 'flex-row-reverse' : ''}`}>
      {!mine && (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-violet-500 text-white">
          <Bot size={18} />
        </span>
      )}
      <div className={`max-w-[85%] md:max-w-[70%] ${mine ? 'items-end' : ''} flex flex-col`}>
        <div className={`whitespace-pre-line rounded-2xl px-4 py-2.5 text-sm ${mine ? 'rounded-tr-sm bg-gradient-to-br from-brand-500 to-violet-500 text-white' : 'rounded-tl-sm bg-white shadow-sm dark:bg-ink-850'}`}>
          {m.input_mode === 'voice' && mine && <Mic size={12} className="mr-1 inline opacity-75" />}
          {m.content}
        </div>
        {m.action && m.action.preview && (m.action.status === 'proposed' ? <ActionPreview action={m.action} /> : (
          <span className="mt-1 text-[11px] font-semibold capitalize text-slate-400">{m.action.status === 'executed' ? '✓ Done' : m.action.status}</span>
        ))}
        {m.created_at && <span className="mt-0.5 text-[10px] text-slate-400">{fmtTime(m.created_at)}</span>}
      </div>
    </div>
  );
}

export default function Assistant() {
  const [params, setParams] = useSearchParams();
  const { openVoice } = useVoice();
  const [messages, setMessages] = useState(null);
  const [llm, setLlm] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);

  const send = async (value, mode = 'text') => {
    const t = (value ?? text).trim();
    if (!t || sending) return;
    setText('');
    setSending(true);
    setMessages((m) => [...(m || []), { id: `u${Date.now()}`, role: 'user', content: t, input_mode: mode, created_at: new Date().toISOString() }]);
    try {
      const res = await api.post('/assistant/message', { text: t, input_mode: mode });
      setMessages((m) => [...m, { id: `a${Date.now()}`, role: 'assistant', content: res.reply, action: res.action, created_at: new Date().toISOString() }]);
    } catch (err) {
      setMessages((m) => [...m, { id: `e${Date.now()}`, role: 'assistant', content: `⚠️ ${err.message}` }]);
    } finally {
      setSending(false);
    }
  };

  const speech = useSpeech({ onFinal: (t) => send(t, 'voice') });

  useEffect(() => {
    api.get('/assistant/history', { limit: 60 }).then((r) => {
      setMessages(r.messages);
      setLlm(r.llm);
    }).catch(() => setMessages([]));
  }, []);

  useEffect(() => {
    if (messages === null) return;
    const prompt = params.get('prompt');
    if (params.get('voice')) openVoice();
    if (prompt) send(prompt);
    if (prompt || params.get('voice')) setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages === null]);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages, sending]);

  if (messages === null) return <PageLoader />;

  return (
    <div className="flex h-[calc(100vh-11rem)] flex-col md:h-[calc(100vh-8rem)]">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold">AI Assistant</h1>
          <p className="text-xs text-slate-500">{llm ? 'Smart mode (LLM) — every change is shown for your approval first' : 'Built-in planner engine — every change is shown for your approval first'}</p>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto rounded-2xl bg-slate-50/60 p-3 md:p-5 dark:bg-white/[0.02]">
        {!messages.length && (
          <div className="py-8 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-violet-500 text-white"><Sparkles size={26} /></span>
            <p className="mt-3 text-lg font-bold">How can I help you plan?</p>
            <p className="text-sm text-slate-500">Ask in plain language — I’ll find the time, avoid overlaps and protect your sleep.</p>
          </div>
        )}
        {messages.map((m) => <Bubble key={m.id} m={m} />)}
        {sending && (
          <div className="flex items-center gap-2 text-sm text-slate-500"><Spinner size={16} /> Thinking…</div>
        )}
        <div ref={endRef} />
      </div>

      <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => send(s)} className="chip shrink-0 bg-white px-3 py-1.5 text-xs text-slate-600 shadow-sm hover:text-brand-600 dark:bg-ink-850 dark:text-slate-300">{s}</button>
        ))}
      </div>

      <form className="mt-2 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input
          className="input flex-1"
          value={speech.listening ? speech.transcript : text}
          onChange={(e) => setText(e.target.value)}
          placeholder={speech.listening ? 'Listening…' : 'Ask me anything… e.g. “Find time for story writing this week”'}
          disabled={sending}
        />
        {speech.mode !== 'none' && (
          <button
            type="button"
            onClick={speech.listening ? speech.stop : speech.start}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white ${speech.listening ? 'animate-pulse bg-rose-500' : 'bg-gradient-to-br from-sky-500 to-violet-500'}`}
            aria-label={speech.listening ? 'Stop' : 'Speak'}
          >
            {speech.processing ? <Spinner size={18} /> : speech.listening ? <Square size={16} /> : <Mic size={18} />}
          </button>
        )}
        <button className="btn-primary h-11 w-11 shrink-0 p-0" disabled={sending || !text.trim()} aria-label="Send"><Send size={18} /></button>
      </form>
      {speech.error && <p className="mt-1 text-xs text-rose-500">{speech.error}</p>}
    </div>
  );
}
