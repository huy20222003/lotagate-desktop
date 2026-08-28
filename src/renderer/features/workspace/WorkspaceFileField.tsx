import { useState } from 'react';
import { X } from 'lucide-react';
import { Button, Field, Icon } from '../../components/ui.js';
import type { SlashCommandField } from './slash-command.js';
import type { PickedWorkspaceFile } from './slash-command-view-types.js';
import { displayFileName, formatBytes } from './slash-command-format.js';
import { fileIconFor } from './file-icon.js';

export function WorkspaceFileField({ field, value, error, onChange, onPickFile }: { field: SlashCommandField; value: string | boolean | undefined; error?: string | undefined; onChange: (value: string | boolean) => void; onPickFile: (extensions?: readonly string[]) => Promise<PickedWorkspaceFile | null> }) {
  const [picking, setPicking] = useState(false);
  const [pickerError, setPickerError] = useState<string | undefined>();
  const selectedPath = typeof value === 'string' ? value : '';
  const chooseFile = async () => { setPicking(true); setPickerError(undefined); try { const selected = await onPickFile(field.accept); if (selected !== null) { if (field.maxBytes !== undefined && selected.sizeBytes > field.maxBytes) setPickerError(`File must not exceed ${formatBytes(field.maxBytes)}.`); else onChange(selected.path); } } catch { setPickerError('Unable to choose this file. Select a supported local file.'); } finally { setPicking(false); } };
  return <Field label={field.label} required={field.required} error={error ?? pickerError}><div className="slash-file-control">{selectedPath ? <div className="slash-file-selected" title={selectedPath}><Icon icon={fileIconFor({ name: selectedPath })} size={15} /><span>{displayFileName(selectedPath)}</span><Button variant="ghost" aria-label="Clear selected file" onClick={() => onChange('')}><X size={14} /></Button></div> : <Button variant="secondary" disabled={picking} onClick={() => void chooseFile()}><Icon icon={fileIconFor({ name: field.label })} size={14} />{picking ? 'Selecting…' : 'Choose file'}</Button>}</div></Field>;
}
