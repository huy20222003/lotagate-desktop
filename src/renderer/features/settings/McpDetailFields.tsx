import type { ExtensionScope } from './extension-command-client.js';
import { Dropdown, Field, TextInput } from '../../components/ui.js';
import type { ValidationErrors } from './extensions-view-types.js';

export function McpDetailFields({ type, url, scope, errors, editable, onType, onUrl }: { type: string; url: string; scope?: ExtensionScope | undefined; errors: ValidationErrors; editable: boolean; onType: (value: string) => void; onUrl: (value: string) => void }) {
  const typeOptions = [...new Set(['http', 'sse', type])].map(value => ({ value, label: value.toUpperCase() }));
  return <div className="extension-detail-fields extension-detail-mcp-fields"><Field label="Type"><Dropdown value={type} options={typeOptions} disabled={!editable} onChange={onType} /></Field><Field label="Scope"><span className="extension-detail-static">{scope ?? 'workspace'}</span></Field><Field label="Server URL" required error={errors['url']}><TextInput value={url} readOnly={!editable} onChange={event => onUrl(event.target.value)} /></Field></div>;
}
