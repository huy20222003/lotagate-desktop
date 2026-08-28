import { useState } from 'react';
import { X } from 'lucide-react';
import { Button, Field, Icon } from '../../components/ui.js';
import type { SlashCommandField } from './slash-command.js';
import type { PickedWorkspaceFile } from './slash-command-view-types.js';
import { displayFileName, formatBytes } from './slash-command-format.js';
import { fileIconFor } from './file-icon.js';

export function WorkspaceFilesField({ field, value, error, onChange, onPickMultipleFile }: { field: SlashCommandField; value: string | boolean | undefined; error?: string | undefined; onChange: (value: string | boolean) => void; onPickMultipleFile: (extensions?: readonly string[]) => Promise<PickedWorkspaceFile[]> }) {
  const [picking, setPicking] = useState(false);
  const [pickerError, setPickerError] = useState<string | undefined>();
  const selectedPaths = typeof value === 'string' ? value.split(',').map(item => item.trim()).filter(Boolean) : [];
  const chooseFiles = async () => { setPicking(true); setPickerError(undefined); try { const selected = await onPickMultipleFile(field.accept); const tooLarge = field.maxBytes !== undefined && selected.some(file => file.sizeBytes > field.maxBytes!); const totalBytes = selected.reduce((total, file) => total + file.sizeBytes, 0); if (tooLarge) setPickerError(`Each file must not exceed ${formatBytes(field.maxBytes!)}.`); else if (field.maxTotalBytes !== undefined && totalBytes > field.maxTotalBytes) setPickerError(`Selected files must not exceed ${formatBytes(field.maxTotalBytes)} in total.`); else if (selected.length > 0) onChange(selected.map(file => file.path).join(',')); } catch { setPickerError('Unable to choose these files. Select supported local files.'); } finally { setPicking(false); } };
  return <Field label={field.label} required={field.required} error={error ?? pickerError}><div className="slash-file-control slash-multiple-file-control">{selectedPaths.length > 0 ? <div className="slash-file-selected slash-files-selected" title={selectedPaths.join(', ')}><Icon icon={fileIconFor({ name: selectedPaths[0] ?? field.label })} size={15} /><span>{selectedPaths.map(displayFileName).join(', ')}</span><Button variant="ghost" aria-label="Clear selected files" onClick={() => onChange('')}><X size={14} /></Button></div> : <Button variant="secondary" disabled={picking} onClick={() => void chooseFiles()}><Icon icon={fileIconFor({ name: field.label })} size={14} />{picking ? 'Selecting…' : 'Choose files'}</Button>}</div></Field>;
}
