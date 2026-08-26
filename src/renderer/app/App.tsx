import { useEffect, useState } from 'react';
import type { LoginInput, UserProfile } from '../../contracts/ipc/v1/auth.js';
import { Spinner } from '../components/ui.js';
import { LoginScreen } from '../features/auth/LoginScreen.js';
import { WorkspaceShell } from '../features/workspace/WorkspaceShell.js';
import { useLocale } from '../i18n/locale.js';
import { toUserErrorMessage as toMessage } from '../utils/errors.js';

type AppState = 'checking' | 'login' | 'workspace';

export function App() {
  const { t } = useLocale();
  const [state, setState] = useState<AppState>('checking');
  const [user, setUser] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    window.lotagate.auth.restoreSession().then((profile) => {
      setUser(profile);
      void window.lotagate.menu.setContext(profile ? 'workspace' : 'login');
      setState(profile ? 'workspace' : 'login');
    }).catch((reason: unknown) => {
      void window.lotagate.menu.setContext('login');
      setError(toMessage(reason));
      setState('login');
    });
    return window.lotagate.auth.onSessionExpired(() => { void window.lotagate.menu.setContext('login'); setUser(null); setState('login'); setError(t('sessionExpired')); });
  }, [t]);

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
