import { Checkbox, Dropdown, Field, TextArea, TextInput } from '../../../components/ui.js';
import { modelsForSlashCommand, type SlashCommandDefinition, type SlashCommandField } from './slash-command.js';
import type { WorkspaceModelOption } from '../../../services/model-catalog.js';
import type { PickedWorkspaceFile } from './slash-command-view-types.js';
import { OutputDirectoryField } from '../integrations/OutputDirectoryField.js';
import { WorkspaceFileField } from '../shell/WorkspaceFileField.js';
import { WorkspaceFilesField } from '../shell/WorkspaceFilesField.js';

export function SlashField({ command, field, models, value, error, onChange, onPickFolder, onPickFile, onPickMultipleFile }: { command: SlashCommandDefinition; field: SlashCommandField; models: readonly WorkspaceModelOption[]; value: string | boolean | undefined; error?: string | undefined; onChange: (value: string | boolean) => void; onPickFolder: () => Promise<string | null>; onPickFile: (extensions?: readonly string[]) => Promise<PickedWorkspaceFile | null>; onPickMultipleFile: (extensions?: readonly string[]) => Promise<PickedWorkspaceFile[]> }) {
  if (field.type === 'checkbox') return <div className="slash-command-checkbox"><Checkbox label={field.label} checked={value === true} onChange={onChange} />{error ? <span className="field-error" role="alert">{error}</span> : null}</div>;
  if (field.type === 'directory') return <OutputDirectoryField field={field} value={value} error={error} onChange={onChange} onPickFolder={onPickFolder} />;
  if (field.type === 'file') return <WorkspaceFileField field={field} value={value} error={error} onChange={onChange} onPickFile={onPickFile} />;
  if (field.type === 'multiple-file') return <WorkspaceFilesField field={field} value={value} error={error} onChange={onChange} onPickMultipleFile={onPickMultipleFile} />;
  if (field.type === 'select') {
    const options = field.name === 'model' ? modelsForSlashCommand(command, models).map(model => ({ value: model.id, label: model.label })) : (field.options ?? []).map(option => ({ value: option, label: option }));
    return <Field label={field.label} required={field.required} error={error}><Dropdown value={typeof value === 'string' ? value : ''} options={options} onChange={onChange} disabled={field.name === 'model' && options.length === 0} /></Field>;
  }
  if (field.type === 'textarea') return <Field label={field.label} required={field.required} error={error}><TextArea placeholder={field.placeholder} value={typeof value === 'string' ? value : ''} onChange={event => onChange(event.target.value)} /></Field>;
  return <Field label={field.label} required={field.required} error={error}><TextInput placeholder={field.placeholder} value={typeof value === 'string' ? value : ''} onChange={event => onChange(event.target.value)} /></Field>;
}
