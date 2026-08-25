import { useState } from 'react';
import type { LoginInput } from '../../../contracts/ipc/v1/auth.js';
import { KeyRound, LockKeyhole } from 'lucide-react';
import { Button, Field, Spinner, TextInput } from '../../components/ui.js';
import { useLocale } from '../../i18n/locale.js';

export function LoginScreen({ initialError, onLogin }: { initialError?: string; onLogin: (input: LoginInput) => Promise<void> }) {
  const { t } = useLocale();
  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setLoading(true);
    try {
      await onLogin({ usernameOrEmail, password });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Sign in failed.');
    } finally {
      setLoading(false);
    }
  }

  return <main className="login-page"><section className="login-card"><div className="brand-mark"><span className="brand-glyph">L</span><span>LotaGate</span></div><p className="eyebrow">Agent Workspace</p><h1>{t('signInTitle')}</h1><p className="login-copy">{t('signInCopy')}</p><form onSubmit={submit}><Field label={t('emailOrUsername')}><TextInput autoComplete="username" value={usernameOrEmail} onChange={(event) => setUsernameOrEmail(event.target.value)} required /></Field><Field label={t('password')}><TextInput type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></Field>{error ? <p className="form-error" role="alert">{error}</p> : null}<Button variant="primary" className="submit-button" type="submit" disabled={loading}>{loading ? <Spinner label={t('signingIn')} /> : <><LockKeyhole size={16} /> {t('signIn')}</>}</Button></form><div className="login-note"><KeyRound size={15} /> {t('sessionProtected')}</div></section></main>;
}
