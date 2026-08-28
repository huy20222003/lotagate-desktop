import { useState } from 'react';
import type { LoginInput } from '../../../contracts/ipc/v1/auth.js';
import { Eye, EyeOff, KeyRound, LockKeyhole } from 'lucide-react';
import { Button, Field, IconButton, Spinner, TextInput, useToast } from '../../components/ui.js';
import { BrandLogo } from '../../components/BrandLogo.js';
import { useLocale } from '../../i18n/locale.js';

export function LoginScreen({ initialError, onLogin }: { initialError?: string; onLogin: (input: LoginInput) => Promise<void> }) {
  const { t } = useLocale();
  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const toast = useToast();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setLoading(true);
    try {
      await onLogin({ usernameOrEmail, password });
      toast.success('Signed in', 'Your LotaGate workspace is ready.');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Sign in failed.';
      setError(message);
      toast.error('Sign in failed', message);
    } finally {
      setLoading(false);
    }
  }

  return <main className="login-page"><section className="login-card"><div className="brand-mark"><BrandLogo /><span>LotaGate</span></div><p className="eyebrow">Agent Workspace</p><h1>{t('signInTitle')}</h1><p className="login-copy">{t('signInCopy')}</p><form onSubmit={submit}><Field label={t('emailOrUsername')} required><TextInput autoComplete="username" value={usernameOrEmail} onChange={(event) => setUsernameOrEmail(event.target.value)} required /></Field><Field label={t('password')} required><span className="password-input-wrap"><TextInput type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /><IconButton icon={showPassword ? EyeOff : Eye} iconSize={16} className="password-toggle" label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(current => !current)} /></span></Field>{error ? <p className="form-error" role="alert">{error}</p> : null}<Button variant="primary" className="submit-button" type="submit" disabled={loading}>{loading ? <Spinner label={t('signingIn')} /> : <><LockKeyhole size={16} /> {t('signIn')}</>}</Button></form><div className="login-note"><KeyRound size={15} /> {t('sessionProtected')}</div></section></main>;
}
