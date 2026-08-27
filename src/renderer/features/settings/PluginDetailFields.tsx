import { Field, TextInput } from '../../components/ui.js';

export function PluginDetailFields({ version, description, editable, onVersion, onDescription }: { version: string; description: string; editable: boolean; onVersion: (value: string) => void; onDescription: (value: string) => void }) {
  return <div className="extension-detail-fields"><Field label="Version"><TextInput value={version} readOnly={!editable} onChange={event => onVersion(event.target.value)} /></Field><Field label="Description"><TextInput value={description} readOnly={!editable} onChange={event => onDescription(event.target.value)} /></Field></div>;
}
