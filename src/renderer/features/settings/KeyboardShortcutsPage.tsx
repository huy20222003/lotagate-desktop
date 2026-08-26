import { useEffect, useMemo, useState } from 'react';
import { Pencil, Search, Trash2 } from 'lucide-react';
import { Button, Card, Modal, TextInput, Tooltip, useToast } from '../../components/ui.js';
import { formatShortcutEvent, type KeyboardShortcutAction, type KeyboardShortcutBindings, KEYBOARD_SHORTCUT_DEFINITIONS } from '../../services/keyboard-shortcuts.js';

export function KeyboardShortcutsPage({ bindings, onUpdate }: { bindings: KeyboardShortcutBindings; onUpdate: (action: KeyboardShortcutAction, shortcut: string | null) => Promise<void> }) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<KeyboardShortcutAction | undefined>();
  const [capturing, setCapturing] = useState(false);
  const [saving, setSaving] = useState(false);
  const { error } = useToast();
  const rows = useMemo(() => KEYBOARD_SHORTCUT_DEFINITIONS.filter(definition => `${definition.label} ${definition.description}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [query]);
  const definition = KEYBOARD_SHORTCUT_DEFINITIONS.find(item => item.action === editing);
  useEffect(() => {
    if (!capturing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault(); event.stopPropagation();
      const shortcut = formatShortcutEvent(event);
      if (shortcut === null) return;
      void saveShortcut(shortcut);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [capturing]);
  const saveShortcut = async (shortcut: string | null) => {
    if (!editing) return;
    setSaving(true);
    try { await onUpdate(editing, shortcut); setEditing(undefined); setCapturing(false); }
    catch (reason) { error('Unable to save shortcut', reason instanceof Error ? reason.message : 'Please try again.'); }
    finally { setSaving(false); }
  };
  return <div className="keyboard-shortcuts-page"><div className="keyboard-shortcuts-toolbar"><TextInput value={query} onChange={event => setQuery(event.target.value)} placeholder="Search shortcuts" aria-label="Search shortcuts" /><Search size={16} aria-hidden="true" /></div><Card className="keyboard-shortcuts-list">{rows.length === 0 ? <p className="settings-muted">No matching shortcuts.</p> : rows.map(row => <div className="keyboard-shortcut-row" key={row.action}><div><strong>{row.label}</strong><span>{row.description}</span></div><div className="keyboard-shortcut-actions"><button type="button" className="shortcut-value" onClick={() => { setEditing(row.action); setCapturing(true); }}>{bindings[row.action] ?? 'Unassigned'}</button><Tooltip label="Edit shortcut"><button type="button" className="icon-button" aria-label={`Edit ${row.label} shortcut`} onClick={() => { setEditing(row.action); setCapturing(true); }}><Pencil size={14} /></button></Tooltip><Tooltip label="Clear shortcut"><button type="button" className="icon-button" aria-label={`Clear ${row.label} shortcut`} disabled={bindings[row.action] === null} onClick={() => void onUpdate(row.action, null)}><Trash2 size={14} /></button></Tooltip></div></div>)}</Card>{definition ? <Modal title={`Edit ${definition.label} shortcut`} onClose={() => { setEditing(undefined); setCapturing(false); }}><div className="shortcut-capture"><p>Press the key combination you want to assign.</p><Button variant="primary" disabled={saving} onClick={() => setCapturing(true)}>{capturing ? 'Listening…' : 'Press keys'}</Button><span>{bindings[definition.action] ?? 'Unassigned'}</span></div><div className="modal-actions"><Button variant="secondary" onClick={() => { setEditing(undefined); setCapturing(false); }}>Cancel</Button><Button variant="danger" disabled={saving || bindings[definition.action] === null} onClick={() => void saveShortcut(null)}>Clear</Button></div></Modal> : null}</div>;
}
