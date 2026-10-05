import { createContext, useCallback, useContext, useState } from 'react';
import { Bot } from 'lucide-react';
import { Modal, Spinner } from '../../components/ui';
import ActionPreview from './ActionPreview';
import { useToast } from '../../context/ToastContext';

const Ctx = createContext(null);

/** Run any assistant call (plan day/week, suggest, reschedule) and show the proposal in a modal. */
export function AssistantResultProvider({ children }) {
  const [state, setState] = useState(null);
  const toast = useToast();

  const run = useCallback(
    async (title, call) => {
      setState({ title, loading: true });
      try {
        const res = await call();
        setState({ title, loading: false, res });
      } catch (err) {
        setState(null);
        toast.error(err.message);
      }
    },
    [toast],
  );

  return (
    <Ctx.Provider value={run}>
      {children}
      <Modal open={!!state} onClose={() => setState(null)} title={state?.title} wide>
        {state?.loading ? (
          <div className="flex items-center gap-3 py-10 text-slate-500">
            <Spinner /> Looking at your schedule…
          </div>
        ) : (
          state?.res && (
            <div>
              <div className="flex gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-violet-500 text-white">
                  <Bot size={18} />
                </span>
                <p className="whitespace-pre-line rounded-2xl rounded-tl-sm bg-slate-100 px-4 py-2.5 text-sm dark:bg-white/5">{state.res.reply}</p>
              </div>
              {state.res.action && <ActionPreview action={state.res.action} onDone={(out) => !out?.rejected && setTimeout(() => setState(null), 700)} />}
              {!state.res.action && state.res.data?.timeline && (
                <ul className="mt-3 space-y-1 text-sm">
                  {state.res.data.timeline.map((i, idx) => (
                    <li key={idx} className="rounded-lg bg-slate-50 px-3 py-2 dark:bg-white/5">{i.title}</li>
                  ))}
                </ul>
              )}
            </div>
          )
        )}
      </Modal>
    </Ctx.Provider>
  );
}

export const useAssistantRun = () => useContext(Ctx);
