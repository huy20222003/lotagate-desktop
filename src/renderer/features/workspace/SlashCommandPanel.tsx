import { AudioLines, FileAudio, FolderOpen, Image, Target, Video, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Dropdown, Field, TextArea, TextInput } from '../../components/ui.js';
import { modelsForSlashCommand, slashCommandLabel, type SlashCommandDefinition, type SlashCommandErrors, type SlashCommandField, type SlashCommandForm } from './slash-command.js';
import type { WorkspaceModelOption } from './model-catalog.js';

const icons = { goal: Target, image: Image, video: Video, audio: AudioLines } as const;

export function SlashCommandPicker({ commands, selectedIndex, onSelect, onHover }: { commands: readonly SlashCommandDefinition[]; selectedIndex: number; onSelect: (command: SlashCommandDefinition) => void; onHover: (index: number) => void }) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => {
    const option = optionRefs.current[selectedIndex];
    if (!option || typeof option.scrollIntoView !== 'function') return;
    option.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);
  if (commands.length === 0) return <div className="slash-command-picker-empty">No available slash commands.</div>;
  return <div className="slash-command-picker" role="listbox" aria-label="Slash commands">{commands.map((command, index) => {
    const Icon = icons[command.id.split('.')[0] as keyof typeof icons] ?? Target;
    return <button ref={element => { optionRefs.current[index] = element; }} type="button" role="option" aria-selected={selectedIndex === index} className={`slash-command-option ${selectedIndex === index ? 'selected' : ''}`} key={command.id} onMouseDown={event => event.preventDefault()} onMouseEnter={() => onHover(index)} onClick={() => onSelect(command)}><Icon size={17} /><span><strong>{slashCommandLabel(command)}</strong><small>{command.description}</small></span></button>;
  })}</div>;
}

export interface PickedWorkspaceFile { path: string; sizeBytes: number; }

export function SlashCommandPanel({ command, form, models, errors = { fields: {} }, onChange, onToggleAdvanced, onClear, onPickFolder, onPickFile, onPickMultipleFile, showHeader = true }: { command: SlashCommandDefinition; form: SlashCommandForm; models: readonly WorkspaceModelOption[]; errors?: SlashCommandErrors; onChange: (form: SlashCommandForm) => void; onToggleAdvanced: () => void; onClear: () => void; onPickFolder: () => Promise<string | null>; onPickFile: (extensions?: readonly string[]) => Promise<PickedWorkspaceFile | null>; onPickMultipleFile: (extensions?: readonly string[]) => Promise<PickedWorkspaceFile[]>; showHeader?: boolean }) {
  const Icon = icons[command.id.split('.')[0] as keyof typeof icons] ?? Target;
  const updateValue = (name: string, value: string | boolean) => onChange({ ...form, values: { ...form.values, [name]: value } });
  return <section className="slash-command-panel" aria-label={`${command.label} command`}>
    {showHeader ? <header className="slash-command-header"><span className="slash-command-title"><Icon size={17} /><strong>/{command.id.split('.')[0]}</strong><small>{command.description}</small></span><Button variant="ghost" className="slash-command-clear" aria-label="Clear slash command" onClick={onClear}><X size={16} /></Button></header> : null}
    <Field label={command.primaryLabel} required={command.primaryRequired !== false} error={errors.primary}><TextArea className="slash-command-primary" autoFocus placeholder={command.primaryPlaceholder} value={form.primary} onChange={event => onChange({ ...form, primary: event.target.value })} /></Field>
    <div className="slash-command-fields">{command.fields.map(field => <SlashField key={field.name} command={command} field={field} models={models} value={form.values[field.name]} error={errors.fields[field.name]} onChange={value => updateValue(field.name, value)} onPickFolder={onPickFolder} onPickFile={onPickFile} onPickMultipleFile={onPickMultipleFile} />)}</div>
    {command.advancedFields.length > 0 ? <><button type="button" className="slash-command-advanced-toggle" onClick={onToggleAdvanced}>{form.advancedOpen ? 'Hide advanced options' : 'Show advanced options'}</button>{form.advancedOpen ? <div className="slash-command-fields slash-command-advanced-fields">{command.advancedFields.map(field => <SlashField key={field.name} command={command} field={field} models={models} value={form.values[field.name]} error={errors.fields[field.name]} onChange={value => updateValue(field.name, value)} onPickFolder={onPickFolder} onPickFile={onPickFile} onPickMultipleFile={onPickMultipleFile} />)}</div> : null}</> : null}
  </section>;
}

function SlashField({ command, field, models, value, error, onChange, onPickFolder, onPickFile, onPickMultipleFile }: { command: SlashCommandDefinition; field: SlashCommandField; models: readonly WorkspaceModelOption[]; value: string | boolean | undefined; error?: string | undefined; onChange: (value: string | boolean) => void; onPickFolder: () => Promise<string | null>; onPickFile: (extensions?: readonly string[]) => Promise<PickedWorkspaceFile | null>; onPickMultipleFile: (extensions?: readonly string[]) => Promise<PickedWorkspaceFile[]> }) {
  if (field.type === 'checkbox') return <div className="slash-command-checkbox"><Checkbox label={field.label} checked={value === true} onChange={onChange} />{error ? <span className="field-error" role="alert">{error}</span> : null}</div>;
  if (field.type === 'directory') return <OutputDirectoryField field={field} value={value} error={error} onChange={onChange} onPickFolder={onPickFolder} />;
  if (field.type === 'file') return <WorkspaceFileField field={field} value={value} error={error} onChange={onChange} onPickFile={onPickFile} />;
  if (field.type === 'multiple-file') return <WorkspaceFilesField field={field} value={value} error={error} onChange={onChange} onPickMultipleFile={onPickMultipleFile} />;
  if (field.type === 'select') {
    const options = field.name === 'model'
      ? modelsForSlashCommand(command, models).map(model => ({ value: model.id, label: model.label }))
      : (field.options ?? []).map(option => ({ value: option, label: option }));
    return <Field label={field.label} required={field.required} error={error}><Dropdown value={typeof value === 'string' ? value : ''} options={options} onChange={onChange} disabled={field.name === 'model' && options.length === 0} /></Field>;
  }
  if (field.type === 'textarea') return <Field label={field.label} required={field.required} error={error}><TextArea placeholder={field.placeholder} value={typeof value === 'string' ? value : ''} onChange={event => onChange(event.target.value)} /></Field>;
  return <Field label={field.label} required={field.required} error={error}><TextInput placeholder={field.placeholder} value={typeof value === 'string' ? value : ''} onChange={event => onChange(event.target.value)} /></Field>;
}

function OutputDirectoryField({ field, value, error, onChange, onPickFolder }: { field: SlashCommandField; value: string | boolean | undefined; error?: string | undefined; onChange: (value: string | boolean) => void; onPickFolder: () => Promise<string | null> }) {
  const [picking, setPicking] = useState(false);
  const [pickerError, setPickerError] = useState<string | undefined>();
  const chooseFolder = async () => {
    setPicking(true);
    setPickerError(undefined);
    try {
      const selected = await onPickFolder();
      if (selected !== null) onChange(selected);
    } catch {
      setPickerError('Unable to choose an output directory.');
    } finally {
      setPicking(false);
    }
  };
  return <Field label={field.label} error={error ?? pickerError}><div className="slash-directory-control"><TextInput placeholder={field.placeholder} value={typeof value === 'string' ? value : ''} onChange={event => onChange(event.target.value)} /><Button variant="secondary" disabled={picking} onClick={() => void chooseFolder()}><FolderOpen size={14} />{picking ? 'Selecting…' : 'Browse'}</Button></div></Field>;
}

function WorkspaceFileField({ field, value, error, onChange, onPickFile }: { field: SlashCommandField; value: string | boolean | undefined; error?: string | undefined; onChange: (value: string | boolean) => void; onPickFile: (extensions?: readonly string[]) => Promise<PickedWorkspaceFile | null> }) {
  const [picking, setPicking] = useState(false);
  const [pickerError, setPickerError] = useState<string | undefined>();
  const selectedPath = typeof value === 'string' ? value : '';
  const chooseFile = async () => {
    setPicking(true);
    setPickerError(undefined);
    try {
      const selected = await onPickFile(field.accept);
      if (selected !== null) {
        if (field.maxBytes !== undefined && selected.sizeBytes > field.maxBytes) setPickerError(`File must not exceed ${formatBytes(field.maxBytes)}.`);
        else onChange(selected.path);
      }
    } catch {
      setPickerError('Unable to choose this file. Select a supported local file.');
    } finally {
      setPicking(false);
    }
  };
  return <Field label={field.label} required={field.required} error={error ?? pickerError}><div className="slash-file-control">{selectedPath ? <div className="slash-file-selected" title={selectedPath}><FileAudio size={15} /><span>{displayFileName(selectedPath)}</span><Button variant="ghost" aria-label="Clear selected file" onClick={() => onChange('')}><X size={14} /></Button></div> : <Button variant="secondary" disabled={picking} onClick={() => void chooseFile()}><FileAudio size={14} />{picking ? 'Selecting…' : 'Choose file'}</Button>}</div></Field>;
}

function WorkspaceFilesField({ field, value, error, onChange, onPickMultipleFile }: { field: SlashCommandField; value: string | boolean | undefined; error?: string | undefined; onChange: (value: string | boolean) => void; onPickMultipleFile: (extensions?: readonly string[]) => Promise<PickedWorkspaceFile[]> }) {
  const [picking, setPicking] = useState(false);
  const [pickerError, setPickerError] = useState<string | undefined>();
  const selectedPaths = typeof value === 'string' ? value.split(',').map(item => item.trim()).filter(Boolean) : [];
  const chooseFiles = async () => {
    setPicking(true); setPickerError(undefined);
    try {
      const selected = await onPickMultipleFile(field.accept);
      const tooLarge = field.maxBytes !== undefined && selected.some(file => file.sizeBytes > field.maxBytes!);
      const totalBytes = selected.reduce((total, file) => total + file.sizeBytes, 0);
      if (tooLarge) setPickerError(`Each file must not exceed ${formatBytes(field.maxBytes!)}.`);
      else if (field.maxTotalBytes !== undefined && totalBytes > field.maxTotalBytes) setPickerError(`Selected files must not exceed ${formatBytes(field.maxTotalBytes)} in total.`);
      else if (selected.length > 0) onChange(selected.map(file => file.path).join(','));
    } catch { setPickerError('Unable to choose these files. Select supported local files.'); }
    finally { setPicking(false); }
  };
  return <Field label={field.label} required={field.required} error={error ?? pickerError}><div className="slash-file-control slash-multiple-file-control">{selectedPaths.length > 0 ? <div className="slash-file-selected slash-files-selected" title={selectedPaths.join(', ')}><Image size={15} /><span>{selectedPaths.map(displayFileName).join(', ')}</span><Button variant="ghost" aria-label="Clear selected files" onClick={() => onChange('')}><X size={14} /></Button></div> : <Button variant="secondary" disabled={picking} onClick={() => void chooseFiles()}><Image size={14} />{picking ? 'Selecting…' : 'Choose files'}</Button>}</div></Field>;
}

function displayFileName(value: string): string {
  return value.split(/[\\/]/u).pop() ?? value;
}

function formatBytes(bytes: number): string { return bytes >= 1_000_000 ? `${bytes / 1_000_000} MB` : `${bytes / 1_000} KB`; }
