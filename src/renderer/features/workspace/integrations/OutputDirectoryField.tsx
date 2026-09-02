import { useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { Button, Field, Icon, TextInput } from '../../../components/ui.js';
import type { SlashCommandField } from '../composer/slash-command.js';

export function OutputDirectoryField({ field, value, error, onChange, onPickFolder }: { field: SlashCommandField; value: string | boolean | undefined; error?: string | undefined; onChange: (value: string | boolean) => void; onPickFolder: () => Promise<string | null> }) {
  const [picking, setPicking] = useState(false);
  const [pickerError, setPickerError] = useState<string | undefined>();
  const chooseFolder = async () => { setPicking(true); setPickerError(undefined); try { const selected = await onPickFolder(); if (selected !== null) onChange(selected); } catch { setPickerError('Unable to choose an output directory.'); } finally { setPicking(false); } };
  return <Field label={field.label} error={error ?? pickerError}><div className="slash-directory-control"><TextInput placeholder={field.placeholder} value={typeof value === 'string' ? value : ''} onChange={event => onChange(event.target.value)} /><Button variant="secondary" disabled={picking} onClick={() => void chooseFolder()}><Icon icon={FolderOpen} size={14} />{picking ? 'Selecting…' : 'Browse'}</Button></div></Field>;
}
