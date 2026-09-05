import { useEffect, useRef, useState } from 'react';
import type { LoginInput, UserProfile } from '../../contracts/ipc/v1/auth.js';
import { Spinner } from '../components/ui.js';
import { LoginScreen } from '../features/auth/LoginScreen.js';
import { WorkspaceShell } from '../features/workspace/shell/WorkspaceShell.js';
import { useLocale } from '../i18n/locale.js';
import { toUserErrorMessage as toMessage } from '../utils/errors.js';
import type { DesktopUpdateSnapshot } from '../../contracts/ipc/v1/update.js';
import { UpdateGate } from '../features/updates/UpdateGate.js';

type AppState = 'checking-update' | 'update' | 'checking' | 'login' | 'workspace';

export function App() {
  const { t } = useLocale();
  const [state, setState] = useState<AppState>('checking-update');
  const [user, setUser] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [update, setUpdate] = useState<DesktopUpdateSnapshot | null>(null);
  const translate = useRef(t);
  translate.current = t;

  useEffect(() => {
    let active = true;
    const restoreSession = () => {
      if (!active) return;
      setState('checking');
      void window.lotagate.auth.restoreSession().then((profile) => {
        if (!active) return;
      setUser(profile);
      void window.lotagate.menu.setContext(profile ? 'workspace' : 'login');
      setState(profile ? 'workspace' : 'login');
      }).catch((reason: unknown) => {
        if (!active) return;
      void window.lotagate.menu.setContext('login');
      setError(toMessage(reason));
      setState('login');
      });
    };
    void window.lotagate.updates.check().then(snapshot => {
      if (!active) return;
      setUpdate(snapshot);
      if (snapshot.phase === 'available' || (snapshot.phase === 'unavailable' && snapshot.blocking)) setState('update'); else restoreSession();
    }).catch(() => restoreSession());
    const unsubscribeUpdate = window.lotagate.updates.onState(snapshot => { if (active) setUpdate(snapshot); });
    const unsubscribeSession = window.lotagate.auth.onSessionExpired(() => { void window.lotagate.menu.setContext('login'); setUser(null); setState('login'); setError(translate.current('sessionExpired')); });
    return () => { active = false; unsubscribeUpdate(); unsubscribeSession(); };
  }, []);

  if (state === 'checking-update') return <main className="app-loading"><Spinner label={t('checkingForUpdates')} /></main>;
  if (state === 'update' && update) return <UpdateGate snapshot={update} onContinue={() => { setError(undefined); setState('checking'); void window.lotagate.auth.restoreSession().then(profile => { setUser(profile); void window.lotagate.menu.setContext(profile ? 'workspace' : 'login'); setState(profile ? 'workspace' : 'login'); }).catch(reason => { void window.lotagate.menu.setContext('login'); setError(toMessage(reason)); setState('login'); }); }} />;
  if (state === 'checking') return <main className="app-loading"><Spinner label={t('checkingSession')} /></main>;
  if (state === 'login') return <LoginScreen {...(error === undefined ? {} : { initialError: error })} onLogin={handleLogin} />;
  if (!user) return null;
  return <WorkspaceShell user={user} onLoggedOut={() => { void window.lotagate.menu.setContext('login'); setUser(null); setState('login'); }} />;

  async function handleLogin(input: LoginInput) {
    setError(undefined);
    const profile = await window.lotagate.auth.login(input);
    await window.lotagate.menu.setContext('workspace');
    setUser(profile);
    setState('workspace');
  }
}
