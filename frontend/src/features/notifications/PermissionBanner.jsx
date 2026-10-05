import { useState } from 'react';
import { BellRing, X } from 'lucide-react';
import { enablePush, permissionState, pushSupported } from '../../services/push';
import { useToast } from '../../context/ToastContext';

export const DENIED_HELP = 'Notifications are blocked for this site. Click the lock icon next to the address bar → Site settings → Notifications → Allow, then reload.';

export default function PermissionBanner() {
  const toast = useToast();
  const [state, setState] = useState(permissionState());
  const [hidden, setHidden] = useState(() => localStorage.getItem('lp_hide_push_banner') === '1');
  if (!pushSupported() || hidden || state === 'granted') return null;

  const enable = async () => {
    const r = await enablePush().catch((e) => {
      toast.error(e.message);
      return permissionState();
    });
    setState(permissionState());
    if (r === 'granted') toast('Browser notifications enabled');
    if (r === 'server-unconfigured') toast.info('Push keys are not configured on the server yet. In-app notifications still work.');
  };

  return (
    <div className={`mb-4 flex items-start gap-3 rounded-2xl border p-4 text-sm ${state === 'denied' ? 'border-amber-200 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/10' : 'border-brand-100 bg-brand-50/70 dark:border-brand-500/20 dark:bg-brand-500/10'}`}>
      <BellRing size={20} className={state === 'denied' ? 'text-amber-500' : 'text-brand-500'} />
      <div className="flex-1">
        {state === 'denied' ? (
          <>
            <p className="font-semibold">Browser notifications are blocked</p>
            <p className="text-slate-600 dark:text-slate-300">{DENIED_HELP}</p>
          </>
        ) : (
          <>
            <p className="font-semibold">Get reminders even when this tab is closed</p>
            <p className="text-slate-600 dark:text-slate-300">Allow notifications for upcoming tasks, deadlines and your daily briefing.</p>
            <button className="btn-primary mt-2 py-1.5" onClick={enable}>Enable notifications</button>
          </>
        )}
      </div>
      <button onClick={() => { localStorage.setItem('lp_hide_push_banner', '1'); setHidden(true); }} className="text-slate-400 hover:text-slate-600" aria-label="Dismiss">
        <X size={16} />
      </button>
    </div>
  );
}
