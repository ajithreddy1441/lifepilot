import { createContext, useCallback, useContext, useState } from 'react';
import { Mic, X, Keyboard, RotateCcw, Send } from 'lucide-react';
import { useSpeech } from './useSpeech';
import { api } from '../../services/api';
import ActionPreview from '../assistant/ActionPreview';
import { Spinner } from '../../components/ui';

const VoiceContext = createContext(null);

function Waveform({ active }) {
  return (
    <div className="flex h-12 items-center justify-center gap-1">
      {Array.from({ length: 24 }).map((_, i) => (
        <span
          key={i}
          className={`w-1 rounded-full bg-gradient-to-t from-sky-400 via-brand-400 to-fuchsia-400 ${active ? 'wave-bar' : ''}`}
          style={{ height: `${16 + ((i * 37) % 30)}px`, animationDelay: `${(i % 8) * 0.09}s`, opacity: active ? 1 : 0.25 }}
        />
      ))}
    </div>
  );
}

function VoiceOverlay({ onClose, speech, thinking, result, typed, setTyped, typing, setTyping, send }) {
  const { listening, transcript, error, start, stop, processing, mode, setTranscript } = speech;
  const status = listening ? 'Listening…' : processing || thinking ? 'Understanding your request…' : result ? "Here's what I understood" : 'Tap the mic to speak';

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-gradient-to-b from-ink-950 via-[#121a3d] to-ink-950 text-white animate-slide-up">
      <div className="flex items-center justify-between p-4" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))' }}>
        <span className="text-sm font-semibold text-slate-400">Speak to LifePilot</span>
        <button onClick={onClose} className="rounded-full p-2 hover:bg-white/10" aria-label="Close voice assistant">
          <X size={22} />
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center overflow-y-auto px-5 pb-8">
        <h2 className="mt-4 text-center text-2xl font-extrabold md:text-3xl">{status}</h2>
        <p className="mt-1 text-center text-sm text-slate-400">{mode === 'none' ? 'Voice is not supported here — type instead.' : 'Tell me what you need to do.'}</p>

        <div className="relative my-10 flex items-center justify-center">
          {listening && (
            <>
              <span className="pulse-ring absolute h-40 w-40 rounded-full border-2 border-brand-400/60" />
              <span className="pulse-ring absolute h-40 w-40 rounded-full border-2 border-fuchsia-400/40" style={{ animationDelay: '0.6s' }} />
            </>
          )}
          <button
            type="button"
            onClick={() => (listening ? stop() : start())}
            disabled={thinking || processing}
            className={`relative flex h-32 w-32 items-center justify-center rounded-full shadow-[0_0_60px_rgba(99,102,241,0.55)] transition ${listening ? 'scale-105 bg-gradient-to-br from-brand-500 to-fuchsia-500' : 'bg-gradient-to-br from-sky-500 via-brand-500 to-violet-600'}`}
            aria-label={listening ? 'Stop listening' : 'Start listening'}
          >
            {thinking || processing ? <Spinner size={40} /> : <Mic size={48} />}
          </button>
        </div>

        <Waveform active={listening} />

        {(transcript || typed) && <p className="mt-6 max-w-xl text-center text-lg font-medium text-slate-100">“{transcript || typed}”</p>}
        {error && <p className="mt-4 max-w-md rounded-xl bg-rose-500/15 px-4 py-2 text-center text-sm text-rose-200">{error}</p>}

        {result && (
          <div className="mt-6 w-full max-w-xl text-slate-800 dark:text-slate-100">
            <div className={`rounded-2xl px-4 py-3 text-sm whitespace-pre-line ${result.error ? 'bg-rose-500/15 text-rose-100' : 'bg-white/10 text-white'}`}>{result.reply}</div>
            {result.action && result.action.status === 'proposed' && (
              <div className="text-slate-800 dark:text-slate-100">
                <ActionPreview action={result.action} onDone={(out) => !out?.rejected && setTimeout(onClose, 900)} />
              </div>
            )}
          </div>
        )}

        <div className="mt-8 flex gap-3">
          {result && (
            <button type="button" className="btn rounded-full bg-white/10 text-white hover:bg-white/20" onClick={() => { setTyped(''); setTranscript(''); start(); }}>
              <RotateCcw size={16} /> Try again
            </button>
          )}
          <button type="button" className="btn rounded-full bg-white/10 text-white hover:bg-white/20" onClick={() => setTyping((t) => !t)}>
            <Keyboard size={16} /> Type instead
          </button>
        </div>
        {typing && (
          <form
            className="mt-4 flex w-full max-w-xl gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (typed.trim()) send(typed.trim());
            }}
          >
            <input autoFocus className="input flex-1 border-white/10 bg-white/10 text-white placeholder:text-slate-400" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Remind me tomorrow at 6:40 to workout" />
            <button className="btn-primary" aria-label="Send"><Send size={16} /></button>
          </form>
        )}
      </div>
    </div>
  );
}

export function VoiceProvider({ children }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState(null);
  const [thinking, setThinking] = useState(false);
  const [typed, setTyped] = useState('');
  const [typing, setTyping] = useState(false);

  const send = useCallback(async (text) => {
    setThinking(true);
    setResult(null);
    try {
      setResult(await api.post('/assistant/message', { text, input_mode: 'voice' }));
    } catch (err) {
      setResult({ reply: err.message, error: true });
    } finally {
      setThinking(false);
    }
  }, []);

  const speech = useSpeech({ onFinal: send });

  const openVoice = useCallback(() => {
    setResult(null);
    setTyped('');
    setTyping(false);
    setOpen(true);
    // Same tap that opened the overlay — Chrome requires this for SpeechRecognition.start().
    speech.start();
  }, [speech]);

  const onClose = useCallback(() => {
    speech.stop();
    setOpen(false);
  }, [speech]);

  return (
    <VoiceContext.Provider value={{ openVoice }}>
      {children}
      {open && (
        <VoiceOverlay
          onClose={onClose}
          speech={speech}
          thinking={thinking}
          result={result}
          typed={typed}
          setTyped={setTyped}
          typing={typing}
          setTyping={setTyping}
          send={send}
        />
      )}
    </VoiceContext.Provider>
  );
}

export const useVoice = () => useContext(VoiceContext);
