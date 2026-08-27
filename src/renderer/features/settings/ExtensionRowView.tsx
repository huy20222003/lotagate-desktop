import { Check, CircleOff, Trash2 } from 'lucide-react';
import { Card, Tooltip } from '../../components/ui.js';
import type { ExtensionRowViewProps } from './extensions-view-types.js';

export function ExtensionRowView({ row, busy, readOnly, canToggle, canRemove, onOpen, onToggle, onRemove }: ExtensionRowViewProps) {
  const enabled = row.status === 'ENABLED';
  return <div className="settings-extension-row-clickable" role="button" tabIndex={0} onClick={onOpen} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(); } }}><Card className="settings-extension-row"><div className="settings-extension-copy"><strong>{row.name}</strong><span>{row.detail}</span></div>{!readOnly ? <div className="settings-extension-actions">{canToggle ? <Tooltip label={enabled ? 'Disable' : 'Enable'}><button type="button" className="icon-button" aria-label={`${enabled ? 'Disable' : 'Enable'} ${row.name}`} disabled={busy} onClick={event => { event.stopPropagation(); onToggle(); }}>{enabled ? <CircleOff size={15} /> : <Check size={15} />}</button></Tooltip> : null}{canRemove ? <Tooltip label="Remove"><button type="button" className="icon-button settings-extension-danger" aria-label={`Remove ${row.name}`} disabled={busy} onClick={event => { event.stopPropagation(); onRemove(); }}><Trash2 size={15} /></button></Tooltip> : null}</div> : null}</Card></div>;
}
