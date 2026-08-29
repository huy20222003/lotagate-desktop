import { useState } from 'react';
import { Button, Field, Modal, TextInput, useToast } from '../../components/ui.js';
import { toUserErrorMessage } from '../../utils/errors.js';
import { saveApiKey } from './api-key-command-client.js';

export function ApiKeyPromptModal({ cwd, onClose, onSaved }: { cwd: string; onClose: () => void; onSaved: () => void }) {
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const { success, error: showError } = useToast();

  const save = async () => {
    const value = apiKey.trim();
    if (!value) return;
    setSaving(true);
    setError(undefined);
    try {
      await saveApiKey(cwd, value);
      success('API key saved');
      onSaved();
    } catch (reason) {
      const message = toUserErrorMessage(reason, 'Unable to save API key.');
      setError(message);
      showError('Unable to save API key', message);
    } finally {
      setSaving(false);
    }
  };

  return <Modal title="Connect your model" subtitle="API key required" onClose={onClose}><div className="modal-form"><Field label="API key" required error={error}><TextInput type="password" value={apiKey} placeholder="Paste your API key" autoComplete="off" autoFocus disabled={saving} onChange={event => setApiKey(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void save(); } }} /></Field></div><div className="modal-actions"><Button variant="secondary" disabled={saving} onClick={onClose}>Not now</Button><Button variant="primary" disabled={saving || apiKey.trim().length === 0} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</Button></div></Modal>;
}
