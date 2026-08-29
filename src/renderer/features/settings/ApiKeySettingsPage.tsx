import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, Field, Modal, TextInput, useToast } from '../../components/ui.js';
import { executeDesktopCommandResult, type DesktopCommandInvocation } from '../../services/desktop-command-client.js';
import { toUserErrorMessage } from '../../utils/errors.js';

const AUTH_STATUS_ACTION = 'auth.status';
const AUTH_LOGIN_ACTION = 'auth.login.direct';
const AUTH_LOGOUT_ACTION = 'auth.logout';

export function ApiKeySettingsPage({ cwd }: { cwd?: string }) {
  const [apiKey, setApiKey] = useState('');
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(Boolean(cwd));
  const [busy, setBusy] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const requestRef = useRef(0);
  const { success } = useToast();

  const reload = useCallback(async () => {
    const requestId = ++requestRef.current;
    if (cwd === undefined) { setConfigured(false); setLoading(false); setError(undefined); return; }
    setLoading(true); setError(undefined);
    try {
      const result = await executeDesktopCommandResult(cwd, command(AUTH_STATUS_ACTION));
      const status = parseStatus(result.content);
      if (requestId === requestRef.current) setConfigured(status.authenticated);
    } catch (reason) {
      if (requestId === requestRef.current) setError(toUserErrorMessage(reason, 'Unable to load API key status.'));
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [cwd]);

  useEffect(() => { void reload(); }, [reload]);

  const save = async () => {
    const value = apiKey.trim();
    if (!cwd || value.length === 0) return;
    setBusy(true); setError(undefined);
    try {
      await executeDesktopCommandResult(cwd, { ...command(AUTH_LOGIN_ACTION), secrets: { apiKey: value } });
      setApiKey('');
      await reload();
      success('API key saved');
    } catch (reason) { setError(toUserErrorMessage(reason, 'Unable to save API key.')); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!cwd) return;
    setRemoveOpen(false); setBusy(true); setError(undefined);
    try {
      await executeDesktopCommandResult(cwd, command(AUTH_LOGOUT_ACTION));
      await reload();
      success('API key removed');
    } catch (reason) { setError(toUserErrorMessage(reason, 'Unable to remove API key.')); }
    finally { setBusy(false); }
  };

  return <div className="api-key-settings-page"><div className="settings-intro"><span className="settings-eyebrow">Model access</span><h2>API key</h2><p>Store the key used by the local agent to access the configured model service.</p></div>{cwd === undefined ? <Card className="settings-empty"><strong>Open a workspace first</strong><p>The agent command bridge needs an active workspace.</p></Card> : <Card className="settings-form-card"><div className="settings-card-heading"><div><h3>Default model credential</h3><p>Your key is stored locally by the CLI and is never displayed after saving.</p></div><span className="settings-status">{loading ? 'Checking…' : configured ? 'Configured' : 'Not configured'}</span></div><Field label="API key" required><TextInput type="password" value={apiKey} placeholder={configured ? 'Enter a new key to replace the current one' : 'Paste your API key'} autoComplete="off" disabled={busy || loading} onChange={event => setApiKey(event.target.value)} /></Field>{error ? <p className="settings-form-error" role="alert">{error}</p> : null}<div className="settings-form-actions"><Button variant="primary" disabled={busy || loading || apiKey.trim().length === 0} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</Button>{configured ? <Button variant="danger" disabled={busy || loading} onClick={() => setRemoveOpen(true)}>Remove</Button> : null}</div></Card>}{removeOpen ? <Modal title="Remove API key" onClose={() => setRemoveOpen(false)}><p className="modal-copy">Remove the API key from the default CLI profile?</p><div className="modal-actions"><Button variant="secondary" onClick={() => setRemoveOpen(false)}>Cancel</Button><Button variant="danger" disabled={busy} onClick={() => void remove()}>Remove</Button></div></Modal> : null}</div>;
}

function command(actionId: string): DesktopCommandInvocation { return { actionId, positionals: [], options: {} }; }

function parseStatus(content: string): { authenticated: boolean } {
  try {
    const value: unknown = JSON.parse(content);
    return { authenticated: typeof value === 'object' && value !== null && (value as Record<string, unknown>)['authenticated'] === true };
  } catch { return { authenticated: false }; }
}
