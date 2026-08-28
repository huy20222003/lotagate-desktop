import { Check, CircleOff, Trash2 } from 'lucide-react';
import { Card, IconButton } from '../../components/ui.js';
import type { ExtensionRowViewProps } from './extensions-view-types.js';

export function ExtensionRowView({ row, busy, readOnly, canToggle, canRemove, onOpen, onToggle, onRemove }: ExtensionRowViewProps) {
  const enabled = row.status === 'ENABLED';
  return <div className="settings-extension-row-clickable" role="button" tabIndex={0} onClick={onOpen} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(); } }}><Card className="settings-extension-row"><div className="settings-extension-copy"><strong>{row.name}</strong><span>{row.detail}</span></div>{!readOnly ? <div className="settings-extension-actions">{canToggle ? <IconButton icon={enabled ? CircleOff : Check} iconSize={15} label={`${enabled ? 'Disable' : 'Enable'} ${row.name}`} disabled={busy} onClick={event => { event.stopPropagation(); onToggle(); }} /> : null}{canRemove ? <IconButton icon={Trash2} iconSize={15} className="settings-extension-danger" label={`Remove ${row.name}`} disabled={busy} onClick={event => { event.stopPropagation(); onRemove(); }} /> : null}</div> : null}</Card></div>;
}
