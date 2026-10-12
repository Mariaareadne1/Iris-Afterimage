import { useEffect } from 'react';
import { useApp, useSessionState } from './hooks.ts';

export function Messages() {
  const { session } = useApp();
  const s = useSessionState();
  const text = s.error ?? s.notice;
  useEffect(() => {
    if (!s.notice || s.error) return;
    const t = setTimeout(() => session.dismissMessage(), 4200);
    return () => clearTimeout(t);
  }, [s.notice, s.error, session]);
  if (!text) return null;
  return (
    <div className={`toast ${s.error ? 'toast--error' : ''}`} role={s.error ? 'alert' : 'status'} data-testid="message">
      <span>{text}</span>
      <button className="btn btn--text" onClick={() => session.dismissMessage()} aria-label="Dismiss">×</button>
    </div>
  );
}
