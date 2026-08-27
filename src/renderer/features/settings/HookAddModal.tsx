import { useState } from 'react';
import { Button, Field, Modal, TextInput } from '../../components/ui.js';
import type { DesktopHookEvent } from '../../../contracts/ipc/v1/extensions.js';
import { HookDetailFields } from './HookDetailFields.js';
import { firstValidationError, parseArgs, validateHookFields, validateHookName } from './extensions-validation.js';
import { type HookAddValue, type ValidationErrors } from './extensions-view-types.js';

export function HookAddModal({ busy, onClose, onSubmit }: { busy: boolean; onClose: () => void; onSubmit: (value: HookAddValue) => void }) {
  const [name, setName] = useState(''); const [event, setEvent] = useState<DesktopHookEvent>('session.start'); const [command, setCommand] = useState(''); const [args, setArgs] = useState(''); const [timeoutMs, setTimeoutMs] = useState('10000'); const [submitted, setSubmitted] = useState(false);
  const errors: ValidationErrors = { name: validateHookName(name), ...validateHookFields(command, args, timeoutMs) }; const valid = firstValidationError(errors) === undefined; const submit = () => { setSubmitted(true); if (!valid) return; onSubmit({ name: name.trim(), event, command: command.trim(), args: parseArgs(args), timeoutMs: Number(timeoutMs) }); }; const visibleErrors = submitted ? errors : { name: name.trim() ? errors['name'] : undefined, command: command.trim() ? errors['command'] : undefined, args: args.trim() ? errors['args'] : undefined, timeoutMs: timeoutMs.trim() ? errors['timeoutMs'] : undefined };
  return <Modal title="Add hook" onClose={onClose}><div className="modal-form"><Field label="Name" required error={visibleErrors['name']}><TextInput value={name} onChange={eventValue => setName(eventValue.target.value)} placeholder="audit-hook" autoFocus /></Field><HookDetailFields event={event} command={command} args={args} timeoutMs={timeoutMs} errors={visibleErrors} editable onEvent={setEvent} onCommand={setCommand} onArgs={setArgs} onTimeout={setTimeoutMs} /></div><div className="modal-actions"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || !valid} onClick={submit}>{busy ? 'Adding…' : 'Add'}</Button></div></Modal>;
}
