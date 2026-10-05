import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { isStandalonePwa } from '../utils/device';
import { isNative } from '../services/native/platform';

/** Catch the browser install event and show a small banner (Chrome/Edge/Android Chrome). */
export default function InstallPrompt() {
  const [evt, setEvt] = useState(null);
  const [hidden, setHidden] = useState(() => localStorage.getItem('lp_hide_install') === '1');

  useEffect(() => {
    const onPrompt = (e) => {
      e.preventDefault();
      setEvt(e);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (isNative || isStandalonePwa() || hidden || !evt) return null;

  return (
    <div className="mb-4 flex items-center gap-3 rounded-2xl border border-brand-100 bg-white p-3 text-sm shadow-sm dark:border-brand-500/20 dark:bg-ink-850">
      <img src="/icons/icon-96.png" alt="" className="h-10 w-10 rounded-xl" />
      <div className="min-w-0 flex-1">
        <p className="font-bold">Install LifePilot</p>
        <p className="text-xs text-slate-500">Add it to your home screen for a full-screen app and better notifications.</p>
      </div>
      <button
        className="btn-primary py-1.5"
        onClick={async () => {
          evt.prompt();
          const { outcome } = await evt.userChoice;
          setEvt(null);
          if (outcome !== 'accepted') localStorage.setItem('lp_hide_install', '1');
        }}
      >
        <Download size={14} /> Install
      </button>
      <button className="text-slate-400" aria-label="Dismiss" onClick={() => { localStorage.setItem('lp_hide_install', '1'); setHidden(true); }}><X size={16} /></button>
    </div>
  );
}
