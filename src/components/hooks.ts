import { createContext, useContext, useSyncExternalStore } from 'react';
import type { DarkroomSession, SessionState } from '../session/session.ts';
import type { Darkroom } from '../rendering/darkroom.ts';

export interface AppContextValue {
  session: DarkroomSession;
  room: Darkroom | null;
  embed: boolean;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('AppContext missing');
  return ctx;
}

export function useSessionState(): SessionState {
  const { session } = useApp();
  return useSyncExternalStore(session.store.subscribe, session.store.get, session.store.get);
}

export function formatSeconds(s: number): string {
  return `${(Math.round(s * 10) / 10).toFixed(1)} s`;
}

export function formatClock(s: number): string {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
