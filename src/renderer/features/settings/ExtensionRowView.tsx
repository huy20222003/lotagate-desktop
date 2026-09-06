import { Check, CircleOff, Trash2 } from 'lucide-react';
import { ActionMenu, type ActionMenuItem } from '../../components/ActionMenu.js';
import { Card } from '../../components/ui.js';
import { formatTextClamp } from '../../utils/text.js';
import type { ExtensionRow } from './extension-command-client.js';
import type { ExtensionRowViewProps } from './extensions-view-types.js';
import { DEFAULT_EXTENSION_ICONS } from './extension-icons.js';

export function ExtensionRowView({ kind, row, busy, readOnly, canToggle, canRemove, onOpen, onToggle, onRemove }: ExtensionRowViewProps) {
  const enabled = row.status === 'ENABLED';
  const copy = extensionCopy(kind, row);
  const actions: ActionMenuItem[] = [
    ...(readOnly || !canToggle ? [] : [{ label: enabled ? 'Disable' : 'Enable', icon: enabled ? CircleOff : Check, disabled: busy, onSelect: onToggle }]),
    ...(readOnly || !canRemove ? [] : [{ label: `Remove ${copy.title}`, icon: Trash2, tone: 'danger' as const, disabled: busy, onSelect: onRemove }]),
  ];
  return <div className="settings-extension-row-clickable" role="button" tabIndex={0} onClick={onOpen} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(); } }}><Card className="settings-extension-row"><span className="settings-extension-icon"><img src={DEFAULT_EXTENSION_ICONS[kind]} alt="" /></span><div className="settings-extension-copy"><strong>{copy.title}</strong><span>{copy.description}</span></div>{actions.length > 0 ? <div className="settings-extension-item-actions" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}><ActionMenu ariaLabel={`Actions for ${copy.title}`} items={actions} /></div> : null}</Card></div>;
}

function extensionCopy(kind: ExtensionRowViewProps['kind'], row: ExtensionRow): { title: string; description: string } {
  if (kind === 'skill') return { title: row.sourceName ?? row.name, description: formatTextClamp(140, row.description ?? withoutScope(row.detail)) };
  if (kind === 'hook') return { title: row.name, description: formatTextClamp(140, `Event: ${row.status}`) };
  if (kind === 'mcp') {
    const detail = withoutScope(row.detail);
    const type = detail.split(' · ')[0] ?? detail;
    return { title: row.name, description: formatTextClamp(140, `Type: ${type}`) };
  }
  return { title: row.name, description: formatTextClamp(140, row.detail) };
}

function withoutScope(value: string): string {
  const separator = value.indexOf(' · ');
  return separator < 0 ? value : value.slice(separator + 3);
}
